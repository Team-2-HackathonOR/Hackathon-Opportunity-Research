import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerApp, dispatch } from "../src/index.mjs";
import { testDatabase, testEnvironment } from "./database.mjs";

const headers = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };
async function serve(t, store, launch) {
  const server = createWorkerApp(() => store, launch).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options = {}) => fetch(base + path, { ...options, headers: { ...headers, ...options.headers } });
}

test("enqueue returns immediately with only a job ID in durable workflow inputs and survives lost acknowledgements", async (t) => {
  testEnvironment(t);
  const { store } = await testDatabase(t);
  let calls = 0;
  const request = await serve(t, store, async (_workflow, args, options) => {
    calls += 1;
    assert.equal(args.length, 1);
    assert.match(args[0], /^[a-f0-9-]{36}$/);
    assert.equal(options.experimental_hook.token, `pipeline-${args[0]}`);
    return { runId: "workflow-fixture" };
  });
  assert.equal((await request("/pipeline", { headers: { "x-gateway-secret": "" } })).status, 403);
  const response = await request("/pipeline/run", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "private-fixture" }),
  });
  assert.equal(response.status, 202);
  const { job } = await response.json();
  assert.equal(calls, 1);
  assert.equal((await store.row(job.id)).workflow_id, "workflow-fixture");
  assert.equal(JSON.stringify(job).includes("private-fixture"), false);
  assert.equal((await request("/pipeline")).headers.get("cache-control"), "no-store");
  assert.equal((await request("/pipeline/run", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"apiKey":"other-key"}',
  })).status, 409);
  await dispatch(store, job.id, async () => {
    const error = new Error("Already admitted");
    error.name = "HookConflictError";
    error.conflictingRunId = "workflow-fixture";
    throw error;
  });
  assert.equal((await store.row(job.id)).workflow_id, "workflow-fixture");
});

test("cron recovers unacknowledged starts, and schedules persist without credentials", async (t) => {
  testEnvironment(t);
  const previous = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous; });
  const { store, pool } = await testDatabase(t);
  let launches = 0;
  const request = await serve(t, store, async () => ({ runId: `workflow-${++launches}` }));
  const scheduleRequest = (frequency) => request("/schedule", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frequency }),
  });
  assert.equal((await scheduleRequest("weekly")).status, 400);
  process.env.AI_API_KEY = "server-fixture-key";
  assert.equal((await scheduleRequest("weekly")).status, 200);
  const { rows } = await pool.query("SELECT value FROM pipeline_control.schedule");
  assert.equal(JSON.stringify(rows).includes("server-fixture-key"), false);
  const job = await store.create("manual-fixture-key");
  assert.equal((await request("/cron")).status, 403);
  const cron = await request("/cron", { headers: { authorization: "Bearer fixture-cron-secret" } });
  assert.equal(cron.status, 200);
  assert.equal((await store.row(job.id)).workflow_id, "workflow-1");
  await store.fail(job.id, "Completed recovery test.");
  await pool.query("UPDATE pipeline_control.schedule SET value=$1", [{
    frequency: "weekly", nextRunAt: "2026-01-04T01:00:00.000Z",
  }]);
  const scheduled = await request("/cron", { headers: { authorization: "Bearer fixture-cron-secret" } });
  assert.equal(scheduled.status, 200);
  const latest = await store.latest();
  assert.notEqual(latest.id, job.id);
  assert.equal(await store.key(latest.id), "server-fixture-key");
  assert.equal((await store.row(latest.id)).workflow_id, "workflow-2");
  const nextSchedule = (await pool.query("SELECT value FROM pipeline_control.schedule")).rows[0].value;
  assert.ok(Date.parse(nextSchedule.nextRunAt) > Date.now());
  assert.ok(nextSchedule.lastTriggeredAt);
});
