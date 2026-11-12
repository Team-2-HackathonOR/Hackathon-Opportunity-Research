const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAdminHarness, adminUser, validEvent, json } = require("./admin-test-helpers");
const { readFileSync } = require("node:fs");

test("admin authentication workflow", async (t) => {
  const { scenario, storePath } = await createAdminHarness(t);
  await scenario("anonymous requests are denied without touching the database",
    () => { throw new Error("Unexpected upstream request"); }, async (request) => {
      const result = await request("suggestions", { authorization: "" });
      assert.equal(result.status, 401);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal((await request("scraper/run", {
        method: "POST", authorization: "", body: { apiKey: "run-only-key" },
      })).status, 401);
      assert.equal((await request("pipeline/run", {
        method: "POST", authorization: "", body: { apiKey: "run-only-key" },
      })).status, 401);
      assert.equal((await request("pipeline/schedule", { authorization: "" })).status, 401);
      assert.equal((await request("pipeline/schedule", {
        method: "POST", authorization: "", body: { frequency: "weekly" },
      })).status, 401);
    });
  await scenario("admin schedules persist only cadence and never manual API keys",
    () => json(adminUser), async (request) => {
      const previousKey = process.env.AI_API_KEY;
      try {
        delete process.env.AI_API_KEY;
        assert.equal((await request("pipeline/schedule")).body.schedule.keyConfigured, false);
        assert.equal((await request("pipeline/schedule", {
          method: "POST", body: { frequency: "weekly" },
        })).status, 400);
        process.env.AI_API_KEY = "server-key-fixture";
        assert.equal((await request("pipeline/schedule", {
          method: "POST", body: { frequency: "daily" },
        })).status, 400);
        const saved = await request("pipeline/schedule", {
          method: "POST", body: { frequency: "monthly", apiKey: "manual-key-fixture" },
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.schedule.frequency, "monthly");
        assert.equal(saved.body.schedule.timeZone, "Europe/Rome");
        assert.equal((await request("pipeline/schedule")).body.schedule.nextRunAt, saved.body.schedule.nextRunAt);
        assert.equal(/server-key-fixture|manual-key-fixture/.test(readFileSync(storePath, "utf8")), false);
        assert.equal((await request("pipeline/schedule", {
          method: "POST", body: { frequency: "off" },
        })).body.schedule.nextRunAt, null);
      } finally {
        if (previousKey === undefined) delete process.env.AI_API_KEY;
        else process.env.AI_API_KEY = previousKey;
      }
    });
  await scenario("viewer cannot read or moderate submissions",
    () => json({ ...adminUser, role: "viewer" }), async (request) => {
      assert.equal((await request("suggestions")).status, 403);
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "rejected", notes: "Reject" },
      })).status, 403);
      assert.equal((await request("pipeline/run", {
        method: "POST", body: { apiKey: "run-only-key" },
      })).status, 403);
    });
  await scenario("expired tokens and unavailable auth fail closed",
    () => json({ error: "expired" }, 401), async (request) => {
      assert.equal((await request("suggestions")).status, 401);
    });
  await scenario("auth network failure is an explicit service error",
    () => { throw new Error("Offline"); }, async (request) => {
      assert.equal((await request("suggestions")).status, 502);
    });
  await scenario("pipeline session verification is a bodyless GET without a JSON content type",
    (url, options) => {
      assert.equal(url.pathname, "/api/auth/me");
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.headers["Content-Type"], undefined);
      return json(adminUser);
    }, async (request) => {
      const result = await request("pipeline");
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { job: null });
    });
  await scenario("pipeline authentication errors identify the failing upstream status and route",
    () => new Response("Deployment unavailable", { status: 404 }), async (request) => {
      const result = await request("pipeline");
      assert.equal(result.status, 502);
      assert.match(result.body.error, /HTTP 404 for \/api\/auth\/me/);
      assert.match(result.body.error, /AUTH_GATEWAY_URL/);
      assert.doesNotMatch(result.body.error, /Deployment unavailable/);
    });
  await scenario("admin login uses existing gateway and re-verifies token",
    (url, options) => {
      if (url.pathname === "/api/auth/login") {
        assert.deepEqual(JSON.parse(options.body), { email: "admin@example.test", password: "password-fixture" });
        return json({ token: "issued-admin-token" });
      }
      assert.equal(url.pathname, "/api/auth/me");
      assert.equal(options.headers.authorization, "Bearer issued-admin-token");
      return json(adminUser);
    }, async (request) => {
      const result = await request("login", {
        method: "POST", authorization: "", body: { email: "admin@example.test", password: "password-fixture" },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.role, "admin");
      assert.equal(result.body.token, "issued-admin-token");
    });
  let revoked = false;
  await scenario("non-admin login revokes issued token and denies access",
    (url) => {
      if (url.pathname === "/api/auth/login") return json({ token: "viewer-token" });
      if (url.pathname === "/api/auth/logout") { revoked = true; return json({ status: "ok" }); }
      return json({ ...adminUser, role: "viewer" });
    }, async (request) => {
      assert.equal((await request("login", {
        method: "POST", authorization: "", body: { email: "viewer@example.test", password: "password-fixture" },
      })).status, 403);
      assert.equal(revoked, true);
    });
 });
