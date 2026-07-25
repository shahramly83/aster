// The hiring pipeline past the applicant list: opening a candidate, the
// scorecard, the decision panel, the offer modal (Compose vs Upload), and the
// reject flow.
//
// These describe a candidate's downstream state, so each spec opens the first
// candidate on E2E_APPLY_JOB_ID and SKIPS when the surface it needs isn't
// present (no candidate, no decision panel, etc.) rather than failing.
//
// Reads are free. Submitting a scorecard writes rows (E2E_ALLOW_WRITES). Sending
// an offer or a rejection emails the candidate (E2E_ALLOW_EMAIL) — those final
// clicks are gated; the validation and modal wiring around them are not.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_WRITES } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

// Open the first candidate's profile on the configured job. Returns false if the
// job has no candidates to open.
async function openFirstCandidate(page) {
  await goToApp(page, `/applicants/${env.applyJobId}`);
  await expect(page.getByRole("heading", { name: /applicants/i })).toBeVisible({ timeout: 20_000 });
  const view = page.getByRole("button", { name: /^view$/i }).first();
  if (!(await view.count())) return false;
  await view.click();
  await page.waitForTimeout(1200);
  return true;
}

test.describe("candidate profile", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID.");

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
  });

  test("[positive] a candidate opens with the Profile and Interview tabs", async ({ page }) => {
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");
    await expect(page.getByRole("tab", { name: /^profile$/i }).or(page.getByRole("button", { name: /^profile$/i })).first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^interview$/i).first()).toBeVisible();
  });

  // --- Scorecards -----------------------------------------------------------
  test("[negative] a scorecard cannot be submitted until every area is rated", async ({ page }) => {
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");

    const start = page.getByRole("button", { name: /start scoring|add your scorecard|add my scorecard/i }).first();
    test.skip(!(await start.count()), "No scorecard entry point (interview may not be scheduled yet).");
    await start.click();

    const submit = page.getByRole("button", { name: /submit scorecard/i }).first();
    await expect(submit).toBeVisible({ timeout: 10_000 });
    // With nothing rated yet, Submit is locked.
    await expect(submit).toBeDisabled();
  });

  test("[positive, WRITES] a fully rated scorecard can be submitted", async ({ page }) => {
    test.skip(!env.allowWrites, NEED_WRITES);
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");

    const start = page.getByRole("button", { name: /start scoring|add your scorecard|add my scorecard/i }).first();
    test.skip(!(await start.count()), "No scorecard entry point.");
    await start.click();
    await expect(page.getByRole("button", { name: /submit scorecard/i })).toBeVisible({ timeout: 10_000 });

    // Rate every "4" available (one per criterion), then pick a recommendation.
    const fours = page.getByRole("button", { name: /^4$/ });
    const n = await fours.count();
    for (let i = 0; i < n; i++) await fours.nth(i).click();
    const rec = page.getByRole("button", { name: /^(strong yes|yes)$/i }).first();
    if (await rec.count()) await rec.click();

    const submit = page.getByRole("button", { name: /submit scorecard/i });
    // If the layout offered more than four "4"s (unexpected), the assertion below
    // still holds: a complete card enables submit.
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
    await expect(page.getByText(/team scorecards|team avg|submitted/i).first()).toBeVisible({ timeout: 20_000 });
  });

  // --- Offer modal ----------------------------------------------------------
  test("[positive] Make an offer opens the offer modal with both letter modes", async ({ page }) => {
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");

    const make = page.getByRole("button", { name: /make an offer/i }).first();
    test.skip(!(await make.count()), "No 'Make an offer' action (candidate not at the decision stage).");
    await make.click();

    // A "decide without scorecards?" confirm may intercept; continue through it.
    const cont = page.getByRole("button", { name: /continue to offer/i });
    if (await cont.count()) await cont.click().catch(() => {});

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/send offer to/i)).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: /compose in aster/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /upload our letter/i })).toBeVisible();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
  });

  test("[negative] composing an offer with no terms is refused", async ({ page }) => {
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");

    const make = page.getByRole("button", { name: /make an offer/i }).first();
    test.skip(!(await make.count()), "No 'Make an offer' action here.");
    await make.click();
    const cont = page.getByRole("button", { name: /continue to offer/i });
    if (await cont.count()) await cont.click().catch(() => {});

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: /compose in aster/i }).click();

    // Send with empty terms — the modal must complain and stay open (no send).
    await dialog.getByRole("button", { name: /send offer|submit for approval|record offer/i }).first().click();
    await expect(dialog.getByText(/add the job title|add the base salary|add the start date/i).first()).toBeVisible();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
  });

  // --- Reject ---------------------------------------------------------------
  test("[negative-safe] the reject flow opens a modal and Cancel sends nothing", async ({ page }) => {
    const ok = await openFirstCandidate(page);
    test.skip(!ok, "No candidates on this job to open.");

    const reject = page.getByRole("button", { name: /^reject/i }).first();
    test.skip(!(await reject.count()), "No reject control on this candidate.");
    await reject.click();

    // Either the rejection email modal or the "Reject {name}?" confirm appears.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(
      dialog.getByRole("button", { name: /send .* reject|reject without email|reject and send email/i }).first()
    ).toBeVisible();
    // Back out — no rejection is sent.
    await dialog.getByRole("button", { name: /^cancel$|^back$/i }).first().click();
  });
});
