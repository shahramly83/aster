// The public apply page — the candidate-facing surface. No auth.
//
// Rendering assertions are free and always run (given E2E_APPLY_JOB_ID).
// Actually SUBMITTING an application is gated behind E2E_ALLOW_AI, because the
// submit spends a resume-parse credit, calls Claude, stores a candidate, and
// emails the hiring managers.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, NEED_AI } from "./helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESUME_PDF = path.join(here, "..", "fixtures", "resume.pdf");

const applyPath = (q = "") => `/apply/${env.applyJobId}${q}`;

test.describe("apply page", () => {
  test.skip(!env.applyJobId, "Set E2E_APPLY_JOB_ID to an OPEN job in the test workspace.");

  test("renders the role, the upload box, and the Aster credit", async ({ page }) => {
    await page.goto(applyPath(), { waitUntil: "load" });

    // The job is presented and the apply card is there.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/apply for this role/i)).toBeVisible();

    // Upload accepts PDF *and* Word, and says so.
    await expect(page.getByText(/pdf or word/i)).toBeVisible();
    const input = page.locator('input[type="file"]');
    const accept = await input.getAttribute("accept");
    expect(accept).toContain("pdf");
    expect(accept).toContain("docx");

    // "Powered by Aster" credit is present and links home.
    const credit = page.getByRole("link", { name: /aster/i }).last();
    await expect(credit).toBeVisible();
    await expect(credit).toHaveAttribute("href", /hireaster\.com/);
  });

  test("submit stays disabled until a file is chosen", async ({ page }) => {
    await page.goto(applyPath(), { waitUntil: "load" });
    const submit = page.getByRole("button", { name: /submit application/i });
    await expect(submit).toBeVisible({ timeout: 20_000 });
    await expect(submit).toBeDisabled();
  });

  test("rejects a non-resume file type with a human error", async ({ page }) => {
    await page.goto(applyPath(), { waitUntil: "load" });
    // Feed it something that is neither PDF nor .docx.
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not a resume"),
    });
    await expect(page.getByText(/pdf or word/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /submit application/i })).toBeDisabled();
  });

  test("a ?source= tag is carried on the link", async ({ page }) => {
    // The page must still render normally when tagged; the tag is read at submit
    // time and stored as "Applied from".
    await page.goto(applyPath("?source=jobstreet"), { waitUntil: "load" });
    await expect(page.getByText(/apply for this role/i)).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toContain("source=jobstreet");
  });

  // --- The real submit. Spends a parse credit + emails the team. ---
  test("submitting a PDF resume files an application", async ({ page }) => {
    test.skip(!env.allowAI, NEED_AI);

    await page.goto(applyPath("?source=e2e"), { waitUntil: "load" });
    await page.locator('input[type="file"]').setInputFiles(RESUME_PDF);

    const submit = page.getByRole("button", { name: /submit application/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    // Parsing runs through Claude; give it room, then expect the success state.
    await expect(page.getByText(/you're in/i)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/aster has read your resume/i)).toBeVisible();
  });
});

test.describe("apply page — draft preview", () => {
  test.skip(!env.draftJobId, "Set E2E_DRAFT_JOB_ID to a DRAFT job to cover the draft-preview state.");

  test("a draft's public link does not take applications", async ({ page }) => {
    await page.goto(`/apply/${env.draftJobId}`, { waitUntil: "load" });
    // A public visitor to an unpublished role gets the closed notice, never a
    // working upload box.
    await expect(page.getByText(/closed|isn't taking applications/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /submit application/i })).toHaveCount(0);
  });
});
