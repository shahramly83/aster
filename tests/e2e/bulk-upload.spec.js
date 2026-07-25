// Bulk resume upload (UploadScreen, ~11105) — the screen behind the "Resume
// Upload" nav item, at /upload. It draws on its own resume_screen credit pool,
// separate from inbound applicant screening.
//
// Rendering, file selection and the client-side gates are free. Actually running
// a screen spends a resume_screen credit and calls Claude, so the real-run spec
// is gated behind E2E_ALLOW_AI.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasCreds, needCreds, env, NEED_AI } from "./helpers/env.js";
import { signIn, goToApp } from "./helpers/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESUME_PDF = path.join(here, "..", "fixtures", "resume.pdf");

test.describe("bulk upload — screen [positive]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test.beforeEach(async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/upload");
  });

  test("renders the dropzone, the tabs, and the accepted types", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /bulk resume upload/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^import$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /recent imports/i })).toBeVisible();

    // PDF, Word and a ZIP are all accepted.
    const input = page.locator('input[type="file"]').first();
    const accept = await input.getAttribute("accept");
    expect(accept).toContain("pdf");
    expect(accept).toContain("wordprocessingml");
    expect(accept).toContain("zip");
    await expect(page.getByText(/pdf, word, or a zip/i)).toBeVisible();
  });

  test("choosing files shows a ready-to-screen batch and a run button", async ({ page }) => {
    // If the workspace is out of resume_screen credits the screen shows the
    // blocking card instead of a dropzone — that's a different (valid) state.
    const blocked = page.getByRole("heading", { name: /out of screening credits/i });
    test.skip(!!(await blocked.count()), "Workspace is out of screening credits; covered by the negative spec.");

    await page.locator('input[type="file"]').first().setInputFiles(RESUME_PDF);
    await expect(page.getByText(/files? ready to screen/i)).toBeVisible({ timeout: 10_000 });
    // The run button carries the count. Selecting files does NOT spend anything;
    // only clicking Upload & Screen would.
    await expect(page.getByRole("button", { name: /upload .* screen/i })).toBeVisible();
    // Clear the batch, leaving the screen clean.
    await page.getByRole("button", { name: /clear all/i }).click();
  });
});

test.describe("bulk upload — out of credits [negative]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("an exhausted pool blocks the upload and points at Buy credits", async ({ page }) => {
    await signIn(page, "tenant");
    await goToApp(page, "/upload");

    const blocked = page.getByRole("heading", { name: /out of screening credits/i });
    test.skip(!(await blocked.count()), "Workspace still has screening credits; nothing to block.");

    await expect(blocked).toBeVisible();
    await expect(page.getByRole("button", { name: /buy credits/i })).toBeVisible();
  });
});

test.describe("bulk upload — real screen [gated]", () => {
  test.skip(!hasCreds("tenant"), needCreds("tenant"));

  test("uploading and screening a resume builds a candidate", async ({ page }) => {
    test.skip(!env.allowAI, NEED_AI);
    await signIn(page, "tenant");
    await goToApp(page, "/upload");

    const blocked = page.getByRole("heading", { name: /out of screening credits/i });
    test.skip(!!(await blocked.count()), "Out of screening credits; cannot run a real screen.");

    await page.locator('input[type="file"]').first().setInputFiles(RESUME_PDF);
    const run = page.getByRole("button", { name: /upload .* screen/i });
    await expect(run).toBeEnabled();
    await run.click();

    // Screening runs through Claude; give it room, then expect the run to land in
    // Recent imports (the batch leaves the Import tab's "ready" state).
    await expect(page.getByText(/files? ready to screen/i)).toHaveCount(0, { timeout: 120_000 });
  });
});
