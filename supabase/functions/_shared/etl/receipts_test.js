import assert from "node:assert/strict";
import { receiptFixture } from "./receipt-fixture.js";
import { importPipelineRecord } from "./pipeline-import.ts";
import { createEvent } from "./writer.ts";
import { readPipelineReceipt, storePipelineReceipt, validatePipelineSource } from "./receipts.ts";
import { HttpError } from "../runtime.ts";

Deno.test("committed import response loss and fenced replay produce one event/receipt and no repeated AI/read", async () => {
  const f = await receiptFixture();
  let ai = 0, reads = 0;
  const read = async () => { reads++; return [f.raw]; };
  const normalize = async (_raw, payload) => { ai++; return payload; };
  try {
    const result = await importPipelineRecord(f.context, read, true, "fixture-key", null, null, normalize);
    // Simulate an HTTP response disappearing after the transaction committed.
    await assert.rejects(Promise.reject(new Error("post-commit response lost")), /response lost/);
    const lease = "33333333-3333-4333-8333-333333333333";
    await f.database.query("UPDATE pipeline_control.jobs SET execution_id=$1 WHERE id=$2", [lease, f.context.pipeline_job_id]);
    const replay = await importPipelineRecord({ ...f.context, pipeline_execution_id: lease },
      read, true, "", null, null, normalize);
    assert.deepEqual(replay, result);
    assert.equal(ai, 1); assert.equal(reads, 1);
    assert.equal(result.receipt_bound, true);
    assert.equal(typeof result.successes[0].event_id, "number");
    assert.equal(result.next_after_id, 820);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM hackathon_research.events")).rows[0].n, 1);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM pipeline_control.etl_receipts")).rows[0].n, 1);
    await assert.rejects(readPipelineReceipt(f.context), error => error instanceof HttpError && error.status === 409);
    await f.database.query("DELETE FROM pipeline_control.jobs WHERE id=$1", [f.context.pipeline_job_id]);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM pipeline_control.etl_receipts")).rows[0].n, 0);
  } finally { await f.close(); }
});

Deno.test("receipt commit rollback and altered source/acknowledgement refuse partial events or overwrite", async () => {
  const f = await receiptFixture();
  const write = { context: f.context, sourceId: f.raw.id, sourceIdentifier: String(f.raw.id), source: f.raw };
  try {
    await assert.rejects(createEvent({ ...f.payload, sources: [{ ...f.payload.sources[0], source_url: "invalid" }] },
      Date.now() + 20000, write), /check constraint/);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM hackathon_research.events")).rows[0].n, 0);
    assert.equal(await readPipelineReceipt(f.context), null);
    const result = await createEvent(f.payload, Date.now() + 20000, write);
    await assert.rejects(createEvent(f.payload, Date.now() + 20000, {
      ...write, source: { ...f.raw, title: "Changed source" },
    }), error => error instanceof HttpError && error.status === 409);
    await assert.rejects(f.client.begin(sql => storePipelineReceipt(sql, f.context, f.raw, {
      ...result.receipt, next_after_id: 821,
    })), error => error instanceof HttpError && error.status === 409);
    await assert.rejects(f.client.begin(sql => storePipelineReceipt(sql, f.context, f.raw, {
      ...result.receipt, provider_key: "must-not-persist",
    })), error => error instanceof HttpError && error.status === 409);
    assert.deepEqual(await readPipelineReceipt(f.context), result.receipt);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM hackathon_research.events")).rows[0].n, 1);
  } finally { await f.close(); }
});

Deno.test("invalid job, source, cursor and lease contexts are rejected before provider work", async () => {
  const f = await receiptFixture();
  let calls = 0;
  const normalize = async (_raw, payload) => { calls++; return payload; };
  const denied = error => error instanceof HttpError && error.status === 409;
  try {
    for (const context of [
      { ...f.context, pipeline_job_id: "44444444-4444-4444-8444-444444444444" },
      { ...f.context, pipeline_execution_id: "44444444-4444-4444-8444-444444444444" },
      { ...f.context, pipeline_operation: "etl-820" }, { ...f.context, after_id: 800 },
      { ...f.context, fetched_at: "2026-11-13T21:00:00.000Z" },
    ]) await assert.rejects(importPipelineRecord(context, async () => [f.raw], true, "fixture", null, null, normalize), denied);
    for (const raw of [{ ...f.raw, id: 821 }, { ...f.raw, title: "Changed raw" },
      { ...f.raw, fetchedAt: "2026-11-13T21:00:00.000Z" }]) {
      await assert.rejects(importPipelineRecord(f.context, async () => [raw], true, "fixture", null, null, normalize), denied);
    }
    for (const update of ["execution_until=now()-interval '1 second'", "key_expires_at=now()-interval '1 second'",
      "executor='vercel'", "status='failed'", "key_ciphertext=NULL"]) {
      await f.database.exec(`UPDATE pipeline_control.jobs SET ${update}`);
      await assert.rejects(readPipelineReceipt(f.context), denied);
      await f.database.exec(`UPDATE pipeline_control.jobs SET execution_until=now()+interval '10 minutes',
        key_expires_at=now()+interval '1 day',executor='supabase',status='running',key_ciphertext='fixture'`);
    }
    await f.database.exec("UPDATE pipeline_control.staging_index SET confirmed=false");
    await assert.rejects(validatePipelineSource(f.context, f.raw), denied);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

Deno.test("terminal receipts are replayable and provider503 failures never become record ACKs", async () => {
  const f = await receiptFixture();
  try {
    await assert.rejects(importPipelineRecord(f.context, async () => [f.raw], true, "fixture", null, null,
      async () => { throw new HttpError(503, "Provider unavailable"); }), error => error.status === 503);
    assert.equal(await readPipelineReceipt(f.context), null);
    await assert.rejects(importPipelineRecord(f.context, async () => [], false, "", null, null), error => error.status === 409);
    await f.database.exec("DELETE FROM pipeline_control.staging_index");
    const result = await importPipelineRecord(f.context, async () => [], false, "", null, null);
    assert.equal(result.processed_count, 0); assert.equal(result.receipt_bound, true);
    assert.deepEqual(await importPipelineRecord(f.context, async () => { throw Error("Must not read"); },
      true, "", null, null), result);
    assert.equal((await f.database.query("SELECT count(*)::int n FROM hackathon_research.events")).rows[0].n, 0);
  } finally { await f.close(); }
});

Deno.test("BIGINT event IDs outside the JSON safe-integer range roll back instead of losing precision", async () => {
  const f = await receiptFixture();
  try {
    await f.database.exec("ALTER SEQUENCE hackathon_research.events_event_id_seq RESTART WITH 9007199254740992");
    await assert.rejects(createEvent(f.payload, Date.now() + 20000, {
      context: f.context, sourceId: f.raw.id, sourceIdentifier: String(f.raw.id), source: f.raw,
    }), error => error.code === "ETL_EVENT_ID_INVALID" && error.disposition === "pause");
    assert.equal((await f.database.query("SELECT count(*)::int n FROM hackathon_research.events")).rows[0].n, 0);
    assert.equal(await readPipelineReceipt(f.context), null);
  } finally { await f.close(); }
});
