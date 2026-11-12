const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAdminHarness, adminUser, validEvent, json } = require("./admin-test-helpers");

test("admin scraper workflow", async (t) => {
  const { scenario } = await createAdminHarness(t);
  await scenario("admin scraper action forwards the run-only key and returns a safe summary",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      assert.equal(url.href, "http://scraper.test/api/internal/scraper/hackathons/persist-all?startPage=1");
      assert.equal(options.headers["x-ai-api-key"], "run-only-key");
      return json({
        persisted: true,
        pagesPersisted: 4,
        hackathonsPersisted: 82,
        uniqueHackathonsPersisted: 80,
      });
    }, async (request) => {
      const result = await request("scraper/run", {
        method: "POST", body: { apiKey: "run-only-key" },
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {
        pagesPersisted: 4,
        hackathonsPersisted: 82,
        uniqueHackathonsPersisted: 80,
      });
      assert.equal(JSON.stringify(result.body).includes("run-only-key"), false);
    });
  await scenario("scraper action requires an API key before contacting the scraper",
    (url) => {
      assert.equal(url.pathname, "/api/auth/me");
      return json(adminUser);
    }, async (request) => {
      const result = await request("scraper/run", {
        method: "POST", body: { apiKey: "" },
      });
      assert.equal(result.status, 400);
    });
  await scenario("scraper action rejects an empty response instead of reporting success",
    (url) => url.pathname === "/api/auth/me"
      ? json(adminUser)
      : new Response("", { status: 200 }),
    async (request) => {
      const result = await request("scraper/run", {
        method: "POST", body: { apiKey: "run-only-key" },
      });
      assert.equal(result.status, 502);
      assert.match(result.body.error, /empty or invalid response/);
    });
 });
