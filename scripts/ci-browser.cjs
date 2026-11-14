const { spawnSync } = require("node:child_process");
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Browser execution is CI-only by user instruction. No local Playwright run is authorized.");
}
const result = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"),
  "test", "--config=playwright.config.cjs"], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
