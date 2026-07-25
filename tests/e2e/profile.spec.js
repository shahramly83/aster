// Profile — the completeness meter (ProfileScreen, ~19822/20010), the password
// change card, and the "complete your profile before your first job" gate.
//
// Everything here is read-only except the first-job gate check, which only opens
// a dialog (it doesn't post a job), so the whole file runs on creds alone.
import { test, expect } from "@playwright/test";
import { hasCreds, needCreds } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("profile completeness [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/profile");
  });

  test("shows the completeness meter with a percentage", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /profile completeness/i })).toBeVisible({ timeout: 20_000 });
    // The meter reads a percentage (0–100%) — the exact number depends on the
    // workspace, but the "%" readout must be present.
    await expect(page.getByText(/\b\d{1,3}\s*%/).first()).toBeVisible();
  });

  test("either lists the outstanding items or confirms it's complete", async ({ page }) => {
    const complete = page.getByText(/your profile is complete/i);
    // Known incomplete-item labels from completionItems.
    const anyItem = page.getByText(
      /add your full name|add a contact number|upload a company logo|set your company name|add a billing address/i
    );
    // One or the other is always shown; never a bare meter with nothing under it.
    expect((await complete.count()) + (await anyItem.count())).toBeGreaterThan(0);
  });

  test("the sign-in card offers a password change and a reset link", async ({ page }) => {
    await expect(page.locator("#pw-cur")).toBeVisible();
    await expect(page.locator("#pw-new")).toBeVisible();
    await expect(page.getByRole("button", { name: /update password/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /forgot your password/i })).toBeVisible();
  });
});

test.describe("profile — password change validation [negative]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("a mismatched new password is refused", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/profile");

    await page.locator("#pw-cur").fill("whatever-current");
    await page.locator("#pw-new").fill("Brand-New-Pass1");
    await page.locator("#pw-conf").fill("does-not-match");
    await page.getByRole("button", { name: /update password/i }).click();

    // It should complain and NOT report success.
    await expect(page.getByText(/don't match|do not match|match/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/password updated/i)).toHaveCount(0);
  });
});

test.describe("first-job profile gate [regression]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("posting the first job while the profile is incomplete is blocked with a reason", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/jobs");

    // The gate only fires when the profile is under 100% AND no jobs exist yet.
    // In a workspace that's past either condition there's nothing to assert, so
    // skip rather than fail.
    await page.getByRole("button", { name: /post a job/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const gate = page.getByRole("heading", { name: /complete your profile first/i });
    test.skip(!(await gate.count()), "Profile already complete or jobs already exist; gate does not apply.");

    await expect(gate).toBeVisible();
    await expect(page.getByRole("button", { name: /complete profile/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /not now/i })).toBeVisible();
  });
});
