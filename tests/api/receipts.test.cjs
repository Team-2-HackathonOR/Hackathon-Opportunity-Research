const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { assert, connect, call, internal, urls } = require("./helpers.cjs");
test("horizontal: actual postgres.js BIGINT/JSON wire encoding, lost-response replay, lease fencing, and private schemas", async () => {
  const db = connect();
  const id = randomUUID();
  const execution = randomUUID();
  let eventId;
  try {
    const fetchedAt = new Date().toISOString();
    await call(`/api/internal/scraper/hackathons/persist-all?startPage=1&maxPages=1&ci_case=${id}`, 200,
      { base: urls.gateway, headers: { ...internal(), "x-pipeline-fetched-at": fetchedAt, "x-ai-api-key": "ci-fixture-key" } });
    const job = { id, startedAt: fetchedAt, status: "running", stage: "etl",
      cursor: { phase: "etl", page: 3, afterId: null } };
    await db.query(`INSERT INTO pipeline_control.jobs
      (id,status,job,key_ciphertext,key_expires_at,executor,execution_id,execution_until)
      VALUES ($1,'running',$2,'synthetic-unused-key',now()+interval '1 hour','supabase',$3,now()+interval '5 minutes')`,
    [id, job, execution]);
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'etl-first','started')", [id]);
    const body = { fetched_at: job.startedAt, after_id: null, limit: 1, cursor_mode: true,
      use_ai_normalization: true, pipeline_job_id: id, pipeline_operation: "etl-first", pipeline_execution_id: execution };
    const options = { base: urls.gateway, method: "POST", headers: { ...internal(), "x-ai-api-key": "ci-fixture-key" }, body };
    const route = "/api/internal/etl/etl/import/storage";
    await call(route, 403, { ...options, headers: {} });
    const first = await call(route, 200, options);
    eventId = first.successes[0].event_id;
    assert.equal(typeof eventId, "number");
    const stats = await call("/stats", 200, { base: urls.providers });
    assert.deepEqual(await call(route, 200, options), first);
    assert.deepEqual(await call("/stats", 200, { base: urls.providers }), stats);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.etl_receipts WHERE job_id=$1", [id])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events WHERE event_id=$1", [eventId])).rows[0].n, 1);
    await call(route, 409, { ...options, body: { ...body, after_id: 12 } });
    await db.query("UPDATE pipeline_control.jobs SET execution_until=now()-interval '1 second' WHERE id=$1", [id]);
    await call(route, 409, options);
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(`SELECT has_table_privilege($1,'pipeline_control.etl_receipts','SELECT') AS receipt,
        has_table_privilege($1,'pipeline_control.dead_letters','SELECT') AS dead_letter,
        has_table_privilege($1,'pipeline_control.staging_index','SELECT') AS staging,
        has_table_privilege($1,'app_auth.app_users','SELECT') AS accounts`, [role]);
      assert.deepEqual(rows[0], { receipt: false, dead_letter: false, staging: false, accounts: false });
    }
    const persisted = (await db.query("SELECT acknowledgement FROM pipeline_control.etl_receipts WHERE job_id=$1", [id])).rows[0];
    assert.deepEqual(persisted.acknowledgement, first);
  } finally {
    await db.query("DELETE FROM pipeline_control.operations WHERE job_id=$1", [id]);
    await db.query("DELETE FROM pipeline_control.jobs WHERE id=$1", [id]);
    if (eventId) await db.query("DELETE FROM hackathon_research.events WHERE event_id=$1", [eventId]);
    await db.end();
  }
});
