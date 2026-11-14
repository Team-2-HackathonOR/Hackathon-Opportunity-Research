const { test, expect } = require("@playwright/test");
const { accounts, urls, localStatus, database } = require("../runtime/local-config.cjs");
async function adminLogin(page) {
  await page.goto("/hackscout-admin/");
  await page.locator("#email").fill(accounts.admin);
  await page.locator("#login-submit").click();
  await expect(page.locator("#password")).toBeVisible();
  await page.locator("#password").fill(accounts.password);
  await page.locator("#login-submit").click();
  await expect(page.locator("#dashboard")).toBeVisible();
}
async function withDatabase(action) {
  const db = database(localStatus().DB_URL);
  try { return await action(db); }
  finally { await db.end(); }
}
async function drivePipeline(request, page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const tick = await request.post(`${urls.providers}/tick`);
    expect(tick.status(), await tick.text()).toBe(200);
    const response = await page.request.get("/api/hackscout/admin/pipeline");
    expect(response.status()).toBe(200);
    const { job } = await response.json();
    if (!["queued", "running"].includes(job.status)) {
      expect(job.status, JSON.stringify(job)).toBe("completed");
      return job;
    }
    if (job.retry) await page.waitForTimeout(300);
  }
  throw new Error("Pipeline did not complete before the fixture deadline.");
}
module.exports = { test, expect, accounts, urls, adminLogin, withDatabase, drivePipeline };
