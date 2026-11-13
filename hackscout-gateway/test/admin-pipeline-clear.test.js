const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");
const stopped = {
  id: "same-run", status: "failed", cancelled: true, stage: "reset",
  stagingBackend: "supabase-storage", steps: { reset: { status: "cancelled" } },
};
const clearing = {
  ...stopped, id: "clear-run", status: "queued", cancelled: false, purpose: "clear",
  steps: { reset: { status: "waiting" }, scraper: { status: "skipped" }, etl: { status: "skipped" } },
};

test("Clear all confirms deletion without requiring or sending an AI key and resets the completed display", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/clear": () => Response.json({ job: clearing }, { status: 202 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  page.element("#scraper-api-key").value = "must-not-be-sent";
  await page.element("#pipeline-clear").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/clear");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: stopped.id, confirmation: "CLEAR ALL" });
  assert.equal(page.calls.some(({ action }) => ["pipeline/run", "pipeline/restart"].includes(action)), false);
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#pipeline-clear").disabled, true);
  assert.match(page.element("#scraper-result").textContent, /Clear all/);
  page.renderPipeline(null);
  assert.equal(page.element("#pipeline-progress").hidden, true);
  assert.equal(page.element("#pipeline-time-total").textContent, "00:00");
  assert.equal(page.element("#pipeline-time-reset").textContent, "00:00");
  assert.match(page.element("#scraper-result").textContent, /cleared/i);
});

test("Clear all does nothing without confirmation or while a run is active", async () => {
  const page = createPage({ signedIn: true }, false, {}, () => false);
  await page.ready();
  page.renderPipeline(stopped);
  await page.element("#pipeline-clear").listeners.click();
  page.renderPipeline({ ...stopped, status: "running" });
  assert.equal(page.element("#pipeline-clear").disabled, true);
  await page.element("#pipeline-clear").listeners.click();
  assert.equal(page.calls.some(({ action }) => action === "pipeline/clear"), false);
});

test("Clear all exposes unknown-outcome errors without hiding history and resumes polling", async () => {
  const page = createPage({ signedIn: true }, false, {
    pipeline: () => Response.json({ job: stopped }),
    "pipeline/clear": () => Response.json({ error: "Operation has no confirmed outcome." }, { status: 409 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  await page.element("#pipeline-clear").listeners.click();
  assert.match(page.element("#scraper-result").textContent, /Could not clear pipeline: Operation has no confirmed outcome/);
  assert.equal(page.element("#pipeline-clear").disabled, false);
  assert.equal(page.element("#pipeline-progress").hidden, false);
  const before = page.calls.filter(({ action }) => action === "pipeline").length;
  await page.runTimers();
  assert.equal(page.calls.filter(({ action }) => action === "pipeline").length, before + 1);
});
