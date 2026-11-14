const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");
const stopped = {
  id: "same-run", status: "failed", cancelled: true, stage: "scraper", stagingBackend: "supabase-storage",
  cursor: { phase: "scraper", page: 2, afterId: null }, scraper: { pagesPersisted: 1, uniqueHackathonsPersisted: 9 },
  steps: { reset: { status: "completed" }, scraper: { status: "cancelled" }, etl: { status: "skipped" } },
};
const advanced = {
  ...stopped, status: "queued", cancelled: undefined, stage: "etl",
  cursor: { ...stopped.cursor, phase: "etl" }, scraper: { ...stopped.scraper, endedEarly: true },
  steps: { ...stopped.steps, scraper: { status: "skipped" }, etl: { status: "waiting" } },
};

test("Stop reveals Go to next step only for a stopped scraper, without automatically advancing", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/cancel": () => Response.json({ job: stopped }),
  });
  await page.ready();
  for (const job of [null, { ...stopped, status: "running" }, { ...stopped, cancelled: false },
    { ...stopped, cursor: { phase: "reset-storage" } }, { ...stopped, cursor: { phase: "etl" } },
    { ...stopped, purpose: "clear" }, { ...stopped, stagingBackend: undefined }]) {
    page.renderPipeline(job);
    assert.equal(page.element("#pipeline-next-step").hidden, true);
  }
  page.renderPipeline({ ...stopped, status: "running", cancelled: false });
  await page.element("#pipeline-stop").listeners.click();
  assert.equal(page.element("#pipeline-next-step").hidden, false);
  assert.equal(page.calls.some(({ action }) => action === "pipeline/next-step"), false);
});

test("Go to next step requires a fresh key and confirmation, keeps the run ID, and never resets or resumes scraping", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/next-step": () => Response.json({ job: advanced }, { status: 202 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  await page.element("#pipeline-next-step").listeners.click();
  assert.equal(page.calls.some(({ action }) => action === "pipeline/next-step"), false);
  page.element("#scraper-api-key").value = " fixture-replacement ";
  await page.element("#pipeline-next-step").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/next-step");
  assert.deepEqual(JSON.parse(request.options.body), {
    jobId: stopped.id, apiKey: "fixture-replacement", confirmation: "ADVANCE TO ETL",
  });
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#pipeline-next-step").hidden, true);
  assert.match(page.element("#pipeline-status-scraper").textContent, /Ended early/);
  assert.match(page.element("#scraper-result").textContent, /ended early/);
  assert.equal(page.calls.some(({ action }) => ["pipeline/run", "pipeline/restart", "pipeline/continue"].includes(action)), false);
  const cancelled = createPage({ signedIn: true }, false, {}, () => false);
  await cancelled.ready();
  cancelled.renderPipeline(stopped);
  cancelled.element("#scraper-api-key").value = "fixture-key";
  await cancelled.element("#pipeline-next-step").listeners.click();
  assert.equal(cancelled.calls.some(({ action }) => action === "pipeline/next-step"), false);
});

test("a rejected advance preserves the stopped run and exposes the unknown-outcome blocker", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/next-step": () => Response.json({ error: "A scraper operation has no confirmed outcome." }, { status: 409 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  page.element("#scraper-api-key").value = "fixture-key";
  await page.element("#pipeline-next-step").listeners.click();
  assert.match(page.element("#scraper-result").textContent, /Could not advance.*no confirmed outcome/);
  assert.equal(page.element("#pipeline-next-step").hidden, false);
  assert.equal(page.element("#pipeline-next-step").disabled, false);
  assert.equal(page.element("#scraper-api-key").value, "");
});
