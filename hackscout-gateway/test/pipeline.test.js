const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServer } = require("node:http");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createPipelineController: createRealPipelineController } = require("../pipeline");
function createPipelineController(requestService) {
  if (!requestService) return createRealPipelineController();
  return createRealPipelineController((url, options) => {
    if (new URL(url).pathname.endsWith("/reset")) {
      return Promise.resolve(json({ reset: true, deletedRecords: 2, deletedEvents: 3 }));
    }
    return requestService(url, options);
  });
}
const { createPipelineSchedule } = require("../pipeline-schedule");

const scrape = {
  persisted: true, fetchedAt: "2026-11-11T22:00:00.000Z",
  pagesPersisted: 2, uniqueHackathonsPersisted: 3,
};
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
test.beforeEach((t) => {
  const previous = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = "gateway-test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previous;
  });
});

async function finish(controller) {
  for (let index = 0; index < 500 && controller.get().status === "running"; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.notEqual(controller.get().status, "running");
  return controller.get();
}

test("stage durations follow server time and completed stages retain their end time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-11T12:00:00Z") });
  const responses = [];
  const controller = createPipelineController(() => new Promise((resolve) => responses.push(resolve)));
  controller.start("run-only-fixture");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.get().steps.etl, { status: "waiting" });
  t.mock.timers.setTime(Date.parse("2026-11-11T12:00:20Z"));
  responses[0](json(scrape));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.get().steps.scraper.finishedAt, "2026-11-11T12:00:20.000Z");
  assert.equal(controller.get().steps.etl.status, "running");
  t.mock.timers.setTime(Date.parse("2026-11-11T12:01:00Z"));
  responses[1](json({ processed_count: 3, inserted_count: 3, failed_count: 0 }));
  await new Promise((resolve) => setImmediate(resolve));
  const result = controller.get();
  assert.equal(result.steps.etl.finishedAt, "2026-11-11T12:01:00.000Z");
  t.mock.timers.setTime(Date.parse("2026-11-11T13:00:00Z"));
  assert.equal(controller.get().steps.scraper.finishedAt, "2026-11-11T12:00:20.000Z");
  assert.equal(controller.get().finishedAt, "2026-11-11T12:01:00.000Z");
});

test("pipeline runs scraper then all matching ETL records with a transient key", async () => {
  const calls = [];
  const requestService = async (url, options) => {
    calls.push(new URL(url).pathname);
    assert.equal(options.headers["x-ai-api-key"], "run-only-fixture");
    assert.equal(options.headers["x-gateway-secret"], "gateway-test-secret");
    if (calls.length === 1) return json(scrape);
    assert.deepEqual(JSON.parse(options.body), {
      fetched_at: scrape.fetchedAt, limit: null, use_ai_normalization: true,
    });

    test("an automatic run executes both scraper and ETL through the gateway", async (t) => {
      const directory = mkdtempSync(join(tmpdir(), "hackscout-auto-pipeline-"));
      t.after(() => rmSync(directory, { recursive: true }));
      let now = new Date("2026-11-11T12:00:00Z");
      const calls = [];
      const pipeline = createPipelineController(async (url, options) => {
        calls.push(new URL(url).pathname);
        assert.equal(options.headers["x-ai-api-key"], "server-key-fixture");
        return json(calls.length === 1 ? scrape : { processed_count: 3, inserted_count: 3, failed_count: 0 });
      });
      const schedule = createPipelineSchedule(pipeline, {
        storePath: join(directory, "schedule.json"), now: () => now,
        getApiKey: () => "server-key-fixture", startTimer: false,
      });
      schedule.update("weekly");
      now = new Date("2026-11-15T01:00:00Z");
      schedule.tick();
      assert.equal((await finish(pipeline)).status, "completed");
      assert.deepEqual(calls, ["/api/internal/scraper/hackathons/persist-all", "/api/internal/etl/etl/import/mongodb"]);
    });

    return json({ processed_count: 3, inserted_count: 3, failed_count: 0 });
  };
  const controller = createPipelineController(requestService);
  assert.equal(controller.start("run-only-fixture").status, "running");
  assert.equal(controller.start("other-key"), null);
  const result = await finish(controller);
  assert.deepEqual(calls, ["/api/internal/scraper/hackathons/persist-all", "/api/internal/etl/etl/import/mongodb"]);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.etl, { processed: 3, inserted: 3, failed: 0 });
  assert.equal(JSON.stringify(result).includes("run-only-fixture"), false);
  assert.equal(result.steps.scraper.status, "completed");
  assert.equal(result.steps.etl.status, "completed");
  assert.equal(result.steps.scraper.startedAt, result.steps.reset.finishedAt);
  assert.equal(result.steps.scraper.finishedAt, result.steps.etl.startedAt);
  assert.equal(result.steps.etl.finishedAt, result.finishedAt);
});

test("production pipeline HTTP client sends the ETL body and completes", async (t) => {
  const seen = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push(request.url);
      assert.equal(request.headers["x-ai-api-key"], "run-only-fixture");
      response.setHeader("content-type", "application/json");
      if (request.url.endsWith("/reset")) {
        assert.deepEqual(JSON.parse(body), {});
        response.end(JSON.stringify({ reset: true, deletedRecords: 2, deletedEvents: 3 }));
      } else if (request.method === "GET") response.end(JSON.stringify(scrape));
      else {
        assert.equal(JSON.parse(body).fetched_at, scrape.fetchedAt);
        response.end(JSON.stringify({ processed_count: 3, inserted_count: 3, failed_count: 0 }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.AUTH_GATEWAY_URL;
  t.after(async () => {
    if (previous === undefined) delete process.env.AUTH_GATEWAY_URL;
    else process.env.AUTH_GATEWAY_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.AUTH_GATEWAY_URL = base;
  const controller = createPipelineController();
  controller.start("run-only-fixture");
  assert.equal((await finish(controller)).status, "completed");
  assert.deepEqual(seen, [
    "/api/internal/scraper/hackathons/reset", "/api/internal/hackathons/reset",
    "/api/internal/scraper/hackathons/persist-all?startPage=1", "/api/internal/etl/etl/import/mongodb",
  ]);
});
