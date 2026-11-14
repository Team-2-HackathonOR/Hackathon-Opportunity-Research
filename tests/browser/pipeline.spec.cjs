const { test, expect, adminLogin, withDatabase, drivePipeline } = require("./helpers.cjs");
test("admin runs the real ingestion journey and reviews the original failed source without losing valid events", async ({ page, request }) => {
  await page.goto("/hackscout-admin/");
  expect((await page.request.post("/api/hackscout/admin/pipeline/run", {
    data: { apiKey: "ci-fixture-key" },
  })).status()).toBe(401);
  await adminLogin(page);
  await page.locator("#scraper-api-key").fill("ci-fixture-key");
  const queued = page.waitForResponse((response) =>
    response.url().endsWith("/pipeline/run") && response.request().method() === "POST");
  await page.locator("#scraper-run").click();
  expect((await queued).status()).toBe(202);
  const job = await drivePipeline(request, page);
  expect(job.etl).toEqual({ processed: 3, inserted: 2, failed: 1, deadLettered: 1 });
  await page.locator("#refresh").click();
  await expect(page.locator("#scraper-result")).toContainText(/dead.letter/i);
  await page.locator("#dead-letter-refresh").click();
  await expect(page.locator("#dead-letter-list")).toContainText("12");
  await withDatabase(async (db) => {
    const { rows } = await db.query("SELECT id::text,raw_record FROM pipeline_control.dead_letters WHERE job_id=$1", [job.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].raw_record.id).toBe(12);
    await page.locator("#dead-letter-id").fill(rows[0].id);
    expect((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events")).rows[0].n).toBe(2);
  });
  await page.locator("#dead-letter-view").click();
  await expect(page.locator("#dead-letter-detail")).toContainText("CI malformed lead");
  await expect(page.locator("#dead-letter-detail")).not.toContainText("ci-fixture-key");
  await page.locator("#logout").click();
  await expect(page.locator("#login-panel")).toBeVisible();
  expect((await page.request.get("/api/hackscout/admin/pipeline/dead-letters")).status()).toBe(401);
});
