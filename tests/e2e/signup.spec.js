// Sign up — workspace creation form (SignUpScreen, src/resume-ai-preview.jsx ~8215).
//
// These specs exercise the form and its INLINE validation only. Actually
// submitting creates a real workspace and sends a confirmation email, so the
// happy-path submit is intentionally left out of the automated suite — assert on
// the client-side guards that a bad submission never gets that far.
import { test, expect } from "@playwright/test";

test.describe("sign up — form [positive]", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signup", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /create your workspace/i })).toBeVisible({ timeout: 20_000 });
  });

  test("shows the workspace fields and a link back to sign in", async ({ page }) => {
    await expect(page.getByLabel(/company name/i)).toBeVisible();
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    // The CTA copy varies (trial vs paid), but a submit is always present.
    await expect(
      page.getByRole("button", { name: /start .*free trial|create account|continue to payment/i })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("the dashboard URL is shown under the .hireaster.com domain", async ({ page }) => {
    await expect(page.getByText(/\.hireaster\.com/i).first()).toBeVisible();
  });
});

test.describe("sign up — validation [negative]", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signup", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /create your workspace/i })).toBeVisible({ timeout: 20_000 });
  });

  test("a personal email is rejected in favour of a work address", async ({ page }) => {
    await page.getByLabel(/work email/i).fill("someone@gmail.com");
    await page.getByLabel(/work email/i).blur();
    await expect(page.getByText(/personal emails aren't accepted/i)).toBeVisible();
  });

  test("mismatched passwords are flagged before submit", async ({ page }) => {
    await page.locator("#su-password").fill("Sup3rSecret!");
    await page.locator("#su-confirm").fill("different-value");
    await page.locator("#su-confirm").blur();
    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
  });

  test("matching passwords report positively", async ({ page }) => {
    await page.locator("#su-password").fill("Sup3rSecret!");
    await page.locator("#su-confirm").fill("Sup3rSecret!");
    await page.locator("#su-confirm").blur();
    await expect(page.getByText(/passwords match/i)).toBeVisible();
  });
});
