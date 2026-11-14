const { defineConfig, devices } = require("@playwright/test");
const { urls } = require("./tests/runtime/local-config.cjs");
module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  forbidOnly: true,
  outputDir: "test-results/browser",
  reporter: [["list"], ["junit", { outputFile: "test-results/browser.xml" }],
    ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL: urls.web, headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run test:runtime:serve",
    url: urls.web,
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
