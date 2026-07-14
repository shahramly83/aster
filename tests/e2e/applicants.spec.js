// Applicants screen: the Strong / Non-Match split, the per-user shortlist star
// and filter, stage moves, and AI Rank (which writes the free "Why" line).
//
// Reads are free. Starring and stage moves write rows (E2E_ALLOW_WRITES).
// AI Rank spends a real credit and calls Claude (E2E_ALLOW_AI).
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_WRITES, NEED_AI } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

// Open the applicants screen for the configured job.
async function openApplicants(page) {
  await goToApp(page, `/applicants/${env.applyJobId}`);
  await expect(page.getByRole("heading", { name: /applicants/i })).toBeVisible({ timeout: 20_000 });
}

test.describe("applicants", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID to the job whose applicants you want to drive.");

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await openApplicants(page);
  });

  test("splits candidates into Strong Matches, Non-Matches and Hired", async ({ page }) => {
    await expect(page.getByRole("button", { name: /strong matches/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /non-matches/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /hired/i })).toBeVisible();
  });

  test("a Non-Match shows the AI's fit reason, which cost nothing extra", async ({ page }) => {
    await page.getByRole("button", { name: /non-matches/i }).click();
    const badge = page.getByText(/not a match for this role/i).first();
    test.skip(!(await badge.count()), "No non-matching applicants in this job.");
    // The "Why" is generated during the parse and shown for free.
    await expect(page.getByText(/^why:/i).first()).toBeVisible();
  });

  test("the shortlist star toggles and the Shortlisted filter narrows the list", async ({ page }) => {
    test.skip(!env.allowWrites, NEED_WRITES);

    const star = page.getByRole("button", { name: /add to your shortlist/i }).first();
    test.skip(!(await star.count()), "No applicants to shortlist in this job.");

    await star.click();
    // Once starred it flips to the "remove" affordance and the filter counts it.
    await expect(page.getByRole("button", { name: /remove from your shortlist/i }).first()).toBeVisible();

    const filter = page.getByRole("button", { name: /shortlisted/i }).first();
    await filter.click();
    // Filtering to my picks shows at least the one I just starred.
    await expect(page.getByRole("button", { name: /remove from your shortlist/i }).first()).toBeVisible();
    await expect(page.getByText(/shortlisted/i).first()).toBeVisible();

    // Clean up: unstar so re-runs start from the same place.
    await page.getByRole("button", { name: /remove from your shortlist/i }).first().click();
  });

  test("the shortlist survives a page reload (it's saved per user)", async ({ page }) => {
    test.skip(!env.allowWrites, NEED_WRITES);
    const star = page.getByRole("button", { name: /add to your shortlist/i }).first();
    test.skip(!(await star.count()), "No applicants to shortlist in this job.");

    await star.click();
    await expect(page.getByRole("button", { name: /remove from your shortlist/i }).first()).toBeVisible();

    await openApplicants(page); // full reload
    await expect(page.getByRole("button", { name: /remove from your shortlist/i }).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /remove from your shortlist/i }).first().click(); // cleanup
  });

  // --- AI Rank. Spends a real credit. ---
  test("AI Rank scores candidates and writes a free Why for each", async ({ page }) => {
    test.skip(!env.allowAI, NEED_AI);

    const rank = page.getByRole("button", { name: /^ai rank|re-run ai rank/i }).first();
    await expect(rank).toBeVisible();
    // Needs 2+ rankable candidates; the button is locked otherwise.
    test.skip(await rank.isDisabled(), "AI Rank needs at least 2 candidates in Strong Matches.");

    await rank.click();
    // A confirmation may guard the credit spend.
    const confirm = page.getByRole("button", { name: /run|confirm|yes/i }).last();
    if (await confirm.count()) await confirm.click().catch(() => {});

    // Scores land, and each ranked candidate carries its "Why" for free.
    await expect(page.getByText(/^why:/i).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/%/).first()).toBeVisible();
  });
});
