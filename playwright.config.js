import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Load .env.e2e, which nothing did before: every credentialed spec skipped for
// "missing credentials" while the file sat right there holding them, so a normal
// `npm run e2e` reported a green run having tested only the public pages. 57 of
// 83 specs were silently sitting out.
//
// Written by hand rather than with dotenv, which is not a dependency of this
// project and is not worth becoming one for six lines.
//
// The gates are deliberately NOT read from the file. E2E_ALLOW_WRITES / _AI /
// _EMAIL decide whether a run creates real rows, spends real credits and sends
// real email against the LIVE project, and a value sitting in a file is not a
// decision to do any of that: someone cloning the repo and running the tests
// would not know they had agreed. They have to come from the environment of the
// command being run, so turning them on is an act rather than a leftover.
// Anything already in the environment wins, so CI and `E2E_ALLOW_WRITES=1 npm
// run e2e` behave as expected.
const GATES = new Set(["E2E_ALLOW_WRITES", "E2E_ALLOW_AI", "E2E_ALLOW_EMAIL"]);
try {
  for (const line of readFileSync(".env.e2e", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;                                   // blank line or comment
    const [, key, raw] = m;
    if (GATES.has(key) || process.env[key]) continue;
    process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
} catch { /* no .env.e2e: the public specs still run, the rest skip with a reason */ }

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
