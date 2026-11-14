const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");
const item = {
  id: "9", source_record_id: "402", job_id: "same-run", operation_name: "etl-401",
  created_at: "2026-11-13T00:00:00.000Z", reason: "<script>untrusted source</script>",
};

test("dead-letter list paginates, exposes source safely, and clears private details on sign-out", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/dead-letters": () => Response.json({ items: [item], total: 2, nextBeforeId: "9" }),
    "pipeline/dead-letters?beforeId=9": () => Response.json({ items: [{ ...item, id: "8" }], total: 2, nextBeforeId: null }),
    "pipeline/dead-letters/9": () => Response.json({ item: { ...item, raw_record: { title: "<img src=x>", nested: { keep: true } } } }),
  });
  await page.ready();
  assert.match(page.element("#dead-letter-count").textContent, /2 pending/);
  assert.match(page.element("#dead-letter-list").textContent, /<script>untrusted source<\/script>/);
  assert.equal(page.element("#dead-letter-list").innerHTML, "");
  await page.element("#dead-letter-older").listeners.click();
  assert.match(page.element("#dead-letter-list").textContent, /Dead letter 8/);
  assert.equal(page.element("#dead-letter-older").disabled, true);
  page.element("#dead-letter-id").value = "9";
  await page.element("#dead-letter-view").listeners.click();
  assert.equal(JSON.parse(page.element("#dead-letter-detail").textContent).raw_record.nested.keep, true);
  assert.equal(page.element("#dead-letter-detail").innerHTML, "");
  await page.element("#logout").listeners.click();
  assert.equal(page.element("#dead-letter-detail").textContent, "");
  assert.equal(page.element("#dead-letter-list").textContent, "");
  assert.equal(page.calls.some(({ action }) => /retry|discard/.test(action)), false);
});

test("completed and running pipelines visibly report dead letters instead of clean success", async () => {
  const page = createPage({ signedIn: true }, false);
  await page.ready();
  const job = {
    id: "same-run", status: "completed", stage: "done", reset: {},
    etl: { processed: 2, inserted: 1, failed: 1, deadLettered: 1 },
    steps: { etl: { status: "completed" } }, cursor: { phase: "etl", afterId: 403 },
  };
  page.renderPipeline(job);
  assert.match(page.element("#scraper-result").textContent, /1 dead-lettered.*completed with dead letters/);
  assert.equal(page.element("#scraper-result").classList.contains("error"), true);
  assert.equal(page.element("#pipeline-status-etl").textContent, "Completed with dead letters");
  page.renderPipeline({ ...job, status: "running", stage: "etl", steps: { etl: { status: "running" } } });
  assert.match(page.element("#scraper-result").textContent, /2 processed.*1 dead-lettered.*Running etl/);
});

test("queue and detail errors remain explicit and invalid IDs never reach the API", async () => {
  const page = createPage({ signedIn: true }, false, {
    "pipeline/dead-letters": () => Response.json({ error: "Queue unavailable." }, { status: 503 }),
  });
  await page.ready();
  assert.match(page.element("#dead-letter-list").textContent, /Could not load dead-letter queue: Queue unavailable/);
  assert.equal(page.element("#dead-letter-count").textContent, "");
  page.element("#dead-letter-id").value = "invalid";
  await page.element("#dead-letter-view").listeners.click();
  assert.match(page.element("#dead-letter-detail").textContent, /Enter a dead-letter ID/);
  assert.equal(page.calls.some(({ action }) => action.startsWith("pipeline/dead-letters/")), false);
});
