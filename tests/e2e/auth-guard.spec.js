// Auth-guard audit (W4): an unauthenticated visitor to a workspace-only route
// must land on /login, not on the app shell rendered over demo data.
//
// This reproduces W4 from ASTER_REMAINING_WORK.md. With real Supabase creds in
// .env.local the app boots in live mode; a fresh browser has no session, so the
// restore path resolves to "no session". The correct behaviour is a redirect to
// the login screen. If the dashboard chrome renders instead, the guard is missing.
import { test, expect } from "@playwright/test";

// Workspace routes that should never render for a signed-out visitor.
const PROTECTED_ROUTES = ["/dashboard", "/candidates", "/jobs", "/billing", "/settings"];

for (const path of PROTECTED_ROUTES) {
  test(`unauthenticated ${path} redirects to login`, async ({ page }) => {
    await page.goto(path, { waitUntil: "load" });

    // Give the async session-restore effect time to settle and redirect.
    await page.waitForTimeout(1500);

    const url = new URL(page.url());
    expect(
      url.pathname,
      `signed-out visit to ${path} should end on /login, landed on ${url.pathname}`
    ).toBe("/login");

    // And the login form should actually be present.
    await expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible();
  });
}
