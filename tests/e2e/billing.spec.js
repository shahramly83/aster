// Billing & plan (BillingScreen, ~18494) at /billing — owner-only.
//
// Read-only throughout. These specs never click through to Stripe Checkout or
// the billing portal (those leave the app and could change a subscription), so
// they run on creds alone. They assert the plan grid, the current-plan state,
// the portal/invoice affordances, and the owner-only gate.
import { test, expect } from "@playwright/test";
import { hasCreds, needCreds } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("billing — owner view [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/billing");
  });

  test("shows the plan grid with the four tiers and the popular badge", async ({ page }) => {
    await expect(page.getByText(/billing .* plan/i).first()).toBeVisible({ timeout: 20_000 });
    for (const tier of [/launch/i, /scale/i, /elite/i, /enterprise/i]) {
      await expect(page.getByText(tier).first()).toBeVisible();
    }
    // Scale is flagged as the recommended tier.
    await expect(page.getByText(/most popular/i)).toBeVisible();
  });

  test("marks the active plan and disables its own button", async ({ page }) => {
    const current = page.getByRole("button", { name: /current plan/i }).first();
    await expect(current).toBeVisible();
    await expect(current).toBeDisabled();
  });

  test("offers the billing portal and the invoice history", async ({ page }) => {
    await expect(page.getByRole("button", { name: /manage billing/i })).toBeVisible();
    // The invoice table header row (present even with zero invoices).
    await expect(page.getByText(/^invoice$/i).first()).toBeVisible();
  });

  test("exposes the billing cycle toggle", async ({ page }) => {
    // Monthly / Yearly switch drives the displayed price.
    await expect(page.getByRole("button", { name: /^monthly/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^yearly/i }).first()).toBeVisible();
  });
});

test.describe("billing — owner-only gate [negative/regression]", () => {
  test.skip(!hasCreds("interviewer"), needCreds("interviewer"));

  test("an interviewer is kept out of billing", async ({ page }) => {
    await signIn(page, "interviewer");
    await page.goto("/billing", { waitUntil: "load" });
    await page.waitForTimeout(1500);

    // Either bounced off /billing entirely, or shown the restricted notice —
    // never the real plan grid with live plan-change buttons.
    const path = new URL(page.url()).pathname;
    if (path === "/billing") {
      await expect(page.getByText(/billing is for the account owner/i)).toBeVisible();
    } else {
      expect(path).not.toBe("/billing");
    }
  });
});
