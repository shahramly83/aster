// Sign-in helpers for the authenticated e2e specs.
// ---------------------------------------------------------------------------
// The app is a client-rendered SPA whose session lives in localStorage (the
// Supabase auth token). We sign in through the real login form rather than
// injecting a token, so the specs exercise the same path a user takes.
import { expect } from "@playwright/test";
import { env } from "./env.js";

// Sign in as a role ("tenant" | "manager" | "interviewer") and wait for the app
// shell to be up. Returns once a workspace screen has rendered.
export async function signIn(page, role) {
  const { email, password } = env[role];
  if (!email || !password) throw new Error(`No credentials configured for role "${role}"`);

  await page.goto("/login", { waitUntil: "load" });

  // The login form: labelled Email + Password, then a Sign in button.
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Landing screen differs by role: managers get the dashboard, interviewers are
  // routed to their own surface. Just wait until we're off /login and the app
  // chrome (the notifications bell) is present.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /notifications/i })).toBeVisible({ timeout: 30_000 });
}

// Best-effort sign out, so a spec can leave the browser clean.
export async function signOut(page) {
  try {
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-")) localStorage.removeItem(k);
      }
    });
  } catch { /* nothing to clear */ }
}

// Navigate to an in-app route and wait for the SPA to settle there.
export async function goToApp(page, path) {
  await page.goto(path, { waitUntil: "load" });
  await page.waitForURL((u) => u.pathname === path, { timeout: 20_000 }).catch(() => {});
  // The app restores its session asynchronously; give it a beat to swap screens.
  await page.waitForTimeout(1200);
}
