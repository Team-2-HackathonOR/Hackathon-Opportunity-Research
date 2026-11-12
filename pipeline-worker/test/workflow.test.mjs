import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { getStore } from "../src/store.mjs";
import { runPipeline } from "../workflows/pipeline.mjs";
import { testDatabase, testEnvironment } from "./database.mjs";

test("workflow persists bounded stages and never repeats an uncertain remote reset", async (t) => {
  testEnvironment(t);
  const { pool } = await testDatabase(t);
  t.mock.method(pg, "Pool", function () { return pool; });
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_GATEWAY_URL: process.env.AUTH_GATEWAY_URL };
  process.env.DATABASE_URL = "fixture://unused";
  process.env.AUTH_GATEWAY_URL = "https://gateway.example.test";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const store = getStore();
  const job = await store.create("private-run-key");
  const calls = [];
  t.mock.method(global, "fetch", async (target, options) => {
    const url = new URL(target);
    calls.push(url.pathname + url.search);
    assert.equal(url.origin, "https://gateway.example.test");
    assert.equal(options.headers["x-ai-api-key"], "private-run-key");
    assert.equal(options.headers["x-gateway-secret"], "fixture-gateway-secret");
    assert.equal(options.redirect, "error");
    if (url.pathname.endsWith("/reset")) {
      assert.equal(options.method, "POST");
      return Response.json({ reset: true, deletedRecords: 3, deletedEvents: 2 });
    }
    if (url.pathname.endsWith("/persist-all")) {
      assert.equal(url.searchParams.get("maxPages"), "1");
      assert.equal(options.headers["x-pipeline-fetched-at"], job.startedAt);
      return Response.json({
        persisted: true, fetchedAt: job.startedAt, pagesPersisted: 1,
        runUniqueHackathonsPersisted: 2, paginationAnalysis: { totalPages: 2 },
      });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.limit, 1);
    assert.equal(body.cursor_mode, true);
    assert.equal(body.fetched_at, job.startedAt);
    const done = body.after_id === 2;
    return Response.json({
      processed_count: done ? 0 : 1, inserted_count: done ? 0 : 1, failed_count: 0,
      next_after_id: done ? null : (body.after_id ?? 0) + 1,
    });
  });
  await runPipeline(job.id);
  const completed = await store.latest();
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.etl, { processed: 2, inserted: 2, failed: 0 });
  assert.equal((await store.row(job.id)).key_ciphertext, null);
  assert.deepEqual(calls.slice(0, 4), [
    "/api/internal/scraper/hackathons/reset", "/api/internal/hackathons/reset",
    "/api/internal/scraper/hackathons/persist-all?startPage=1&maxPages=1",
    "/api/internal/scraper/hackathons/persist-all?startPage=2&maxPages=1",
  ]);
  assert.equal(calls.length, 7);
  const next = await store.create("private-run-key");
  let resets = 0;
  t.mock.method(global, "fetch", async () => {
    resets += 1;
    throw new TypeError("Lost response containing private-run-key");
  });
  await runPipeline(next.id);
  await runPipeline(next.id);
  assert.equal(resets, 1);
  const failed = await store.latest();
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps.scraper.status, "skipped");
  assert.equal(failed.error.includes("private-run-key"), false);
  assert.equal((await store.row(next.id)).key_ciphertext, null);
  assert.equal(await store.create("new-key"), null);
});
