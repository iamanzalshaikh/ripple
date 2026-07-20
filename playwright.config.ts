import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Ripple Wave 0 OS trust suite.
 *
 * Wave 0 does NOT drive a browser page — it drives the real Electron app via
 * the OS test file bridge (see tests/helpers/osBridge.ts). Chromium is only
 * used as a Playwright project host so `npx playwright test --ui` works.
 *
 * Start Ripple first: `npm run dev`
 * Then: `npx playwright test --ui` or `npx playwright test --project=wave0`
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "wave0",
      testMatch: /wave0\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /wave0\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
