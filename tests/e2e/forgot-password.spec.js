// Forgot / reset password — the account-recovery flow.
// ForgotPasswordScreen (src/resume-ai-preview.jsx ~1616) is one component with
// four internal steps: request → sent → reset → done, reached at /forgot-password
// and /reset-password.
//
// Rendering + client-side validation are free and always run. Actually SENDING a
// reset email hits the send-password-reset edge function, so that one spec is
// gated behind E2E_ALLOW_EMAIL.
import { test, expect } from "@playwright/test";
import { env, NEED_EMAIL } from "./helpers/env.js";

test.describe("forgot password — request step [positive]", () => {
  test("the login page links to the reset flow", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await expect(page.getByRole("button", { name: /forgot password/i })).toBeVisible();
  });

  test("renders the request form with an email field and a send button", async ({ page }) => {
    await page.goto("/forgot-password", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/we'll send you a reset link/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
    // A way back to sign in is always offered. (The brand logo also carries this
    // aria-label, so match the first.)
    await expect(page.getByRole("button", { name: /back to sign in/i }).first()).toBeVisible();
  });
});

test.describe("forgot password — validation [negative]", () => {
  test("a malformed email is refused before any email is sent", async ({ page }) => {
    await page.goto("/forgot-password", { waitUntil: "load" });
    // "a@b" passes the browser's native type=email check (so the form submits)
    // but fails the app's stricter isValidEmail (which requires a dotted domain),
    // exercising the in-app guard rather than the browser's.
    await page.getByLabel(/^email$/i).fill("a@b");
    await page.getByRole("button", { name: /send reset link/i }).click();

    // Client-side guard: a human error, and we stay on the request step (no
    // "check your email" success, so nothing was sent).
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /check your email/i })).toHaveCount(0);
  });
});

test.describe("reset password — set-new-password step", () => {
  test("the reset route shows a recovery surface, never a silent blank", async ({ page }) => {
    // With no recovery token in the URL the app either keeps you on the request
    // step or tells you the link is spent — but it must render one of the known
    // recovery headings, not an empty screen.
    await page.goto("/reset-password", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const known = page.getByRole("heading", {
      name: /set a new password|reset your password|password updated|check your email/i,
    });
    await expect(known.first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("forgot password — real send [positive, gated]", () => {
  test("submitting a valid email reaches the check-your-email state", async ({ page }) => {
    test.skip(!env.allowEmail, NEED_EMAIL);
    await page.goto("/forgot-password", { waitUntil: "load" });

    // Send to an obviously test-owned address so a stray email is easy to spot.
    const addr = `e2e+reset-${Date.now()}@example.com`;
    await page.getByLabel(/^email$/i).fill(addr);
    await page.getByRole("button", { name: /send reset link/i }).click();

    // The app never confirms whether the account exists (anti-enumeration): it
    // always advances to the neutral "check your email" state with a resend.
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/expires in 30 minutes/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /resend email/i })).toBeVisible();
  });
});
