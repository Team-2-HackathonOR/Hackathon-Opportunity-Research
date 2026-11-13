const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");
const id = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const edge = await readFile(path.join(root, "supabase/migrations/20261112180000_edge_pipeline.sql"), "utf8");
  await db.exec(edge.replace(/^CREATE EXTENSION[^;\n]*;\s*$/gm, ""));
  await db.exec(await readFile(path.join(root, "supabase/migrations/20261112200000_pipeline_cancel.sql"), "utf8"));
  await db.exec(await readFile(path.join(root, "supabase/migrations/20261112210000_pipeline_restart.sql"), "utf8"));
  await db.exec(await readFile(path.join(root, "supabase/migrations/20261113035500_pipeline_ack.sql"), "utf8"));
  const job = {
    id, status: "running", stage: "reset",
    steps: { reset: { status: "running" }, scraper: { status: "waiting" }, etl: { status: "waiting" } },
    cursor: { phase: "reset-mongodb" },
  };
  await db.query(`INSERT INTO pipeline_control.jobs
    (id,status,job,key_ciphertext,key_expires_at,executor,execution_id,execution_until)
    VALUES ($1,'running',$2,'encrypted-fixture',now()+interval '1 hour','supabase',$3,now()+interval '10 minutes')`,
  [id, JSON.stringify(job), token]);
  await db.exec(`UPDATE pipeline_control.schedule SET value='{"frequency":"weekly","nextRunAt":"2027-01-03T01:00:00Z"}'`);
  return db;
}

test("stopping an unstarted run clears its key and lease and disables automatic runs", async () => {
  const db = await fixture();
  try {
    const { rows } = await db.query("SELECT pipeline_control.cancel_edge_job($1) AS job", [id]);
    assert.equal(rows[0].job.cancelled, true);
    assert.equal(rows[0].job.status, "failed");
    assert.equal(rows[0].job.steps.reset.status, "cancelled");
    assert.equal(rows[0].job.steps.scraper.status, "skipped");
    const saved = (await db.query("SELECT status,key_ciphertext,execution_id,execution_until,blocked_until FROM pipeline_control.jobs")).rows[0];
    assert.deepEqual(saved, { status: "failed", key_ciphertext: null, execution_id: null, execution_until: null, blocked_until: null });
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "off");
    assert.equal((await db.query("SELECT pipeline_control.cancel_edge_job($1) AS job", [id])).rows[0].job, null);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.cancel_edge_job(uuid)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test("stopping an admitted operation retains its ledger and interlocks restarts and stale publishers", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'reset-mongodb','started')", [id]);
    await db.query("SELECT pipeline_control.cancel_edge_job($1)", [id]);
    const saved = (await db.query("SELECT blocked_until='infinity'::timestamptz AS blocked FROM pipeline_control.jobs")).rows[0];
    assert.equal(saved.blocked, true);
    assert.equal((await db.query("SELECT status FROM pipeline_control.operations")).rows[0].status, "started");
    assert.equal((await db.query(`UPDATE pipeline_control.jobs SET status='running'
      WHERE id=$1 AND execution_id=$2 AND status IN ('queued','running') RETURNING id`, [id, token])).rows.length, 0);
    assert.equal((await db.query(`SELECT id FROM pipeline_control.jobs
      WHERE id=$1 AND execution_id=$2 AND status IN ('queued','running') AND key_expires_at>now() FOR UPDATE`, [id, token])).rows.length, 0);
    await db.query("UPDATE pipeline_control.operations SET status='completed' WHERE job_id=$1", [id]);
    assert.equal((await db.query(`SELECT id FROM pipeline_control.jobs
      WHERE status IN ('queued','running') OR blocked_until>now()`)).rows.length, 1);
  } finally { await db.close(); }
});

test("a stale stop request cannot stop a different run or disable its schedule", async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query("SELECT pipeline_control.cancel_edge_job($1) AS job", [token])).rows[0].job, null);
    assert.equal((await db.query("SELECT status FROM pipeline_control.jobs")).rows[0].status, "running");
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "weekly");
  } finally { await db.close(); }
});

