const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");
const stopped = {
  id: "same-run", status: "failed", cancelled: true, stage: "etl", stagingBackend: "supabase-storage",
  cursor: { phase: "etl", page: 1111, afterId: 401 }, steps: { etl: { status: "cancelled" } },
};

test("Continue requires a replacement key and is hidden for active, completed and legacy runs", async () => {
  const page = createPage({ signedIn: true }, false);
  await page.ready();
  for (const job of [null, { ...stopped, status: "queued" }, { ...stopped, status: "completed" }, { ...stopped, stagingBackend: undefined }]) {
    page.renderPipeline(job);
    assert.equal(page.element("#pipeline-continue").hidden, true);
  }
  page.renderPipeline(stopped);
  assert.equal(page.element("#pipeline-continue").hidden, false);
  await page.element("#pipeline-continue").listeners.click();
  assert.match(page.element("#notification").textContent, /new AI API key/);
  assert.equal(page.calls.some(({ action }) => action === "pipeline/continue"), false);
});

test("Continue reuses the displayed checkpoint without reset/start calls or retaining the key", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/continue": () => Response.json({ job: { ...stopped, status: "queued", cancelled: undefined } }, { status: 202 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  page.element("#scraper-api-key").value = "replacement-fixture-key";
  await page.element("#pipeline-continue").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/continue");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: stopped.id, apiKey: "replacement-fixture-key" });
  assert.equal(page.calls.some(({ action }) => ["pipeline/run", "pipeline/restart"].includes(action)), false);
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#scraper-run").disabled, true);
  assert.equal(page.element("#pipeline-continue").hidden, true);
  assert.match(page.element("#scraper-result").textContent, /Queued/);
});

test("a rejected Continue preserves the failed checkpoint, shows the interlock and resumes polling", async () => {
  const page = createPage({ signedIn: true }, false, {
    pipeline: () => Response.json({ job: stopped }),
    "pipeline/continue": () => Response.json({ error: "Operation has no confirmed outcome." }, { status: 409 }),
  });
  await page.ready();
  page.renderPipeline(stopped);
  page.element("#scraper-api-key").value = "replacement-fixture-key";
  await page.element("#pipeline-continue").listeners.click();
  assert.match(page.element("#scraper-result").textContent, /Could not continue pipeline: Operation has no confirmed outcome/);
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#pipeline-continue").disabled, false);
  const before = page.calls.filter(({ action }) => action === "pipeline").length;
  await page.runTimers();
  assert.equal(page.calls.filter(({ action }) => action === "pipeline").length, before + 1);
  assert.equal(page.element("#pipeline-continue").hidden, false);
});
