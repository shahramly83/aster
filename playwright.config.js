import { defineConfig, devices } from "@playwright/test";

// End-to-end / browser audit suite. Kept separate from the Vitest unit tests:
// Vitest owns `src/**/*.test.js` + `supabase/functions/**/*.test.ts` (see
// vitest.config.js); Playwright owns `tests/e2e/**/*.spec.js`. The two globs
// never overlap, so `npm test` and `npm run e2e` stay independent.
//
// The dev server runs against whatever is in `.env.local`. With real Supabase
// creds present the app boots in live mode, which is what the auth-guard specs
// need (an unauthenticated visitor is the case W4 is about). The specs only
// touch public / unauthenticated surfaces, so they never write tenant data.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["iPad Mini"] } },
    { name: "mobile", use: { ...devices["iPhone SE"] } }, // 320-ish narrow viewport
  ],
  // Reuse a dev server if one is already up; otherwise start one.
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL || "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
