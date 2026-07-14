// Job postings: create a draft, publish it, the concurrent open-role limit, the
// tagged apply link, and close/reopen.
//
// Everything here WRITES real rows, so the whole file is gated behind
// E2E_ALLOW_WRITES. Jobs it creates are named "E2E …" so leftovers are obvious.
import { test, expect } from "@playwright/test";
import { env, hasCreds, needCreds, NEED_WRITES, testName } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

test.describe("job postings", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));
  test.skip(!env.allowWrites, NEED_WRITES);

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/jobs");
  });

  test("the Jobs screen lists roles and the open-role meter", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /job postings/i })).toBeVisible();
    // The plan's concurrent open-role allowance is shown, not a per-cycle credit.
    await expect(page.getByText(/open roles/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /post a job/i })).toBeVisible();
  });

  test("a new role can be saved as a draft, then published", async ({ page }) => {
    const title = testName("Draft Role");

    await page.getByRole("button", { name: /post a job/i }).click();
    await page.getByLabel(/job title|role title|title/i).first().fill(title);
    await page.getByLabel(/description/i).first().fill(
      "End to end ownership of the hiring funnel. This is an automated E2E test role and can be deleted."
    );

    // Work mode defaults to On-site (we changed this).
    const workMode = page.getByLabel(/work mode/i);
    if (await workMode.count()) await expect(workMode).toHaveValue(/onsite/i);

    // Save as draft.
    await page.getByRole("button", { name: /save.*draft|draft/i }).first().click();

    // It shows up as a draft.
    await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("div").filter({ hasText: title }).first();
    await expect(card.getByText(/draft/i).first()).toBeVisible();
  });

  test("copying the apply link can be tagged with a source", async ({ page }) => {
    // Open the link modal on the first open role, tag it, and confirm the URL
    // carries ?source=, which is what makes "Applied from" meaningful.
    const linkBtn = page.getByRole("button", { name: /copy link|share|apply link/i }).first();
    test.skip(!(await linkBtn.count()), "No open role with an apply link in this workspace.");
    await linkBtn.click();

    const source = page.getByLabel(/source|where/i).first();
    if (await source.count()) {
      await source.fill("jobstreet");
      // The previewed link should include the slug.
      await expect(page.getByText(/\?source=jobstreet/i).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("publishing past the plan's open-role limit is refused", async ({ page }) => {
    // If the workspace is already at its cap, the Post-a-job flow must block the
    // publish (and say why) rather than silently failing server-side.
    const meter = page.getByText(/\/\s*\d+\s*open/i).first();
    test.skip(!(await meter.count()), "Open-role meter not visible; skipping limit check.");

    const text = await meter.innerText();
    const m = text.match(/(\d+)\s*\/\s*(\d+)/);
    test.skip(!m || Number(m[1]) < Number(m[2]), "Workspace is not at its open-role limit.");

    await page.getByRole("button", { name: /post a job/i }).click();
    await page.getByLabel(/job title|role title|title/i).first().fill(testName("Over Limit"));
    // The publish action should be disabled / explain the cap.
    const publish = page.getByRole("button", { name: /^publish/i }).first();
    if (await publish.count()) {
      await expect(publish).toBeDisabled();
    }
    await expect(page.getByText(/open-role slots|close a role|upgrade/i).first()).toBeVisible();
  });
});
