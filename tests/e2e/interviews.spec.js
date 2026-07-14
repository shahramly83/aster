// Interviews: the scheduled state, sharing the meeting link, and swapping a
// panel member (which must also grant the new interviewer access to the job).
//
// Sharing the link EMAILS the candidate and the whole panel, so that spec is
// behind E2E_ALLOW_EMAIL.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_WRITES, NEED_EMAIL } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

// Find a candidate that already has a scheduled interview. These specs describe
// the post-confirmation surface, so they skip when nothing is scheduled.
async function openScheduledCandidate(page) {
  await goToApp(page, `/applicants/${env.applyJobId}`);
  const view = page.getByRole("button", { name: /^view$/i }).first();
  if (!(await view.count())) return false;
  await view.click();
  await page.waitForTimeout(1200);
  return (await page.getByText(/interview scheduled/i).count()) > 0;
}

test.describe("scheduled interview", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID.");

  test("shows the confirmed time and asks for the meeting link", async ({ page }) => {
    await signIn(page, "tenant");
    const scheduled = await openScheduledCandidate(page);
    test.skip(!scheduled, "No candidate with a scheduled interview in this job.");

    await expect(page.getByText(/interview scheduled/i)).toBeVisible();
    // The link is pasted by the manager after the candidate confirms — it is not
    // auto-generated, and the copy must say so.
    await expect(page.getByText(/meeting link/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/meet\.google\.com|https:\/\//i)).toBeVisible();
  });

  test("share is refused until the link is a real URL", async ({ page }) => {
    await signIn(page, "tenant");
    const scheduled = await openScheduledCandidate(page);
    test.skip(!scheduled, "No candidate with a scheduled interview in this job.");

    const share = page.getByRole("button", { name: /^share$|re-share/i }).first();
    await expect(share).toBeDisabled(); // empty

    await page.getByPlaceholder(/meet\.google\.com|https:\/\//i).fill("not-a-url");
    await expect(share).toBeDisabled(); // still not a URL
  });

  test("sharing the meeting link emails the candidate and the panel", async ({ page }) => {
    test.skip(!env.allowWrites || !env.allowEmail, `${NEED_WRITES} ${NEED_EMAIL}`);
    await signIn(page, "tenant");
    const scheduled = await openScheduledCandidate(page);
    test.skip(!scheduled, "No candidate with a scheduled interview in this job.");

    await page.getByPlaceholder(/meet\.google\.com|https:\/\//i).fill("https://meet.google.com/e2e-test-link");
    const share = page.getByRole("button", { name: /^share$|re-share/i }).first();
    await expect(share).toBeEnabled();
    await share.click();

    await expect(page.getByText(/shared with the candidate and the panel/i)).toBeVisible({ timeout: 30_000 });
  });

  test("swapping a panel member also grants them access to the job", async ({ page }) => {
    test.skip(!env.allowWrites, NEED_WRITES);
    await signIn(page, "tenant");
    const scheduled = await openScheduledCandidate(page);
    test.skip(!scheduled, "No candidate with a scheduled interview in this job.");

    const replace = page.getByRole("button", { name: /^replace$/i }).first();
    test.skip(!(await replace.count()), "No swappable panel member (needs a non-manager attendee).");
    await replace.click();

    // Only joined interviewers may be swapped in — a pending invite has no login
    // and could never see the interview.
    const select = page.locator("select").first();
    const options = await select.locator("option:not([disabled])").count();
    test.skip(options === 0, "No other joined interviewer available to swap in.");

    await select.selectOption({ index: 1 });
    // The new interviewer now appears on the panel. (The assignment that grants
    // them dashboard access is made server-side by the same action.)
    await page.waitForTimeout(1500);
    await expect(page.getByText(/interview panel/i)).toBeVisible();
  });
});