test("restart preparation and enqueue share one transaction and failed enqueue restores the old run", async () => {
  const db = await fixture();
  try {
    await db.exec("BEGIN");
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, true);
    await assert.rejects(db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ($1,'queued','{}',now()+interval '1 hour','supabase')`, [id]), /duplicate key/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT status,key_ciphertext FROM pipeline_control.jobs WHERE id=$1", [id])).rows[0],
      { status: "running", key_ciphertext: "encrypted-fixture" });
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "weekly");

    await db.exec("BEGIN");
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, true);
    await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ($1,'queued','{"cursor":{"phase":"reset-mongodb"}}',now()+interval '1 hour','supabase')`, [token]);
    await db.exec("COMMIT");
    assert.equal((await db.query("SELECT status FROM pipeline_control.jobs WHERE id=$1", [id])).rows[0].status, "failed");
    assert.equal((await db.query("SELECT status,job->'cursor'->>'phase' AS phase FROM pipeline_control.jobs WHERE id=$1", [token])).rows[0].phase, "reset-mongodb");
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "off");
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.prepare_edge_restart(uuid)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test("restart refuses in-flight operations, restart interlocks and stale run targets", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'reset-mongodb','started')", [id]);
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, false);
    assert.equal((await db.query("SELECT status FROM pipeline_control.jobs WHERE id=$1", [id])).rows[0].status, "running");
    await db.query("SELECT pipeline_control.cancel_edge_job($1)", [id]);
    await db.query("UPDATE pipeline_control.operations SET status='completed' WHERE job_id=$1", [id]);
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, false);
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [token])).rows[0].ready, false);
    assert.equal((await db.query("SELECT blocked_until='infinity'::timestamptz AS blocked FROM pipeline_control.jobs")).rows[0].blocked, true);
  } finally { await db.close(); }
});

test("a confirmed late acknowledgement releases only the cancelled run's blocker without reviving it", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'reset-storage-6','started')", [id]);
    const stopped = (await db.query("SELECT pipeline_control.cancel_edge_job($1) AS job", [id])).rows[0].job;
    const result = { reset: false, hasMore: true, deletedRecords: 100 };
    await db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "reset-storage-6", result]);
    assert.deepEqual((await db.query("SELECT job,status,blocked_until,key_ciphertext,execution_id,execution_until FROM pipeline_control.jobs")).rows[0],
      { job: stopped, status: "failed", blocked_until: null, key_ciphertext: null, execution_id: null, execution_until: null });
    assert.deepEqual((await db.query("SELECT status,result FROM pipeline_control.operations")).rows[0], { status: "completed", result });
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, true);
    await assert.rejects(db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "reset-storage-6", result]), /started operation/);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'pipeline_control.complete_edge_operation(uuid,text,jsonb)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test("late acknowledgement retains the cancellation blocker until every admitted operation is confirmed", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'first','started'),($1,'second','started')", [id]);
    await db.query("SELECT pipeline_control.cancel_edge_job($1)", [id]);
    await db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "first", { deletedRecords: 100 }]);
    assert.equal((await db.query("SELECT blocked_until='infinity'::timestamptz AS blocked FROM pipeline_control.jobs")).rows[0].blocked, true);
    assert.equal((await db.query("SELECT pipeline_control.prepare_edge_restart($1) AS ready", [id])).rows[0].ready, false);
    await db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "second", { deletedRecords: 100 }]);
    assert.equal((await db.query("SELECT blocked_until FROM pipeline_control.jobs")).rows[0].blocked_until, null);
  } finally { await db.close(); }
});

test("unconfirmed acknowledgements and non-cancelled failures never clear the interlock", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO pipeline_control.operations(job_id,name,status) VALUES ($1,'reset-storage','started')", [id]);
    await db.query(`UPDATE pipeline_control.jobs SET status='failed',blocked_until='infinity',
      key_ciphertext=NULL,execution_id=NULL,execution_until=NULL WHERE id=$1`, [id]);
    await assert.rejects(db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "reset-storage", null]), /must be an object/);
    assert.equal((await db.query("SELECT status FROM pipeline_control.operations")).rows[0].status, "started");
    await db.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [id, "reset-storage", { deletedRecords: 100 }]);
    assert.equal((await db.query("SELECT blocked_until='infinity'::timestamptz AS blocked FROM pipeline_control.jobs")).rows[0].blocked, true);
  } finally { await db.close(); }
});
