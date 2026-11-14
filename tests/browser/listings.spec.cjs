const { test, expect, withDatabase } = require("./helpers.cjs");
const { randomUUID } = require("node:crypto");
test("guest reads a persisted listing, filters it, and saves across reload without gaining admin access", async ({ page }) => {
  const name = `CI browser seed ${randomUUID()}`;
  await withDatabase((db) => db.query(`INSERT INTO hackathon_research.events
    (event_name,organizer_name,format,event_start_date,operational_status,evidence_confidence)
    VALUES ($1,'CI organizer','virtual',current_date+30,'monitor','low')`, [name]));
  try {
    await page.goto("/");
    expect((await page.request.get("/api/hackscout/admin/suggestions")).status()).toBe(401);
    await page.locator("#account-guest").click();
    await page.locator("#keyword-input").fill(name);
    const card = page.locator(".event-card").filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await withDatabase(async (db) => {
      expect((await db.query("SELECT format FROM hackathon_research.events WHERE event_name=$1", [name])).rows).toEqual([{ format: "virtual" }]);
    });
    await page.locator("#filters-toggle").click();
    await page.locator("#format-filter").selectOption("Virtual");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(page.locator("#saved-count")).toHaveText("1");
    await page.reload();
    await page.locator("#account-guest").click();
    await page.locator("#saved-nav").click();
    await expect(page.locator(".event-card").filter({ hasText: name })).toHaveCount(1);
    await page.getByRole("button", { name: "Remove saved event", exact: true }).click();
    await expect(page.locator("#saved-count")).toHaveText("0");
    await page.reload();
    await page.locator("#account-guest").click();
    await expect(page.locator("#saved-count")).toHaveText("0");
  } finally {
    await withDatabase((db) => db.query("DELETE FROM hackathon_research.events WHERE event_name=$1", [name]));
  }
});
