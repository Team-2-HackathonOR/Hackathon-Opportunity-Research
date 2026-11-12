const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createAdminRouter, moderationBody } = require("../admin");
const { requireGateway } = require("../gateway-auth");

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

test("gateway-authenticated pipeline checks do not call the gateway recursively", async (t) => {
  const previous = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = "gateway-test-secret";
  const directory = mkdtempSync(join(tmpdir(), "hackscout-trusted-admin-"));
  const app = express();
  const router = createAdminRouter(() => {
    throw new Error("Pipeline status must not query the database.");
  }, undefined, { storePath: join(directory, "schedule.json"), startTimer: false });
  app.use("/api/admin", requireGateway, router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    router.closeScheduler();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true });
    if (previous === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previous;
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const realFetch = global.fetch;
  t.mock.method(global, "fetch", (url, options) => {
    assert.ok(String(url).startsWith(base), "Must not make a nested authentication request");
    return realFetch(url, options);
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const headers = {
    "x-gateway-secret": "gateway-test-secret", "x-gateway-caller": "team-2-gateway",
    "x-user-id": adminUser.id, "x-user-email": adminUser.email, "x-user-role": "admin",
  };
  for (const route of ["pipeline", "pipeline/schedule"]) {
    const response = await fetch(`${base}/${route}`, { headers });
    assert.equal(response.status, 200);
  }
  assert.equal((await fetch(`${base}/pipeline`, {
    headers: { ...headers, "x-gateway-secret": "wrong" },
  })).status, 403);
  assert.equal((await fetch(`${base}/pipeline`, {
    headers: { ...headers, "x-user-role": "viewer" },
  })).status, 403);
  assert.equal((await fetch(`${base}/pipeline`, {
    headers: { ...headers, "x-user-id": "invalid" },
  })).status, 401);
  assert.equal((await fetch(`${base}/pipeline`, {
    headers: { ...headers, "x-user-email": "" },
  })).status, 401);
});

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
