const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");
const old = "11111111-1111-4111-8111-111111111111";
const clear = "22222222-2222-4222-8222-222222222222";
const token = "33333333-3333-4333-8333-333333333333";

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const edge = await readFile(path.join(root, "supabase/migrations/20261112180000_edge_pipeline.sql"), "utf8");
  await db.exec(edge.replace(/^CREATE EXTENSION[^;\n]*;\s*$/gm, ""));
  await db.exec(`CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text,active boolean);
    INSERT INTO cron.job VALUES ('hackscout-edge-tick',true);
    CREATE SCHEMA hackathon_research; CREATE TABLE hackathon_research.events(id int);
    INSERT INTO hackathon_research.events VALUES (1);
    CREATE TABLE public.preserved_accounts(id int); INSERT INTO public.preserved_accounts VALUES (1);
    UPDATE pipeline_control.schedule SET value='{"frequency":"weekly","nextRunAt":"2027-01-03T01:00:00Z"}';`);
  await db.exec(await readFile(path.join(root, "supabase/migrations/20261113140000_pipeline_clear.sql"), "utf8"));
  await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
    VALUES ($1,'failed','{}',now(),'supabase')`, [old]);
  await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
    VALUES ($1,'reset-storage','completed','{"reset":true}')`, [old]);
  return db;
}
const enqueue = (db, expected = old) => db.query("SELECT pipeline_control.enqueue_edge_clear($1,$2) AS job", [clear, expected]);
const finish = (db, lease = token) => db.query("SELECT pipeline_control.finish_edge_clear($1,$2) AS cleared", [clear, lease]);
async function claim(db) {
  await db.query(`UPDATE pipeline_control.jobs SET status='running',execution_id=$2,
    execution_until=now()+interval '10 minutes',job=jsonb_set(job,'{cursor,phase}','"reset-postgresql"')
    WHERE id=$1`, [clear, token]);
}
async function acknowledge(db, name, result = { reset: true }) {
  await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
    VALUES ($1,$2,'completed',$3)`, [clear, name, result]);
}

test("Clear all queues keyless cleanup, disables automatic runs, and keeps history/data until cleanup is confirmed", async () => {
  const db = await fixture();
  try {
    const job = (await enqueue(db)).rows[0].job;
    assert.equal(job.purpose, "clear");
    assert.equal(job.cursor.phase, "reset-storage");
    assert.equal(job.steps.scraper.status, "skipped");
    assert.equal(job.steps.etl.status, "skipped");
    assert.equal((await db.query("SELECT key_ciphertext FROM pipeline_control.jobs WHERE id=$1", [clear])).rows[0].key_ciphertext, null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.operations")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events")).rows[0].n, 1);
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "off");
    for (const role of ["anon", "authenticated"]) for (const fn of ["enqueue_edge_clear", "finish_edge_clear"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
        [role, `pipeline_control.${fn}(uuid,uuid)`])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test("Clear all rejects stale displays, active jobs, leases, blockers and unknown outcomes anywhere in history", async () => {
  const db = await fixture();
  try {
    await assert.rejects(enqueue(db, null), /history changed/);
    await db.query("UPDATE pipeline_control.jobs SET status='running' WHERE id=$1", [old]);
    await assert.rejects(enqueue(db), /Stop the active/);
    await db.query("UPDATE pipeline_control.jobs SET status='failed',execution_until=now()-interval '1 hour' WHERE id=$1", [old]);
    await assert.rejects(enqueue(db), /lease/);
    await db.query("UPDATE pipeline_control.jobs SET execution_until=NULL,blocked_until='infinity' WHERE id=$1", [old]);
    await assert.rejects(enqueue(db), /blocked/);
    await db.query("UPDATE pipeline_control.jobs SET blocked_until=NULL WHERE id=$1", [old]);
    await db.query("UPDATE pipeline_control.operations SET status='started',result=NULL");
    await assert.rejects(enqueue(db), /no confirmed outcome/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 1);
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "weekly");
  } finally { await db.close(); }
});

test("Clear all also works with empty history but never queues against a paused worker", async () => {
  const db = await fixture();
  try {
    await db.exec("DELETE FROM pipeline_control.operations; DELETE FROM pipeline_control.jobs; UPDATE cron.job SET active=false;");
    await assert.rejects(enqueue(db, null), /worker/);
    await db.exec("UPDATE cron.job SET active=true");
    assert.equal((await enqueue(db, null)).rows[0].job.purpose, "clear");
  } finally { await db.close(); }
});

test("Clear all removes all run/operation history only after both cleanups and a valid current lease", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    await assert.rejects(finish(db), /lease or checkpoint/);
    await claim(db);
    await assert.rejects(finish(db, old), /lease or checkpoint/);
    await assert.rejects(finish(db), /confirmed Storage and PostgreSQL/);
    await acknowledge(db, "reset-storage-94");
    await assert.rejects(finish(db), /confirmed Storage and PostgreSQL/);
    await acknowledge(db, "reset-postgresql");
    await assert.rejects(finish(db), /Event listings changed/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 2);
    await db.exec("DELETE FROM hackathon_research.events");
    assert.equal((await finish(db)).rows[0].cleared, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.operations")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.preserved_accounts")).rows[0].n, 1);
    assert.deepEqual((await db.query("SELECT value FROM pipeline_control.schedule")).rows[0].value, { frequency: "off", nextRunAt: null });
  } finally { await db.close(); }
});

test("Clear all preserves all ledger entries if a new unconfirmed operation appears before finalization", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    await claim(db);
    await acknowledge(db, "reset-storage");
    await acknowledge(db, "reset-postgresql");
    await db.exec("DELETE FROM hackathon_research.events");
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'uncertain','started')", [old]);
    await assert.rejects(finish(db), /unconfirmed operation/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.jobs")).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.operations")).rows[0].n, 4);
  } finally { await db.close(); }
});
