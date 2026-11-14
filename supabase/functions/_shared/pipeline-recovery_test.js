import assert from "node:assert/strict";
import { receiptFixture } from "./etl/receipt-fixture.js";
import { handleOperationFailure, retryDelay, RetryScheduled } from "./pipeline-retry.ts";
import { HttpError, PipelineFailure } from "./runtime.ts";
import { executeOperation } from "./operation.ts";

async function fixture(name = "scrape-1", fenced = false) {
  const f = await receiptFixture();
  await f.database.exec(`ALTER TABLE pipeline_control.jobs ADD blocked_until timestamptz;
    ALTER TABLE pipeline_control.operations ADD result jsonb;
    CREATE TABLE pipeline_control.schedule(singleton boolean,value jsonb);
    INSERT INTO pipeline_control.schedule VALUES(true,'{"frequency":"weekly"}');`);
  await f.database.exec(await Deno.readTextFile(new URL("../../migrations/20261113220600_pipeline_recovery.sql", import.meta.url)));
  await f.database.query("UPDATE pipeline_control.operations SET name=$1", [name]);
  const job = { startedAt: f.context.fetched_at, stage: "scraper", status: "running",
    steps: { scraper: { status: "retrying" } }, cursor: { phase: "scraper", page: 1, afterId: null },
    ...(fenced ? { etlReceiptVersion: 1 } : {}) };
  await f.database.query("UPDATE pipeline_control.jobs SET job=$1", [job]);
  return { ...f, name, row: { id: f.context.pipeline_job_id, execution_id: f.context.pipeline_execution_id, job } };
}
const saved = async f => (await f.database.query("SELECT * FROM pipeline_control.operations")).rows[0];
const transient = () => new PipelineFailure(503, "SOURCE_TIMEOUT", "retry", "Source timed out before persistence.");

Deno.test("safe source failure preserves cursor/key and schedules bounded backoff with audited attempts", async () => {
  const f = await fixture();
  try {
    const before = Date.now();
    await assert.rejects(handleOperationFailure(f.row, f.name, transient()), error => {
      assert.ok(error instanceof RetryScheduled);
      assert.equal(error.checkpoint.attempt, 1);
      assert.equal(error.checkpoint.maxAttempts, 4);
      assert.ok(Date.parse(error.checkpoint.nextAttemptAt) >= before + 5000);
      return true;
    });
    const operation = await saved(f);
    assert.equal(operation.status, "started"); assert.equal(operation.replay_safe, true);
    const job = (await f.database.query("SELECT job,key_ciphertext FROM pipeline_control.jobs")).rows[0];
    assert.deepEqual(job.job.cursor, f.row.job.cursor);
    assert.equal(job.key_ciphertext, "fixture-ciphertext");
    assert.equal((await f.database.query("SELECT count(*)::int n FROM pipeline_control.operation_attempts")).rows[0].n, 1);
    assert.deepEqual([1, 2, 3].map(n => retryDelay(n)), [5000, 10000, 20000]);
    assert.equal(retryDelay(1, 999999), 60000);
  } finally { await f.close(); }
});

Deno.test("four-attempt exhaustion and provider authentication produce explicit replay-safe negative outcomes", async () => {
  const f = await fixture();
  try {
    await f.database.exec("UPDATE pipeline_control.operations SET attempts=4");
    await assert.rejects(handleOperationFailure(f.row, f.name, transient()), error => error.code === "SOURCE_TIMEOUT");
    let operation = await saved(f);
    assert.equal(operation.status, "completed"); assert.equal(operation.result.outcome, "confirmed-failure");
    assert.equal(operation.replay_safe, true); assert.equal(operation.next_attempt_at, null);
    await f.database.exec("UPDATE pipeline_control.operations SET status='started',attempts=1,result=NULL,replay_safe=false");
    await assert.rejects(handleOperationFailure(f.row, f.name,
      new PipelineFailure(503, "AI_PROVIDER_REJECTED", "pause", "Provider credentials rejected.")),
    error => error.code === "AI_PROVIDER_REJECTED");
    operation = await saved(f);
    assert.equal(operation.status, "completed"); assert.equal(operation.result.disposition, "pause");
  } finally { await f.close(); }
});

Deno.test("unknown scraper mutations remain interlocked and a stale lease cannot record recovery", async () => {
  const f = await fixture();
  try {
    assert.equal(await handleOperationFailure(f.row, f.name, new Error("response lost")), undefined);
    assert.equal((await saved(f)).status, "started");
    assert.equal((await saved(f)).replay_safe, false);
    await f.database.exec("UPDATE pipeline_control.jobs SET execution_until=now()-interval '1 second'");
    await assert.rejects(handleOperationFailure(f.row, f.name, transient()), error => error instanceof HttpError && error.status === 409);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM pipeline_control.operation_attempts")).rows[0].n, 0);
  } finally { await f.close(); }
});

