const assert = require("node:assert/strict");
const express = require("express");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createAdminRouter } = require("../admin");

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

async function createAdminHarness(t) {
  const previousSecret = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = "gateway-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previousSecret;
  });
  const directory = mkdtempSync(join(tmpdir(), "hackscout-admin-schedule-"));
  const storePath = join(directory, "schedule.json");
  const app = express();
  const router = createAdminRouter(() => ({
    endpoint: "https://project.supabase.test/graphql/v1",
    secretKey: "sb_secret_test_fixture",
  }), () => "http://scraper.test", { storePath, startTimer: false });
  app.use("/api/admin", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    router.closeScheduler();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true });
  });
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

  return { scenario, storePath };
}

module.exports = { adminUser, validEvent, json, createAdminHarness };
