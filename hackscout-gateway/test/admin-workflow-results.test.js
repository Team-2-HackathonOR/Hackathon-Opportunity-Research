const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAdminHarness, adminUser, validEvent, json } = require("./admin-test-helpers");

test("admin moderation result workflow", async (t) => {
  const { scenario } = await createAdminHarness(t);
  await scenario("rejection preserves review notes without event publication",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      const body = JSON.parse(options.body);
      assert.equal(body.decision, "rejected");
      assert.equal(body.notes, "Duplicate submission.");
      assert.deepEqual(body.event_details, {});
      return json({ id: "2", status: "rejected", published_event_id: null });
    }, async (request) => {
      assert.equal((await request("suggestions/2/review", {
        method: "POST", body: { decision: "rejected", notes: "Duplicate submission." },
      })).status, 200);
    });
  await scenario("concurrent/already-reviewed submissions return conflict",
    (url) => url.pathname === "/api/auth/me" ? json(adminUser) : json({ code: "P0001" }, 400),
    async (request) => {
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "approved", event: validEvent },
      })).status, 409);
    });
  await scenario("missing submission returns not found",
    (url) => url.pathname === "/api/auth/me" ? json(adminUser) : json({ code: "P0002" }, 400),
    async (request) => {
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "rejected", notes: "Reject" },
      })).status, 404);
    });
  await scenario("duplicate publication returns a conflict",
    (url) => url.pathname === "/api/auth/me" ? json(adminUser) : json({ code: "23505" }, 409),
    async (request) => {
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "approved", event: validEvent },
      })).status, 409);
    });
  await scenario("missing migration and malformed publication result are not success",
    (url) => url.pathname === "/api/auth/me" ? json(adminUser) : json({ code: "PGRST202" }, 404),
    async (request) => {
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "approved", event: validEvent },
      })).status, 502);
    });
  await scenario("approval without a published event ID cannot report success",
    (url) => url.pathname === "/api/auth/me" ? json(adminUser) : json({ status: "approved" }),
    async (request) => {
      assert.equal((await request("suggestions/1/review", {
        method: "POST", body: { decision: "approved", event: validEvent },
      })).status, 502);
    });
  await scenario("logout revokes the current JWT session",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      assert.equal(url.pathname, "/api/auth/logout");
      assert.equal(options.headers.authorization, "Bearer valid-admin");
      return json({ status: "ok" });
    }, async (request) => {
      assert.equal((await request("logout", { method: "POST", body: {} })).status, 200);
    }); });
