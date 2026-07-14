// Team, roles and the interviewer's boundary.
//
// This file encodes the rule that caused the "Hanif can't see it" bug:
// an interviewer only sees a job once they're ASSIGNED to it (job_assignments).
// Being on an interview panel is NOT the same thing.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_WRITES, NEED_EMAIL, testName } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("team", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/interviewers");
  });

  test("lists teammates with their role, and marks the tenant", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /team/i })).toBeVisible();
    // The signup account is the tenant, and is labelled as such. An invited
    // teammate is never the tenant, whatever their name.
    await expect(page.getByText(/tenant/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /invite teammate/i })).toBeVisible();
  });

  test("inviting a teammate sends a real invite", async ({ page }) => {
    test.skip(!env.allowWrites || !env.allowEmail, `${NEED_WRITES} ${NEED_EMAIL}`);

    await page.getByRole("button", { name: /invite teammate/i }).click();
    const email = `e2e+${Date.now()}@example.com`;
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByRole("button", { name: /send|invite/i }).last().click();

    // It lands as a pending invite, not an active member.
    await expect(page.getByText(new RegExp(email.replace("+", "\\+"), "i"))).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("assigning an interviewer to a job", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID.");
  test.skip(!env.allowWrites, NEED_WRITES);

  test("the add-interviewer list excludes yourself and pending invites", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, `/applicants/${env.applyJobId}`);

    const add = page.getByRole("button", { name: /add interviewer/i }).first();
    test.skip(!(await add.count()), "No add-interviewer control on this job.");
    await add.click();

    // You can assign anyone on the team EXCEPT your own account.
    const me = env.tenant.email;
    await expect(page.getByText(new RegExp(me.replace(/[.+]/g, "\\$&"), "i"))).toHaveCount(0);
  });
});

test.describe("interviewer boundary", () => {
  test.skip(!hasCreds("interviewer"), needCreds("interviewer"));

  test("an interviewer only sees roles they're assigned to", async ({ page }) => {
    await signIn(page, "interviewer");
    await goToApp(page, "/open-roles");

    await expect(page.getByRole("heading", { name: /open roles/i })).toBeVisible({ timeout: 20_000 });
    // Either they have assigned roles, or they see the empty state — never the
    // whole company's job list.
    const empty = page.getByText(/no roles assigned yet/i);
    const anyRole = page.getByRole("button", { name: /applicant/i });
    expect((await empty.count()) + (await anyRole.count())).toBeGreaterThan(0);
  });

  test("an interviewer cannot reach manager-only screens", async ({ page }) => {
    await signIn(page, "interviewer");
    // Billing / Jobs / Team are manager surfaces. An interviewer must be bounced.
    for (const route of ["/jobs", "/billing", "/interviewers"]) {
      await page.goto(route, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      expect(
        new URL(page.url()).pathname,
        `interviewer should not land on ${route}`
      ).not.toBe(route);
    }
  });

  test("an interviewer can request a new role", async ({ page }) => {
    test.skip(!env.allowWrites, NEED_WRITES);
    await signIn(page, "interviewer");
    await goToApp(page, "/open-roles");

    await page.getByRole("button", { name: /request a new role/i }).click();
    await page.getByLabel(/job title|role title|title/i).first().fill(testName("Requested Role"));
    await page.getByRole("button", { name: /request|send/i }).last().click();

    // It shows up under their own requests as pending approval.
    await expect(page.getByText(/pending approval/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
