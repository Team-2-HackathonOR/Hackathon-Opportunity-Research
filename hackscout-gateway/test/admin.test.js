const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createAdminRouter, moderationBody } = require("../admin");

const adminUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  role: "admin",
  expiresAt: "2030-01-01T00:00:00Z",
};
const validEvent = {
  event_name: "Community AI Weekend",
  organizer_name: "Community Builders",
  official_website: "https://example.test/event",
  format: "virtual",
  event_start_date: "2027-01-15",
  event_end_date: "2027-01-16",
  description: "Build an AI prototype with a team.",
  technical_tracks: "AI",
};
const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });

test("moderation validation", async (t) => {
  await t.test("approval requires complete event details", () => {
    assert.throws(() => moderationBody({ decision: "approved", event: {} }), /Choose in-person/);
    assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, organizer_name: "" } }), /organizer/);
    assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, description: "" } }), /description/);
  });
  await t.test("approval rejects unsafe URLs and invalid dates", () => {
    for (const official_website of ["javascript:alert(1)", "https://user:password@example.test"]) {
      assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, official_website } }), /HTTP or HTTPS/);
    }
    assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, event_start_date: "2027-02-30" } }), /start date/);
    assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, event_end_date: "2027-01-14" } }), /precede/);
  });
  await t.test("physical events need a location and rejection needs a reason", () => {
    assert.throws(() => moderationBody({ decision: "approved", event: { ...validEvent, format: "hybrid" } }), /City and country/);
    assert.throws(() => moderationBody({ decision: "rejected", notes: "" }), /review note/);
    assert.deepEqual(moderationBody({ decision: "rejected", notes: "Not an official event." }), {
      decision: "rejected", notes: "Not an official event.", event: {},
    });
  });
});

test("protected admin HTTP workflow", async (t) => {
  const previousSecret = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = "gateway-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previousSecret;
  });
  const app = express();
  const directory = mkdtempSync(join(tmpdir(), "hackscout-admin-schedule-"));
  t.after(() => rmSync(directory, { recursive: true }));
  const storePath = join(directory, "schedule.json");
  const router = createAdminRouter(() => ({
    endpoint: "https://project.supabase.test/graphql/v1", secretKey: "sb_secret_test_fixture",
  }), () => "http://scraper.test", { storePath, startTimer: false });
  app.use("/api/admin", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api/admin`;
  const realFetch = global.fetch;

  async function scenario(name, upstream, exercise) {
    await t.test(name, async (child) => {
      child.mock.method(global, "fetch", async (url, options) => {
        if (String(url).startsWith(root)) return realFetch(url, options);
        return upstream(new URL(url), options);
      });
      child.mock.method(console, "error", () => {});
      await exercise(async (route, { method = "GET", body, authorization = "Bearer valid-admin" } = {}) => {
        const response = await fetch(`${root}/${route}`, {
          method,
          headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, headers: response.headers, body: await response.json() };
      });
    });
  }

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
  await scenario("queue is paginated and searched in the database",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      assert.equal(url.pathname, "/rest/v1/event_suggestions");
      assert.equal(url.searchParams.get("status"), "eq.pending");
      assert.equal(url.searchParams.get("offset"), "12");
      assert.equal(url.searchParams.get("limit"), "12");
      assert.ok(url.searchParams.get("or").includes("Community"));
      assert.equal(options.headers.Prefer, "count=exact");
      return json([{ id: 13, event_name: "Community AI Weekend" }], 200, { "content-range": "12-12/13" });
    }, async (request) => {
      const result = await request("suggestions?page=2&status=pending&search=Community");
      assert.equal(result.status, 200);
      assert.equal(result.body.total, 13);
      assert.equal(result.body.page, 2);
      assert.equal(result.body.items.length, 1);
    });
  await scenario("invalid filters and IDs are rejected before database calls",
    (url) => {
      assert.equal(url.pathname, "/api/auth/me");
      return json(adminUser);
    }, async (request) => {
      assert.equal((await request("suggestions?status=unknown")).status, 400);
      assert.equal((await request("suggestions?page=-1")).status, 400);
      assert.equal((await request("suggestions/9223372036854775808/review", {
        method: "POST", body: { decision: "rejected", notes: "Reject" },
      })).status, 400);
    });
  await scenario("approval uses one atomic RPC and the server-verified reviewer",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      assert.equal(url.pathname, "/rest/v1/rpc/moderate_event_suggestion");
      const input = JSON.parse(options.body);
      assert.equal(input.reviewer_id, adminUser.id);
      assert.equal(input.suggestion_id, "1");
      assert.equal(input.decision, "approved");
      assert.equal(input.event_details.event_name, validEvent.event_name);
      assert.equal(options.headers["Content-Profile"], "public");
      return json({ id: "1", status: "approved", published_event_id: "51" });
    }, async (request) => {
      const result = await request("suggestions/1/review", {
        method: "POST", body: { decision: "approved", notes: "Website reviewed.", event: validEvent, reviewer_id: "spoofed" },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.published_event_id, "51");
    });
  await scenario("valid multilingual event details fit the review request limit",
    (url, options) => {
      if (url.pathname === "/api/auth/me") return json(adminUser);
      const input = JSON.parse(options.body);
      assert.equal(input.event_details.description, "\u754c".repeat(4000));
      assert.equal(input.notes, "\u754c".repeat(2000));
      return json({ id: "1", status: "approved", published_event_id: "51" });
    }, async (request) => {
      const result = await request("suggestions/1/review", {
        method: "POST",
        body: {
          decision: "approved", notes: "\u754c".repeat(2000),
          event: { ...validEvent, description: "\u754c".repeat(4000) },
        },
      });
      assert.equal(result.status, 200);
    });
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
    });
});
