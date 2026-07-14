// Auth flows: sign in, bad credentials, sign-out, and the branded workspace login.
// Read-only except for creating a session, so these run with credentials alone
// (no E2E_ALLOW_WRITES needed).
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds } from "./helpers/env.js";
import { signIn, signOut } from "./helpers/auth.js";

test.describe("login form", () => {
  test("shows the form and a link to sign up / reset", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /forgot password/i })).toBeVisible();
  });

  test("rejects a bad password with an error, and stays on /login", async ({ page }) => {
    test.skip(!hasCreds("tenant"), needCreds("tenant"));
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel(/^email$/i).fill(env.tenant.email);
    await page.getByLabel(/^password$/i).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Surfaces a human error and does NOT let us into the app.
    await expect(page.getByText(/incorrect|invalid|couldn't|could not/i).first()).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("password can be revealed", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    const pw = page.getByLabel(/^password$/i);
    await pw.fill("hunter2");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).click();
    await expect(pw).toHaveAttribute("type", "text");
  });
});

test.describe("signed-in session", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("tenant can sign in and reach the dashboard", async ({ page }) => {
    await signIn(page, "tenant");
    await page.goto("/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    // Dashboard chrome is present (not the marketing header).
    await expect(page.getByRole("button", { name: /notifications/i })).toBeVisible();
  });

  test("clearing the session sends a protected route back to /login", async ({ page }) => {
    await signIn(page, "tenant");
    await signOut(page);
    await page.goto("/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(1800);
    expect(new URL(page.url()).pathname).toBe("/login");
  });
});
