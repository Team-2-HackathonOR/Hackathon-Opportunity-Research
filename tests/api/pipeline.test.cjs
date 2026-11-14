const { test } = require("node:test");
const { assert, connect, call, login, internal, urls } = require("./helpers.cjs");
test("vertical: real Storage and PostgreSQL pipeline filters expired leads, retries 503, and continues past a dead letter", {
  timeout: 120000,
}, async () => {
  const db = connect();
  try {
    await call("/api/hackscout/admin/pipeline/run", 401, { method: "POST", body: { apiKey: "ci-fixture-key" } });
    await call("/health", 403, { base: urls.etl });
    await call("/api/internal/pipeline-worker/pipeline/tick", 403, { base: urls.gateway, method: "POST" });
    const session = await login();
    let { job } = await call("/api/hackscout/admin/pipeline/run", 202,
      { method: "POST", token: session.token, body: { apiKey: "ci-fixture-key" } });
    const id = job.id;
    const deadline = Date.now() + 90000;
    let observedRetry = false;
    while (["queued", "running"].includes(job.status) && Date.now() < deadline) {
      await call("/api/internal/pipeline-worker/pipeline/tick", 200,
        { base: urls.gateway, method: "POST", headers: internal() });
      ({ job } = await call("/api/hackscout/admin/pipeline", 200, { token: session.token }));
      observedRetry ||= Boolean(job.retry);
      if (job.retry) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(job.id, id);
    assert.equal(job.status, "completed", JSON.stringify(job));
    assert.equal(observedRetry, true);
    assert.equal(job.scraper.uniqueHackathonsPersisted, 3);
    assert.deepEqual(job.etl, { processed: 3, inserted: 2, failed: 1, deadLettered: 1 });
    const rows = (await db.query("SELECT event_name FROM hackathon_research.events ORDER BY event_name")).rows;
    assert.deepEqual(rows.map((row) => row.event_name), ["CI pipeline first", "CI pipeline last"]);
    const staging = (await db.query("SELECT source_id::text,confirmed FROM pipeline_control.staging_index ORDER BY source_id")).rows;
    assert.deepEqual(staging.map((row) => row.source_id), ["11", "12", "13"]);
    assert.ok(staging.every((row) => row.confirmed));
    const objects = (await db.query("SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='hackscout-staging'")).rows[0].n;
    assert.equal(objects, 3);
    const queue = await call("/api/hackscout/admin/pipeline/dead-letters", 200, { token: session.token });
    assert.equal(queue.total, 1);
    const detail = await call(`/api/hackscout/admin/pipeline/dead-letters/${queue.items[0].id}`, 200, { token: session.token });
    assert.equal(detail.item.raw_record.id, 12);
    assert.equal(detail.item.status, "pending");
    assert.equal(JSON.stringify(detail).includes("ci-fixture-key"), false);
    const receipts = (await db.query("SELECT acknowledgement FROM pipeline_control.etl_receipts WHERE job_id=$1", [id])).rows;
    assert.equal(receipts.length, 3);
    for (const { acknowledgement } of receipts) {
      for (const success of acknowledgement.successes) assert.equal(typeof success.event_id, "number");
    }
    const stats = await call("/stats", 200, { base: urls.providers });
    assert.equal(stats.transientFailures, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.operations WHERE job_id=$1 AND status='started'", [id])).rows[0].n, 0);
    await call("/api/auth/logout", 200, { method: "POST", token: session.token, body: {} });
  } finally { await db.end(); }
});
