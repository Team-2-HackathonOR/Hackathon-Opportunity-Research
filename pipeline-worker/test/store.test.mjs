import assert from "node:assert/strict";
import { test } from "node:test";
import { PipelineStore, decryptKey, encryptKey } from "../src/store.mjs";
import { testDatabase, testEnvironment } from "./database.mjs";

test("per-run keys are encrypted, job-bound, time-limited, and erased on completion", async (t) => {
  testEnvironment(t);
  const { store, pool } = await testDatabase(t);
  const ciphertext = encryptKey("private-fixture-key", "job-a");
  assert.equal(ciphertext.includes("private-fixture-key"), false);
  assert.equal(decryptKey(ciphertext, "job-a"), "private-fixture-key");
  assert.throws(() => decryptKey(ciphertext, "job-b"));
  const tampered = Buffer.from(ciphertext, "base64");
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptKey(tampered.toString("base64"), "job-a"));
  const job = await store.create("private-fixture-key");
  assert.equal(JSON.stringify(await store.latest()).includes("private-fixture-key"), false);
  assert.equal(await store.key(job.id), "private-fixture-key");
  assert.equal(await store.create("other-key"), null);
  const restarted = new PipelineStore(pool);
  assert.equal((await restarted.latest()).id, job.id);
  await restarted.update(job.id, (value) => { value.status = "completed"; });
  assert.equal((await store.row(job.id)).key_ciphertext, null);
  await assert.rejects(() => store.key(job.id), /no longer active/);
  const next = await store.create("next-key");
  await pool.query("UPDATE pipeline_control.jobs SET key_expires_at=now()-interval '1 second' WHERE id=$1", [next.id]);
  await assert.rejects(() => store.key(next.id), /expired/);
  await store.expire();
  assert.equal((await store.row(next.id)).key_ciphertext, null);
  assert.equal((await store.latest()).status, "failed");
});

test("completed operations replay from storage; uncertain resets never repeat or permit a new run", async (t) => {
  testEnvironment(t);
  const { store, pool } = await testDatabase(t);
  const job = await store.create("fixture-key");
  let executions = 0;
  const execute = async () => { executions += 1; return { reset: true, deletedRecords: 4 }; };
  await store.operation(job.id, "reset-mongodb", execute);
  assert.deepEqual(await new PipelineStore(pool).operation(job.id, "reset-mongodb", execute),
    { reset: true, deletedRecords: 4 });
  assert.equal(executions, 1);
  await assert.rejects(() => store.operation(job.id, "reset-postgresql", async () => {
    executions += 1;
    throw new Error("Lost response after remote deletion");
  }));
  await assert.rejects(() => store.operation(job.id, "reset-postgresql", execute), /uncertain outcome/);
  assert.equal(executions, 2);
  await store.fail(job.id, "Outcome unknown.");
  assert.equal((await store.row(job.id)).key_ciphertext, null);
  assert.equal(await store.create("another-key"), null);
  // Only an operator, after checking the remote outcome, may remove the durable interlock.
  await pool.query("UPDATE pipeline_control.jobs SET blocked_until=NULL WHERE id=$1", [job.id]);
  assert.ok(await store.create("another-key"));
});

test("operation results and job status survive a failed transaction without partial updates", async (t) => {
  testEnvironment(t);
  const { store } = await testDatabase(t);
  const job = await store.create("fixture-key");
  await assert.rejects(() => store.update(job.id, (value) => {
    value.status = "completed";
    throw new Error("Injected transaction failure");
  }));
  assert.equal((await store.latest()).status, "running");
  assert.equal(await store.key(job.id), "fixture-key");
});