Deno.test("lost responses recover exact acknowledgements/ETL receipts instead of repeating mutations", async () => {
  const f = await fixture("etl-first", true);
  const acknowledgement = { receipt_bound: true, processed_count: 1 };
  try {
    await f.database.query(`INSERT INTO pipeline_control.etl_receipts
      (job_id,operation_name,fetched_at,source_hash,acknowledgement) VALUES($1,$2,$3,'fixture',$4)`,
    [f.row.id, f.name, f.context.fetched_at, acknowledgement]);
    assert.deepEqual(await handleOperationFailure(f.row, f.name, new Error("response lost")), acknowledgement);
    await f.database.query("UPDATE pipeline_control.operations SET status='completed',result=$1", [acknowledgement]);
    assert.deepEqual(await handleOperationFailure(f.row, f.name, transient()), acknowledgement);
    let executions = 0, completions = 0;
    assert.deepEqual(await executeOperation(f.name, {
      start: async () => true, read: async () => undefined,
      complete: async () => { if (++completions === 1) throw Error("ACK response lost"); },
      onFailure: error => handleOperationFailure(f.row, f.name, error),
    }, async () => { executions++; return acknowledgement; }, value => value?.receipt_bound === true), acknowledgement);
    assert.equal(executions, 1); assert.equal(completions, 2);
  } finally { await f.close(); }
});

Deno.test("operation ACK replay is idempotent but changed acknowledgements are refused", async () => {
  const f = await fixture();
  const complete = ack => f.database.query("SELECT pipeline_control.complete_edge_operation($1,$2,$3)", [f.row.id, f.name, ack]);
  try {
    await complete({ persisted: true }); await complete({ persisted: true });
    await assert.rejects(complete({ persisted: false }), /acknowledgement changed/);
    assert.deepEqual((await saved(f)).result, { persisted: true });
  } finally { await f.close(); }
});

Deno.test("Stop reconciles a nonexecuting safe retry but retains an executing unknown scraper blocker", async () => {
  const f = await fixture();
  const cancel = () => f.database.query("SELECT pipeline_control.cancel_edge_job($1) AS job", [f.row.id]);
  try {
    await handleOperationFailure(f.row, f.name, transient()).catch(error => {
      assert.ok(error instanceof RetryScheduled);
    });
    await f.database.exec("UPDATE pipeline_control.jobs SET execution_id=NULL,execution_until=NULL");
    await cancel();
    assert.equal((await saved(f)).result.code, "OPERATION_STOPPED");
    assert.equal((await f.database.query("SELECT blocked_until,key_ciphertext FROM pipeline_control.jobs")).rows[0].blocked_until, null);
    await f.database.exec(`UPDATE pipeline_control.jobs SET status='running';
      UPDATE pipeline_control.operations SET status='started',replay_safe=false,result=NULL`);
    await cancel();
    assert.equal((await saved(f)).status, "started");
    assert.ok((await f.database.query("SELECT blocked_until IS NOT NULL AS blocked FROM pipeline_control.jobs")).rows[0].blocked);
  } finally { await f.close(); }
});

Deno.test("Stop fences ETL and reconciles a saved receipt without reviving the stopped run", async () => {
  const f = await fixture("etl-first", true);
  try {
    const acknowledgement = { receipt_bound: true, processed_count: 1 };
    await f.database.query(`INSERT INTO pipeline_control.etl_receipts
      (job_id,operation_name,fetched_at,source_hash,acknowledgement) VALUES($1,$2,$3,'fixture',$4)`,
    [f.row.id, f.name, f.context.fetched_at, acknowledgement]);
    await f.database.query("SELECT pipeline_control.cancel_edge_job($1)", [f.row.id]);
    assert.deepEqual((await saved(f)).result, acknowledgement);
    const job = (await f.database.query("SELECT status,key_ciphertext,blocked_until FROM pipeline_control.jobs")).rows[0];
    assert.equal(job.status, "failed"); assert.equal(job.key_ciphertext, null); assert.equal(job.blocked_until, null);
    await assert.rejects(f.database.query("SELECT pipeline_control.etl_import_context($1,$2,$3,$4,NULL)",
      [f.row.id, f.name, f.row.execution_id, f.context.fetched_at]), /Invalid ETL pipeline context/);
  } finally { await f.close(); }
});
