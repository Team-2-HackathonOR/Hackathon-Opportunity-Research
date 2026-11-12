const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { requireGateway } = require("../gateway-auth");
const { createAdminRouter } = require("../admin");

test("Vercel admin pipeline uses a durable worker and never starts the legacy runner", async (t) => {
  for (const [key, value] of Object.entries({
    VERCEL: "1", PIPELINE_WORKER_URL: "https://worker.example.test",
    GATEWAY_INTERNAL_SECRET: "fixture-gateway-secret",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const app = express();
  const router = createAdminRouter(() => { throw new Error("No database call expected"); });
  app.use("/api/admin", requireGateway, router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const realFetch = global.fetch;
  const seen = [];
  t.mock.method(global, "fetch", async (url, options) => {
    if (String(url).startsWith(base)) return realFetch(url, options);
    assert.equal(new URL(url).origin, "https://worker.example.test");
    assert.equal(options.headers["x-gateway-secret"], "fixture-gateway-secret");
    seen.push({ path: new URL(url).pathname, options });
    return Response.json(new URL(url).pathname === "/pipeline/run" ? { job: { id: "queued-job" } }
      : new URL(url).pathname === "/pipeline" ? { job: null } : { schedule: { frequency: "off" } });
  });
  t.mock.method(console, "error", () => {});
  const headers = {
    "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "fixture-gateway-secret",
    "x-user-id": "11111111-1111-4111-8111-111111111111", "x-user-role": "admin",
    "x-user-email": "admin@example.test", "content-type": "application/json",
  };
  assert.equal((await fetch(`${base}/pipeline`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/pipeline/run`, {
    method: "POST", headers, body: JSON.stringify({ apiKey: "private-run-key" }),
  })).status, 202);
  assert.equal((await fetch(`${base}/pipeline/schedule`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/pipeline/schedule`, {
    method: "POST", headers, body: '{"frequency":"off"}',
  })).status, 200);
  assert.deepEqual(seen.map(({ path }) => path), ["/pipeline", "/pipeline/run", "/schedule", "/schedule"]);
  assert.equal(JSON.parse(seen[1].options.body).apiKey, "private-run-key");
  delete process.env.PIPELINE_WORKER_URL;
  assert.equal((await fetch(`${base}/pipeline`, { headers })).status, 503);
  assert.equal(seen.length, 4);
});
