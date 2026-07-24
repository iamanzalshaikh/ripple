import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Ripple OS trust / Semantic OS suites.
 *
 * These projects do NOT drive a browser page — they drive the real Electron
 * app via the OS test file bridge (tests/helpers/osBridge.ts). Chromium is
 * only used as a Playwright project host so `npx playwright test --ui` works.
 *
 * Start Ripple first: `npm run dev`
 * Then:
 *   npx playwright test --project=wave0
 *   npx playwright test --project=wave1
 *   npx playwright test --project=wave1 --ui
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
      name: "wave1",
      testMatch: /wave1\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /wave[01]\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
