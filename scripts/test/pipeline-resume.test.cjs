const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function fixture(phase = "etl") {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const edge = await readFile(path.join(root, "supabase/migrations/20261112180000_edge_pipeline.sql"), "utf8");
  await db.exec(edge.replace(/^CREATE EXTENSION[^;\n]*;\s*$/gm, ""));
  await db.exec(`CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text,active boolean);
    INSERT INTO cron.job VALUES ('hackscout-edge-tick',true);
    CREATE SCHEMA storage; CREATE TABLE storage.objects(name text);
    INSERT INTO storage.objects VALUES ('existing-staging-record');
    CREATE SCHEMA hackathon_research; CREATE TABLE hackathon_research.events(id int);
    INSERT INTO hackathon_research.events VALUES (1);`);
  await db.exec(await readFile(path.join(root, "supabase/migrations/20261113130000_pipeline_resume.sql"), "utf8"));
  const job = {
    id, status: "failed", cancelled: true, stage: phase === "etl" ? "etl" : "reset",
    error: "Stopped by administrator.", startedAt: "2026-11-13T01:03:05.180Z", finishedAt: "2026-11-13T03:52:33.308Z",
    stagingBackend: "supabase-storage", reset: { storage: 500, postgresql: 0 },
    scraper: { pagesPersisted: 1111, uniqueHackathonsPersisted: 9998 },
    steps: { reset: { status: phase === "etl" ? "completed" : "cancelled" },
      scraper: { status: phase === "etl" ? "completed" : "skipped" },
      etl: { status: phase === "etl" ? "cancelled" : "skipped", finishedAt: "old-finish" } },
    cursor: { phase, page: 1111, afterId: phase === "etl" ? 401 : null, resetBatch: 6 },
  };
  await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
    VALUES ($1,'failed',$2,now()-interval '1 hour','supabase')`, [id, job]);
  return { db, job };
}
const resume = (db, target = id) => db.query("SELECT pipeline_control.resume_edge_job($1,$2) AS job", [target, "fresh-encrypted-fixture"]);

test("Continue preserves ETL identity, timestamp, cursor, progress, data and ledger while replacing the erased key", async () => {
  const { db, job } = await fixture();
  try {
    await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
      VALUES ($1,'etl-401','completed','{"processed_count":1,"inserted_count":1,"failed_count":0,"next_after_id":402}')`, [id]);
    const saved = (await resume(db)).rows[0].job;
    assert.equal(saved.id, id);
    assert.equal(saved.startedAt, job.startedAt);
    assert.deepEqual(saved.cursor, job.cursor);
    assert.deepEqual(saved.scraper, job.scraper);
    assert.deepEqual(saved.reset, job.reset);
    assert.equal(saved.status, "queued");
    assert.equal(saved.steps.etl.status, "waiting");
    assert.equal(saved.steps.reset.status, "completed");
    assert.equal(saved.cancelled, undefined);
    assert.equal(saved.error, undefined);
    assert.equal(saved.steps.etl.finishedAt, undefined);
    assert.equal(saved.resumeHistory[0].previousError, job.error);
    const row = (await db.query(`SELECT key_ciphertext,key_expires_at>now() AS valid,
      execution_id,execution_until,blocked_until FROM pipeline_control.jobs`)).rows[0];
    assert.deepEqual(row, { key_ciphertext: "fresh-encrypted-fixture", valid: true,
      execution_id: null, execution_until: null, blocked_until: null });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage.objects")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events")).rows[0].n, 1);
    assert.equal((await db.query("SELECT status FROM pipeline_control.operations")).rows[0].status, "completed");
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "off");
    await assert.rejects(resume(db), /stopped or failed/);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.resume_edge_job(uuid,text)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test("Continue retains a partial reset's batch checkpoint and acknowledged deletion for replay", async () => {
  const { db, job } = await fixture("reset-storage");
  try {
    await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
      VALUES ($1,'reset-storage-6','completed','{"reset":false,"hasMore":true,"deletedRecords":100}')`, [id]);
    const saved = (await resume(db)).rows[0].job;
    assert.deepEqual(saved.cursor, job.cursor);
    assert.equal(saved.reset.storage, 500);
    assert.equal(saved.stage, "reset");
    assert.equal(saved.steps.reset.status, "waiting");
    assert.equal(saved.steps.scraper.status, "waiting");
    assert.equal((await db.query("SELECT result->>'deletedRecords' AS deleted FROM pipeline_control.operations")).rows[0].deleted, "100");
  } finally { await db.close(); }
});

test("Continue refuses unknown outcomes even after a manual global unblock", async () => {
  const { db } = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'etl-401','started')", [id]);
    await assert.rejects(resume(db), /etl-401.*no confirmed outcome/);
    assert.equal((await db.query("SELECT status FROM pipeline_control.jobs")).rows[0].status, "failed");
    assert.equal((await db.query("SELECT status FROM pipeline_control.operations")).rows[0].status, "started");
  } finally { await db.close(); }
});

test("Continue rejects obsolete checkpoints, conflicting runs, live leases and retired storage", async () => {
  const { db } = await fixture();
  try {
    await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ($1,'failed','{}',now(),'supabase')`, [other]);
    await assert.rejects(resume(db), /latest/);
    await db.query("DELETE FROM pipeline_control.jobs WHERE id=$1", [other]);
    await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor,created_at)
      VALUES ($1,'queued','{}',now(),'supabase','2020-01-01')`, [other]);
    await assert.rejects(resume(db), /already active/);
    await db.query("DELETE FROM pipeline_control.jobs WHERE id=$1", [other]);
    await db.query("UPDATE pipeline_control.jobs SET blocked_until='infinity' WHERE id=$1", [id]);
    await assert.rejects(resume(db), /blocked/);
    await db.query("UPDATE pipeline_control.jobs SET blocked_until=NULL,execution_id=$2,execution_until=now()+interval '1 minute' WHERE id=$1", [id, other]);
    await assert.rejects(resume(db), /lease/);
    await db.query("UPDATE pipeline_control.jobs SET execution_id=NULL,execution_until=NULL,job=job-'stagingBackend' WHERE id=$1", [id]);
    await assert.rejects(resume(db), /Storage/);
  } finally { await db.close(); }
});

test("Continue never skips failed ETL records or invalid cursors and requires an active worker", async () => {
  const { db } = await fixture();
  try {
    await db.query(`UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{etl}','{"processed":1,"inserted":0,"failed":1}') WHERE id=$1`, [id]);
    await assert.rejects(resume(db), /failed ETL records/);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job-'etl','{cursor,phase}','\"unknown\"') WHERE id=$1", [id]);
    await assert.rejects(resume(db), /checkpoint/);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{cursor,phase}','\"etl\"') WHERE id=$1", [id]);
    await db.exec("UPDATE cron.job SET active=false");
    await assert.rejects(resume(db), /worker/);
  } finally { await db.close(); }
});
