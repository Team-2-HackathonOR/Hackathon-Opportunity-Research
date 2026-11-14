const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");
const previous = {
  id: "previous-run", status: "failed", stage: "reset",
  steps: { reset: { status: "failed" } },
};

test("reset requires a fresh key and destructive confirmation before any request", async () => {
  let confirmed = false;
  const page = createPage({ signedIn: true }, false, {}, () => { confirmed = true; return false; });
  await page.ready();
  page.renderPipeline(previous);
  await page.element("#pipeline-reset").listeners.click();
  assert.match(page.element("#notification").textContent, /Enter a new AI API key/);
  assert.equal(confirmed, false);
  page.element("#scraper-api-key").value = "new-run-key";
  await page.element("#pipeline-reset").listeners.click();
  assert.equal(confirmed, true);
  assert.equal(page.calls.some(({ action }) => action === "pipeline/restart"), false);
});

test("reset targets the displayed job and renders a fresh queued run without retaining its key", async () => {
  const next = { ...previous, id: "new-run", status: "queued", stage: "reset", steps: { reset: { status: "waiting" } } };
  const page = createPage({ signedIn: true }, false, {
    "pipeline/restart": () => Response.json({ job: next }, { status: 202 }),
  });
  await page.ready();
  page.renderPipeline(previous);
  page.element("#scraper-api-key").value = "new-run-key";
  await page.element("#pipeline-reset").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/restart");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: previous.id, apiKey: "new-run-key" });
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#scraper-run").disabled, true);
  assert.equal(page.element("#pipeline-stop").hidden, false);
  assert.match(page.element("#scraper-result").textContent, /Queued/);
});

test("restart interlocks remain explicit failures and never display a new queued job", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/restart": () => Response.json({ error: "Operation has an uncertain outcome." }, { status: 409 }),
  });
  await page.ready();
  page.renderPipeline(previous);
  page.element("#scraper-api-key").value = "new-run-key";
  await page.element("#pipeline-reset").listeners.click();
  assert.match(page.element("#scraper-result").textContent, /Could not reset pipeline: Operation has an uncertain outcome/);
  assert.equal(page.element("#scraper-api-key").value, "");
  assert.equal(page.element("#pipeline-reset").disabled, false);
});

test("a rejected start resumes polling and exposes the existing active run's stop control", async () => {
  let job = null;
  const active = { ...previous, id: "active-run", status: "queued" };
  const page = createPage({ signedIn: true }, false, {
    pipeline: () => Response.json({ job }),
    "pipeline/run": () => Response.json({ error: "A pipeline run is already active." }, { status: 409 }),
    "pipeline/cancel": () => Response.json({ job: { ...active, status: "failed", cancelled: true } }),
  });
  await page.ready();
  job = active;
  page.element("#scraper-api-key").value = "new-run-key";
  await page.element("#scraper-form").listeners.submit({ preventDefault() {} });
  assert.match(page.element("#scraper-result").textContent, /already active/);
  assert.equal(page.element("#scraper-api-key").value, "");
  const before = page.calls.filter(({ action }) => action === "pipeline").length;
  await page.runTimers();
  assert.equal(page.calls.filter(({ action }) => action === "pipeline").length, before + 1);
  assert.equal(page.element("#pipeline-stop").hidden, false);
  assert.equal(page.element("#scraper-run").disabled, true);
  await page.element("#pipeline-stop").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/cancel");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: active.id });
});

test("a rejected start preserves the displayed failed run and its reset target", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/run": () => Response.json({ error: "Operation has an uncertain outcome." }, { status: 409 }),
    "pipeline/restart": () => Response.json({ error: "Operation has an uncertain outcome." }, { status: 409 }),
  });
  await page.ready();
  page.renderPipeline(previous);
  page.element("#scraper-api-key").value = "new-run-key";
  await page.element("#scraper-form").listeners.submit({ preventDefault() {} });
  assert.equal(page.element("#pipeline-progress").hidden, false);
  assert.match(page.element("#scraper-result").textContent, /uncertain outcome/);
  page.element("#scraper-api-key").value = "replacement-key";
  await page.element("#pipeline-reset").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/restart");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: previous.id, apiKey: "replacement-key" });
});
