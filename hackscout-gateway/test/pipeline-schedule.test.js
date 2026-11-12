const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createPipelineSchedule, nextOccurrence } = require("../pipeline-schedule");

test("schedule uses Rome calendar time for weekly, biweekly, monthly and DST", () => {
  assert.equal(nextOccurrence(new Date("2026-11-11T12:00:00Z"), "weekly"), "2026-11-15T01:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2026-11-15T01:00:00Z"), "biweekly", true), "2026-11-29T01:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2026-11-15T01:30:00Z"), "weekly"), "2026-11-22T01:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2026-11-11T12:00:00Z"), "monthly"), "2026-12-01T01:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2027-03-01T01:00:00Z"), "monthly", true), "2027-04-01T00:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2027-03-27T12:00:00Z"), "weekly"), "2027-03-28T01:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2027-10-30T12:00:00Z"), "weekly"), "2027-10-31T00:00:00.000Z");
  assert.equal(nextOccurrence(new Date("2027-10-31T00:30:00Z"), "weekly"), "2027-11-07T01:00:00.000Z");
});

test("schedule persists without a key and triggers once after downtime", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hackscout-schedule-"));
  t.after(() => rmSync(directory, { recursive: true }));
  const storePath = join(directory, "schedule.json");
  let now = new Date("2026-11-11T12:00:00Z");
  const calls = [];
  const pipeline = { get: () => null, start: (key) => { calls.push(key); return { status: "running" }; } };
  const options = { storePath, now: () => now, getApiKey: () => "schedule-key-fixture", startTimer: false };
  const scheduler = createPipelineSchedule(pipeline, options);
  scheduler.update("biweekly");
  assert.equal(readFileSync(storePath, "utf8").includes("schedule-key-fixture"), false);
  const restored = createPipelineSchedule(pipeline, options);
  assert.equal(restored.get().nextRunAt, "2026-11-15T01:00:00.000Z");
  now = new Date("2026-12-15T12:00:00Z");
  restored.tick();
  restored.tick();
  assert.deepEqual(calls, ["schedule-key-fixture"]);
  assert.equal(restored.get().nextRunAt, "2026-12-27T01:00:00.000Z");
  restored.update("off");
  now = new Date("2027-01-01T12:00:00Z");
  restored.tick();
  assert.equal(calls.length, 1);
});

test("automatic runs require an environment key and defer while another run is active", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hackscout-schedule-"));
  t.after(() => rmSync(directory, { recursive: true }));
  t.mock.method(console, "error", () => {});
  let key = "";
  let busy = false;
  let calls = 0;
  let now = new Date("2026-11-11T12:00:00Z");
  const pipeline = {
    get: () => busy ? { status: "running" } : null,
    start: () => { calls += 1; return { status: "running" }; },
  };
  const scheduler = createPipelineSchedule(pipeline, {
    storePath: join(directory, "schedule.json"), now: () => now, getApiKey: () => key, startTimer: false,
  });

  test("persistence failure is explicit and never starts or consumes the due run", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "hackscout-schedule-"));
    t.after(() => rmSync(directory, { recursive: true }));
    t.mock.method(console, "error", () => {});
    const parent = join(directory, "store");
    let calls = 0;
    let now = new Date("2026-11-11T12:00:00Z");
    const scheduler = createPipelineSchedule({
      get: () => null, start: () => { calls += 1; return {}; },
    }, {
      storePath: join(parent, "schedule.json"), now: () => now,
      getApiKey: () => "server-key-fixture", startTimer: false,
    });
    scheduler.update("weekly");
    const due = scheduler.get().nextRunAt;
    renameSync(parent, join(directory, "backup"));
    writeFileSync(parent, "Block schedule directory creation.");
    now = new Date(due);
    scheduler.tick();
    assert.equal(calls, 0);
    assert.equal(scheduler.get().nextRunAt, due);
    assert.ok(scheduler.get().lastError);
    rmSync(parent);
    renameSync(join(directory, "backup"), parent);
    scheduler.tick();
    assert.equal(calls, 1);
    assert.equal(scheduler.get().lastError, null);
  });
  assert.throws(() => scheduler.update("weekly"), /AI_API_KEY/);
  key = "schedule-key-fixture";
  scheduler.update("weekly");
  now = new Date("2026-11-15T01:00:00Z");
  busy = true;
  scheduler.tick();
  assert.equal(calls, 0);
  assert.match(scheduler.get().lastError, /current pipeline/);
  busy = false;
  key = "";
  scheduler.tick();
  assert.equal(calls, 0);
  assert.match(scheduler.get().lastError, /AI_API_KEY/);
  key = "schedule-key-fixture";
  scheduler.tick();
  assert.equal(calls, 1);
  assert.equal(scheduler.get().lastError, null);
});
