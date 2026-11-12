const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAdminHarness, adminUser, validEvent, json } = require("./admin-test-helpers");

test("admin moderation queue workflow", async (t) => {
  const { scenario } = await createAdminHarness(t);
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
 });
