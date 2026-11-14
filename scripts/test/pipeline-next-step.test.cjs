const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { fixture, pause, id, lease, clear, raw } = require("./pipeline-dead-letter-fixture.cjs");

const pageResult = (count = 1) => ({
  persisted: true, fetchedAt: raw.fetchedAt, pagesPersisted: 1,
  runUniqueHackathonsPersisted: count, paginationAnalysis: { totalPages: 99 },
});
async function stoppedScraper() {
  const { db, job } = await fixture();
  await db.exec(await readFile(path.join(__dirname, "..", "..", "supabase", "migrations",
    "20261113220300_pipeline_next_step.sql"), "utf8"));
  await pause(db);
  const stopped = {
    ...job, status: "failed", cancelled: true, stage: "scraper", error: "Stopped by administrator.",
    cursor: { phase: "scraper", page: 2, afterId: null },
    scraper: { pagesPersisted: 1, uniqueHackathonsPersisted: 1 },
    steps: { reset: { status: "completed" }, scraper: { status: "cancelled", startedAt: raw.fetchedAt }, etl: { status: "skipped" } },
  };
  delete stopped.etl;
  await db.query("UPDATE pipeline_control.jobs SET job=$2,key_ciphertext=NULL WHERE id=$1", [id, stopped]);
  await db.query("DELETE FROM pipeline_control.operations WHERE job_id=$1", [id]);
  await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result) VALUES
    ($1,'reset-storage','completed','{"reset":true}'),($1,'reset-postgresql','completed','{"reset":true}'),
    ($1,'scrape-1','completed',$2)`, [id, pageResult()]);
  await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.objects(record jsonb);");
  await db.query("INSERT INTO storage.objects VALUES ($1)", [raw]);
  return { db, stopped };
}
const advance = (db, count = 1, timestamp = raw.fetchedAt) =>
  db.query("SELECT pipeline_control.advance_edge_job_to_etl($1,$2,$3,$4) AS job", [id, "fresh-encrypted-fixture", timestamp, count]);

test("Go to next step queues ETL on the same stopped run, preserves data/ledger and records intentional early completion", async () => {
  const { db, stopped } = await stoppedScraper();
  try {
    const saved = (await advance(db)).rows[0].job;
    assert.equal(saved.id, stopped.id);
    assert.equal(saved.startedAt, stopped.startedAt);
    assert.equal(saved.cursor.phase, "etl");
    assert.equal(saved.cursor.afterId, null);
    assert.equal(saved.status, "queued");
    assert.equal(saved.cancelled, undefined);
    assert.equal(saved.error, undefined);
    assert.equal(saved.scraper.endedEarly, true);
    assert.equal(saved.scraper.uniqueHackathonsPersisted, 1);
    assert.equal(saved.steps.reset.status, "completed");
    assert.equal(saved.steps.scraper.status, "skipped");
    assert.equal(saved.steps.etl.status, "waiting");
    assert.equal(saved.advanceHistory[0].recordsRetained, 1);
    assert.deepEqual(saved.advanceHistory[0].previousCheckpoint, stopped.cursor);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pipeline_control.operations")).rows[0].n, 3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events")).rows[0].n, 1);
    assert.deepEqual((await db.query("SELECT record FROM storage.objects")).rows[0].record, raw);
    assert.equal((await db.query("SELECT key_ciphertext FROM pipeline_control.jobs WHERE id=$1", [id])).rows[0].key_ciphertext, "fresh-encrypted-fixture");
    await pause(db);
    const resumed = (await db.query("SELECT pipeline_control.resume_edge_job($1,$2) AS job", [id, "another-encrypted-fixture"])).rows[0].job;
    assert.equal(resumed.steps.scraper.status, "skipped");
    assert.equal(resumed.scraper.endedEarly, true);
  } finally { await db.close(); }
});

test("a page completed after Stop is reconciled from its acknowledgement rather than losing the new staged records", async () => {
  const { db } = await stoppedScraper();
  try {
    await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
      VALUES ($1,'scrape-2','completed',$2)`, [id, pageResult(2)]);
    await db.query("INSERT INTO storage.objects VALUES ($1)", [{ ...raw, id: 403 }]);
    const saved = (await advance(db, 2)).rows[0].job;
    assert.equal(saved.scraper.pagesPersisted, 2);
    assert.equal(saved.scraper.uniqueHackathonsPersisted, 2);
    assert.equal(saved.advanceHistory[0].confirmedPage, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage.objects")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("unknown operations, active leases, blockers and newer jobs prevent advancement without changing the stopped run", async () => {
  const { db, stopped } = await stoppedScraper();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'scrape-2','started')", [id]);
    await assert.rejects(advance(db), /no confirmed outcome/);
    await db.query("DELETE FROM pipeline_control.operations WHERE name='scrape-2'");
    await db.query("UPDATE pipeline_control.jobs SET execution_id=$2,execution_until=now()+interval '1 minute' WHERE id=$1", [id, lease]);
    await assert.rejects(advance(db), /lease/);
    await db.query("UPDATE pipeline_control.jobs SET execution_id=NULL,execution_until=NULL,blocked_until='infinity' WHERE id=$1", [id]);
    await assert.rejects(advance(db), /blocked/);
    await db.query("UPDATE pipeline_control.jobs SET blocked_until=NULL WHERE id=$1", [id]);
    await db.query("INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor) VALUES ($1,'failed','{}',now(),'supabase')", [clear]);
    await assert.rejects(advance(db), /latest/);
    assert.deepEqual((await db.query("SELECT job FROM pipeline_control.jobs WHERE id=$1", [id])).rows[0].job, stopped);
  } finally { await db.close(); }
});

test("incomplete cleanup, mismatched source counts/timestamps, missing acknowledgements and paused cron cannot be skipped", async () => {
  const { db } = await stoppedScraper();
  try {
    await assert.rejects(advance(db, 2), /staged|acknowledgement/);
    await assert.rejects(advance(db, 9999), /bounded/);
    await assert.rejects(advance(db, 1, "2020-01-01T00:00:00.000Z"), /timestamp|checkpoint/);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{steps,reset,status}','\"cancelled\"') WHERE id=$1", [id]);
    await assert.rejects(advance(db), /cleanup|reset/);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job,'{steps,reset,status}','\"completed\"') WHERE id=$1", [id]);
    await db.query("DELETE FROM pipeline_control.operations WHERE name='reset-postgresql'");
    await assert.rejects(advance(db), /cleanup|reset/);
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status,result) VALUES ($1,'reset-postgresql','completed','{\"reset\":true}')", [id]);
    await db.exec("DELETE FROM pipeline_control.operations WHERE name='scrape-1'");
    await assert.rejects(advance(db), /confirmed.*page/);
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status,result) VALUES ($1,'scrape-1','completed',$2)", [id, pageResult()]);
    await db.exec("UPDATE cron.job SET active=false");
    await assert.rejects(advance(db), /worker/);
  } finally { await db.close(); }
});

test("only administrator-controlled stopped scraping checkpoints can advance, not ordinary failures or ETL/reset stages", async () => {
  const { db } = await stoppedScraper();
  try {
    await db.query("UPDATE pipeline_control.jobs SET job=job-'cancelled' WHERE id=$1", [id]);
    await assert.rejects(advance(db), /stopped scraper/);
    await db.query("UPDATE pipeline_control.jobs SET job=jsonb_set(job || '{\"cancelled\":true}','{cursor,phase}','\"etl\"') WHERE id=$1", [id]);
    await assert.rejects(advance(db), /stopped scraper/);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.advance_edge_job_to_etl(uuid,text,text,integer)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});
