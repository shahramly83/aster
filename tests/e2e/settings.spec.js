// Settings — the workspace settings accordion (SettingsScreen, ~20792), plus the
// email-code two-factor card (EmailTwoFactorCard, ~19413) and the interviewer's
// boundary against it.
//
// Reads and toggling the unsaved-changes state are free (creds only). Enabling
// 2FA sends a real code email, so that spec is gated behind E2E_ALLOW_EMAIL.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_EMAIL } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("settings — owner view [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/settings");
  });

  test("renders the settings sections", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible({ timeout: 20_000 });
    // The accordion headers are buttons (aria-expanded); the core ones are always there.
    await expect(page.getByRole("button", { name: /email templates/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /offer signature/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /email notifications/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^security\b/i })).toBeVisible();
  });

  test("the Security section exposes the two-factor card", async ({ page }) => {
    await page.getByRole("button", { name: /^security\b/i }).click();
    await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible({ timeout: 10_000 });
    // Either enable or disable is offered depending on current state.
    const toggle = page.getByRole("button", { name: /enable two-factor|turn off two-factor/i });
    await expect(toggle.first()).toBeVisible();
  });

  test("flipping a notification toggle surfaces the unsaved-changes bar", async ({ page }) => {
    await page.getByRole("button", { name: /email notifications/i }).click();
    // The Toggle rows: New applicants / Interview reminders / Weekly hiring digest / Product updates.
    const firstToggle = page.getByRole("switch").first();
    test.skip(!(await firstToggle.count()), "No notification toggles rendered.");
    await firstToggle.click();

    await expect(page.getByText(/you have unsaved changes/i)).toBeVisible({ timeout: 10_000 });
    // Back out without persisting so the workspace is left as it was.
    await page.getByRole("button", { name: /^cancel$/i }).first().click();
  });
});

test.describe("settings — two-factor enable [gated]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("enabling two-factor emails a 6-digit code", async ({ page }) => {
    test.skip(!env.allowEmail, NEED_EMAIL);
    await signIn(page, "tenant");
    await goToApp(page, "/settings");
    await page.getByRole("button", { name: /^security\b/i }).click();

    const enable = page.getByRole("button", { name: /enable two-factor/i });
    test.skip(!(await enable.count()), "Two-factor is already on in this workspace.");
    await enable.click();

    // The code step opens and tells the user where the code went.
    await expect(page.getByText(/we sent a 6-digit code/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^confirm$/i })).toBeVisible();
    // Abort without confirming — we can't read the emailed code, and we don't
    // want to leave 2FA half-armed.
    await page.getByRole("button", { name: /^cancel$/i }).first().click();
  });
});

test.describe("settings — interviewer boundary [negative/regression]", () => {
  test.skip(!hasCreds("interviewer"), needCreds("interviewer"));

  test("an interviewer cannot reach /settings", async ({ page }) => {
    await signIn(page, "interviewer");
    await page.goto("/settings", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    // Manager-only surface: the interviewer is bounced elsewhere.
    expect(new URL(page.url()).pathname).not.toBe("/settings");
  });
});
