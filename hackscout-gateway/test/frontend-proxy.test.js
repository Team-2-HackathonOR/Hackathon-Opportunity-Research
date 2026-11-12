const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServer } = require("node:http");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("deployed frontend forwards browser APIs while backend routes stay protected", async (t) => {
  const keys = ["AUTH_GATEWAY_URL", "GATEWAY_INTERNAL_SECRET", "PIPELINE_SCHEDULE_PATH", "VERCEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const directory = mkdtempSync(join(tmpdir(), "hackscout-proxy-"));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(directory, { recursive: true });
  });
  const seen = [];
  let upstreamStatus = 200;
  const gateway = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push({ path: request.url, headers: request.headers, body, method: request.method });
      response.writeHead(upstreamStatus, {
        "content-type": "application/json",
        "x-ratelimit-remaining": "12",
      });
      response.end(JSON.stringify({ data: [{ event_id: 1, event_name: "Test Hackathon" }], count: 1 }));
    });
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  process.env.AUTH_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.GATEWAY_INTERNAL_SECRET = "test-gateway-secret";
  process.env.PIPELINE_SCHEDULE_PATH = join(directory, "schedule.json");
  process.env.VERCEL = "1";
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test("guest listings preserve query and strip spoofed trusted headers", async () => {
    const response = await fetch(`${base}/api/hackscout/hackathons?limit=2&include=details`, {
      headers: {
        "x-gateway-secret": "spoofed", "x-gateway-caller": "team-2-gateway",
        "x-user-role": "admin", "x-user-id": "spoofed", "x-user-email": "spoofed@example.test",
      },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-ratelimit-remaining"), "12");
    assert.equal(seen.at(-1).path, "/api/hackscout/hackathons?limit=2&include=details");
    for (const header of ["x-gateway-secret", "x-gateway-caller", "x-user-role", "x-user-id", "x-user-email"]) {
      assert.equal(seen.at(-1).headers[header], undefined);
    }
  });

  await t.test("admin requests preserve bearer, JSON body and gateway rejection", async () => {
    upstreamStatus = 401;
    const body = JSON.stringify({ event: "Example", website: "https://example.test" });
    const response = await fetch(`${base}/api/hackscout/suggestions`, {
      method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal(seen.at(-1).headers.authorization, "Bearer fixture");
    assert.equal(seen.at(-1).body, body);
    upstreamStatus = 200;
  });

  await t.test("browser authentication reaches main gateway without internal credentials", async () => {
    const response = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: "Bearer fixture" },
    });
    assert.equal(response.status, 200);
    assert.equal(seen.at(-1).path, "/api/auth/me");
    assert.equal(seen.at(-1).headers.authorization, "Bearer fixture");
    assert.equal(seen.at(-1).headers["x-gateway-secret"], undefined);
  });

  await t.test("backend routes still deny direct requests and admin assets are available", async () => {
    t.mock.method(console, "warn", () => {});
    assert.equal((await fetch(`${base}/api/admin/pipeline`)).status, 403);
    assert.equal((await fetch(`${base}/api/hackathons`)).status, 403);
    assert.equal((await fetch(`${base}/hackscout-admin/`)).status, 200);
    assert.equal((await fetch(`${base}/hackscout-admin/app.js`)).status, 200);
  });

  await t.test("missing production gateway URL fails explicitly", async () => {
    t.mock.method(console, "error", () => {});
    delete process.env.AUTH_GATEWAY_URL;
    const response = await fetch(`${base}/api/hackscout/hackathons`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
    process.env.AUTH_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  });

  await t.test("self routing and forwarded loops are rejected without upstream calls", async () => {
    t.mock.method(console, "error", () => {});
    const before = seen.length;
    process.env.AUTH_GATEWAY_URL = base;
    assert.equal((await fetch(`${base}/api/hackscout/hackathons`)).status, 503);
    process.env.AUTH_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
    assert.equal((await fetch(`${base}/api/hackscout/hackathons`, {
      headers: { "x-hackscout-proxy-hop": "1" },
    })).status, 503);
    assert.equal(seen.length, before);
  });

  await t.test("network failures and redirects cannot report success", async () => {
    t.mock.method(console, "error", () => {});
    upstreamStatus = 302;
    assert.equal((await fetch(`${base}/api/hackscout/hackathons`)).status, 502);
    const originalFetch = global.fetch;
    t.mock.method(global, "fetch", async (url, options) => {
      if (String(url).startsWith(base)) return originalFetch(url, options);
      throw new TypeError("Unavailable");
    });
    assert.equal((await fetch(`${base}/api/hackscout/hackathons`)).status, 502);
  });
});
