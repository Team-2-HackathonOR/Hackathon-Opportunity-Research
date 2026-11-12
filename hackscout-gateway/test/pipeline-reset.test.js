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

test("manual and scheduled pipelines reset both databases before scraping", async (t) => {
  for (const scheduled of [false, true]) {
    await t.test(scheduled ? "scheduled" : "manual", async (child) => {
      const calls = [];
      const controller = createRealPipelineController(async (url, options) => {
        const path = new URL(url).pathname;
        calls.push(path);
        if (path.endsWith("/reset")) {
          assert.equal(options.method, "POST");
          return json({ reset: true, deletedRecords: 2, deletedEvents: 3 });
        }
        return json(path.includes("persist-all") ? scrape
          : { processed_count: 3, inserted_count: 3, failed_count: 0 });
      });
      if (scheduled) {
        const directory = mkdtempSync(join(tmpdir(), "hackscout-reset-schedule-"));
        child.after(() => rmSync(directory, { recursive: true }));
        let now = new Date("2026-11-11T12:00:00Z");
        const schedule = createPipelineSchedule(controller, {
          storePath: join(directory, "schedule.json"), now: () => now,
          getApiKey: () => "fixture", startTimer: false,
        });
        schedule.update("weekly");
        now = new Date("2026-11-15T01:00:00Z");
        schedule.tick();
      } else controller.start("fixture");
      const result = await finish(controller);
      assert.equal(result.status, "completed");
      assert.equal(result.steps.reset.status, "completed");
      assert.deepEqual(result.reset, { mongodb: 2, postgresql: 3 });
      assert.deepEqual(calls, [
        "/api/internal/scraper/hackathons/reset", "/api/internal/hackathons/reset",
        "/api/internal/scraper/hackathons/persist-all", "/api/internal/etl/etl/import/mongodb",
      ]);
    });
  }
});

test("reset errors and invalid summaries stop before scraping or importing", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const failAt of [1, 2]) {
    for (const response of [json({}, 503), json({ reset: true, deletedEvents: -1 })]) {
      let calls = 0;
      const controller = createRealPipelineController(async () => {
        calls += 1;
        return calls === failAt ? response : json({ reset: true, deletedRecords: 0 });
      });
      controller.start("fixture");
      const result = await finish(controller);
      assert.equal(calls, failAt);
      assert.equal(result.stage, "reset");
      assert.equal(result.status, "failed");
      assert.equal(result.steps.scraper.status, "skipped");
      assert.equal(result.steps.etl.status, "skipped");
      assert.equal(result.steps.reset.finishedAt, result.finishedAt);
    }
  }
});

test("failed scraper stops pipeline before ETL", async (t) => {
  let requests = 0;
  t.mock.method(console, "error", () => {});
  const controller = createPipelineController(async () => { requests += 1; return json({}, 502); });
  controller.start("run-only-fixture");
  const result = await finish(controller);
  assert.equal(result.status, "failed");
  assert.equal(result.stage, "scraper");
  assert.equal(requests, 1);
  assert.equal(result.steps.scraper.status, "failed");
  assert.equal(result.steps.scraper.finishedAt, result.finishedAt);
  assert.deepEqual(result.steps.etl, { status: "skipped" });
});

test("ETL partial failures and mismatched record counts cannot report success", async (t) => {
  for (const etl of [
    { processed_count: 3, inserted_count: 2, failed_count: 1 },
    { processed_count: 0, inserted_count: 0, failed_count: 0 },
  ]) {
    await t.test(JSON.stringify(etl), async (child) => {
      child.mock.method(console, "error", () => {});
      const controller = createPipelineController(async (url) =>
        json(new URL(url).pathname === "/api/internal/scraper/hackathons/persist-all" ? scrape : etl));
      controller.start("run-only-fixture");
      const result = await finish(controller);
      assert.equal(result.status, "failed");
      assert.equal(result.stage, "etl");
      assert.ok(result.etl);
      assert.equal(result.steps.scraper.status, "completed");
      assert.equal(result.steps.etl.status, "failed");
      assert.equal(result.steps.etl.finishedAt, result.finishedAt);
    });
  }
});
