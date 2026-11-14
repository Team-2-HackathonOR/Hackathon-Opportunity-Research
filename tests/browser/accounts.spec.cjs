const { randomUUID } = require("node:crypto");
const { test, expect, accounts, withDatabase } = require("./helpers.cjs");
test("register, sign out, reject a wrong password, sign back in, and delete persisted account", async ({ page }) => {
  const email = `ci-browser-${randomUUID()}@example.test`;
  try {
    await page.goto("/");
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await page.locator("#account-register-tab").click();
    await page.locator("#account-email").fill(email);
    await page.locator("#account-password").fill(accounts.password);
    await page.locator("#account-confirm").fill(accounts.password);
    await page.locator("#account-submit").click();
    await expect(page.locator("#application-shell")).toBeVisible();
    await withDatabase(async (db) => {
      const { rows } = await db.query("SELECT role FROM app_auth.app_users WHERE email=$1", [email]);
      expect(rows).toEqual([{ role: "viewer" }]);
    });
    await page.locator("#account-menu").click();
    await expect(page.locator("#account-entrance")).toBeVisible();
    await page.locator("#account-login-tab").click();
    await page.locator("#account-email").fill(email);
    await page.locator("#account-password").fill("incorrect-password");
    await page.locator("#account-submit").click();
    await expect(page.locator("#account-feedback")).toContainText(/invalid|incorrect/i);
    await page.locator("#account-password").fill(accounts.password);
    await page.locator("#account-submit").click();
    await expect(page.locator("#application-shell")).toBeVisible();
    await page.locator("#account-data-open").click();
    await page.locator("#delete-account-password").fill(accounts.password);
    await page.locator("#delete-account-confirmation").fill("DELETE");
    await page.locator("#delete-account-submit").click();
    await expect(page.locator("#account-entrance")).toBeVisible();
    await withDatabase(async (db) => {
      expect((await db.query("SELECT count(*)::int AS n FROM app_auth.app_users WHERE email=$1", [email])).rows[0].n).toBe(0);
    });
  } finally {
    await withDatabase(async (db) => {
      await db.query("DELETE FROM app_auth.jwt_tokens WHERE user_id IN (SELECT id FROM app_auth.app_users WHERE email=$1)", [email]);
      await db.query("DELETE FROM app_auth.app_users WHERE email=$1", [email]);
    });
  }
});
