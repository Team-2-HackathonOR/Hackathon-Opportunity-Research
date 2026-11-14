const { randomUUID } = require("node:crypto");
const { test, expect, adminLogin, withDatabase } = require("./helpers.cjs");
test("guest suggests, admin approves, database records reviewer, and public UI displays publication", async ({ page }) => {
  const name = `CI browser moderation ${randomUUID()}`;
  let published;
  try {
    await page.goto("/");
    expect((await page.request.get("/api/hackscout/admin/suggestions")).status()).toBe(401);
    await page.locator("#account-guest").click();
    await page.locator("#suggest-event").click();
    await page.locator("#suggest-form [name=event]").fill(name);
    await page.locator("#suggest-form [name=website]").fill("https://events.example.test/browser");
    await page.locator("#suggest-form button[type=submit]").click();
    await expect(page.locator("#suggest-feedback")).toContainText("sent for review");
    await withDatabase(async (db) => {
      expect((await db.query("SELECT status FROM public.event_suggestions WHERE event_name=$1", [name])).rows).toEqual([{ status: "pending" }]);
    });
    await adminLogin(page);
    await page.locator("#submission-search").fill(name);
    const row = page.locator("#submission-list tr").filter({ hasText: name });
    await row.getByRole("button", { name: "Review", exact: true }).click();
    await page.locator("#review-form [name=organizer_name]").fill("CI organizer");
    await page.locator("#review-form [name=format]").selectOption("virtual");
    await page.locator("#review-form [name=event_start_date]").fill(`${new Date().getUTCFullYear() + 1}-06-01`);
    await page.locator("#review-form [name=description]").fill("Synthetic browser integration event.");
    await page.locator("#review-notes").fill("CI browser approval.");
    const response = page.waitForResponse((result) => result.url().endsWith("/review") && result.request().method() === "POST");
    await page.locator("#approve").click();
    const review = await response;
    expect(review.status()).toBe(200);
    published = (await review.json()).published_event_id;
    await withDatabase(async (db) => {
      const { rows } = await db.query(`SELECT s.status,u.email FROM public.event_suggestions s
        JOIN app_auth.app_users u ON u.id=s.reviewed_by WHERE s.event_name=$1`, [name]);
      expect(rows).toEqual([{ status: "approved", email: "ci-admin@example.test" }]);
    });
    await page.goto("/");
    await page.locator("#account-guest").click();
    await page.locator("#keyword-input").fill(name);
    await expect(page.locator(".event-card").filter({ hasText: name })).toHaveCount(1);
  } finally {
    await withDatabase(async (db) => {
      await db.query("DELETE FROM public.event_suggestions WHERE event_name=$1", [name]);
      if (published) await db.query("DELETE FROM hackathon_research.events WHERE event_id=$1", [published]);
    });
  }
});
