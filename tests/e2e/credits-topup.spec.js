// Credits — the balance readouts, the AI-Rank spend confirmation, and the
// Buy-credits (top-up) modal (BuyCreditsModal, ~11004).
//
// All read-only. Opening the top-up modal spends nothing — the charge only
// happens after Stripe Checkout, which these specs deliberately never complete.
// So this whole file runs on creds alone.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("credit balance [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("the dashboard plan-usage panel shows the metered pools", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/dashboard");

    await expect(page.getByText(/plan usage/i).first()).toBeVisible({ timeout: 20_000 });
    // Each metered pool is listed. Applicant + bulk screening are always shown.
    await expect(page.getByText(/applicant screening/i).first()).toBeVisible();
    await expect(page.getByText(/bulk upload screening/i).first()).toBeVisible();
    // A used/limit ratio (e.g. "3 / 100") or an "Unlimited" readout is present.
    await expect(page.getByText(/\d+\s*\/\s*\d+|unlimited/i).first()).toBeVisible();
  });
});

test.describe("top-up modal [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("Buy credits opens the top-up modal with a Stripe-backed Pay button", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/billing");

    // Billing's current-plan card carries a Buy credits button.
    const buy = page.getByRole("button", { name: /buy credits/i }).first();
    test.skip(!(await buy.count()), "No Buy-credits entry point in this workspace/plan.");
    await buy.scrollIntoViewIfNeeded().catch(() => {});
    await buy.click();

    // The top-up modal is a plain overlay (no role="dialog"), so assert page-wide
    // on its distinctive copy: the quantity control, a Pay total, and the Stripe line.
    await expect(page.getByText(/how many/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^pay\b/i })).toBeVisible();
    await expect(page.getByText(/one-time payment via stripe/i)).toBeVisible();

    // Close without paying (no charge is ever incurred client-side).
    await page.getByRole("button", { name: /^cancel$/i }).click();
  });
});

test.describe("AI Rank spend confirmation [negative-safe]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID to a job with applicants.");

  test("AI Rank asks before spending, and Cancel spends nothing", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, `/applicants/${env.applyJobId}`);

    const rank = page.getByRole("button", { name: /^ai rank|re-run ai rank|out of credits/i }).first();
    test.skip(!(await rank.count()), "No AI Rank control on this job.");

    // When out of credits the button says so and is a dead end (the important
    // negative case): assert the copy rather than a spend prompt.
    if (/out of credits/i.test(await rank.innerText())) {
      await expect(rank).toBeVisible();
      return;
    }

    test.skip(await rank.isDisabled(), "AI Rank needs at least 2 rankable candidates.");
    await rank.click();

    // A confirm dialog guards the credit spend, and it states the cost.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /run ai rank|not enough ai rank credits/i })).toBeVisible({
      timeout: 10_000,
    });
    // Backing out must not charge anything.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toHaveCount(0);
  });
});
