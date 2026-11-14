const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, archive, pause, id, lease, clear, raw, failure } = require("./pipeline-dead-letter-fixture.cjs");
const queued = (db) => db.query("SELECT * FROM pipeline_control.dead_letters ORDER BY id");
const resume = (db) => db.query("SELECT pipeline_control.resume_edge_job($1,$2) AS job", [id, "fresh-encrypted-fixture"]);

test("archival preserves source and diagnostics, is idempotent, and rejects changed payloads instead of overwriting", async () => {
  const { db } = await fixture();
  try {
    const first = (await archive(db)).rows[0].id;
    assert.equal((await archive(db)).rows[0].id, first);
    const rows = (await queued(db)).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].raw_record, raw);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].job_id, id);
    assert.equal(rows[0].operation_name, "etl-401");
    assert.equal(rows[0].error.raw_record, undefined);
    assert.equal(rows[0].error.reason, failure.failures[0].reason);
    await assert.rejects(archive(db, { ...raw, title: "Changed" }), /does not match|changed/);
    assert.deepEqual((await queued(db)).rows[0].raw_record, raw);
    await db.query("UPDATE pipeline_control.operations SET result=$2 WHERE job_id=$1", [id, {
      ...failure, failures: [{ ...failure.failures[0], reason: "Changed acknowledgement." }],
    }]);
    await assert.rejects(archive(db), /existing dead letter changed/);
    assert.equal((await queued(db)).rows[0].error.reason, failure.failures[0].reason);
    assert.equal((await db.query("SELECT job->'cursor'->>'afterId' AS cursor FROM pipeline_control.jobs")).rows[0].cursor, "401");
  } finally { await db.close(); }
});

test("only exact confirmed one-record failures with the current lease and original source can be archived", async () => {
  const { db } = await fixture();
  try {
    await assert.rejects(archive(db, raw, clear), /lease|checkpoint/);
    await assert.rejects(archive(db, { ...raw, id: 403 }), /source|record/);
    await assert.rejects(archive(db, { ...raw, fetchedAt: "2020-01-01T00:00:00.000Z" }), /source|record/);
    await db.query("UPDATE pipeline_control.jobs SET execution_until=now()-interval '1 minute' WHERE id=$1", [id]);
    await assert.rejects(archive(db), /lease/);
    await db.query("UPDATE pipeline_control.jobs SET execution_until=now()+interval '10 minutes',status='failed' WHERE id=$1", [id]);
    await assert.rejects(archive(db), /lease/);
    await db.query("UPDATE pipeline_control.jobs SET status='running' WHERE id=$1", [id]);
    await db.query("UPDATE pipeline_control.operations SET status='started',result=NULL WHERE job_id=$1", [id]);
    await assert.rejects(archive(db), /confirmed/);
    await db.query("UPDATE pipeline_control.operations SET status='completed',result=$2 WHERE job_id=$1", [id, {
      ...failure, inserted_count: 1, failed_count: 0, failures: [],
    }]);
    await assert.rejects(archive(db), /confirmed/);
    assert.equal((await queued(db)).rows.length, 0);
  } finally { await db.close(); }
});

test("ordinary data cleanup and new run admission retain dead letters and original data after staging is gone", async () => {
  const { db } = await fixture();
  try {
    await archive(db);
    await pause(db);
    await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.objects(record jsonb);");
    await db.query("INSERT INTO storage.objects VALUES ($1)", [raw]);
    await db.exec("DELETE FROM storage.objects; DELETE FROM hackathon_research.events;");
    await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ($1,'queued','{}',now()+interval '1 hour','supabase')`, [clear]);
    assert.equal((await queued(db)).rows.length, 1);
    assert.deepEqual((await queued(db)).rows[0].raw_record, raw);
  } finally { await db.close(); }
});

test("Clear all removes dead letters only after confirmed cleanup and preserves them on every refusal", async () => {
  const { db } = await fixture();
  try {
    await archive(db);
    await pause(db);
    await db.query("SELECT pipeline_control.enqueue_edge_clear($1,$2)", [clear, id]);
    await assert.rejects(db.query("SELECT pipeline_control.finish_edge_clear($1,$2)", [clear, lease]), /lease|checkpoint/);
    await db.query(`UPDATE pipeline_control.jobs SET status='running',execution_id=$2,execution_until=now()+interval '10 minutes',
      job=jsonb_set(job,'{cursor,phase}','"reset-postgresql"') WHERE id=$1`, [clear, lease]);
    await assert.rejects(db.query("SELECT pipeline_control.finish_edge_clear($1,$2)", [clear, lease]), /confirmed/);
    await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
      VALUES ($1,'reset-storage','completed','{"reset":true}'),($1,'reset-postgresql','completed','{"reset":true}')`, [clear]);
    await assert.rejects(db.query("SELECT pipeline_control.finish_edge_clear($1,$2)", [clear, lease]), /Event listings changed/);
    assert.equal((await queued(db)).rows.length, 1);
    await db.exec("DELETE FROM hackathon_research.events");
    await db.query("SELECT pipeline_control.finish_edge_clear($1,$2)", [clear, lease]);
    assert.equal((await queued(db)).rows.length, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("Continue replays an exact legacy confirmed failure without repeating the write or silently skipping it", async () => {
  const { db, job } = await fixture();
  try {
    await pause(db);
    const legacy = { ...failure, failures: failure.failures.map(({ raw_record: _raw, ...details }) => details) };
    await db.query("UPDATE pipeline_control.operations SET result=$2 WHERE job_id=$1", [id, legacy]);
    await db.query(`UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{etl}','{"processed":141,"inserted":140,"failed":1}') WHERE id=$1`, [id]);
    const saved = (await resume(db)).rows[0].job;
    assert.deepEqual(saved.cursor, job.cursor);
    assert.equal(saved.startedAt, job.startedAt);
    assert.deepEqual(saved.etl, { processed: 140, inserted: 140, failed: 0, deadLettered: 0 });
    assert.deepEqual(saved.resumeHistory[0].previousETLTotals, { processed: 141, inserted: 140, failed: 1 });
    assert.equal(saved.resumeHistory[0].replayedFailedOperation, "etl-401");
    assert.deepEqual((await db.query("SELECT result FROM pipeline_control.operations")).rows[0].result, legacy);
    assert.equal((await queued(db)).rows.length, 0);
  } finally { await db.close(); }
});

test("Continue accepts already archived failures behind the cursor but rejects unexplained counters and unknown operations", async () => {
  const { db } = await fixture();
  try {
    await archive(db);
    await pause(db);
    await db.query(`UPDATE pipeline_control.jobs SET job=jsonb_set(jsonb_set(job,'{etl}',
      '{"processed":1,"inserted":0,"failed":1,"deadLettered":1}'),'{cursor,afterId}','402') WHERE id=$1`, [id]);
    const saved = (await resume(db)).rows[0].job;
    assert.deepEqual(saved.etl, { processed: 1, inserted: 0, failed: 1, deadLettered: 1 });
    await pause(db);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{etl,failed}','2') WHERE id=$1", [id]);
    await assert.rejects(resume(db), /failed ETL records/);
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'etl-402','started')", [id]);
    await assert.rejects(resume(db), /no confirmed outcome/);
    assert.equal((await queued(db)).rows.length, 1);
  } finally { await db.close(); }
});

test("dead letters and archival functions are private to the database owner, not browser roles", async () => {
  const { db } = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_table_privilege($1,'pipeline_control.dead_letters','SELECT') AS allowed", [role])).rows[0].allowed, false);
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.archive_edge_dead_letter(uuid,uuid,text,jsonb)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='pipeline_control.dead_letters'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
