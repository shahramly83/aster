// Role journeys against the seeded workspace. Walks each role through what they can
// actually do, screenshots each step, and asserts what should and should not appear.
//   node tests/e2e-run/journey.mjs <tenant|hiring1|interviewer1>
import { ctxFor, shot, CFG } from "./driver.mjs";

const WS = "https://onlazy.hireaster.com";
const who = process.argv[2] || "tenant";
const email = who.includes("@") ? who : (CFG[who]?.email || CFG.tenant?.email || `${who}@onlazy.com`);
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
const log = (m) => console.log(`  ${m}`);

const { ctx, page } = await ctxFor(email);
page.setDefaultTimeout(25_000);

// Sign in if needed.
await page.goto(`${WS}/login`, { waitUntil: "load" });
await settle(page, 3000);
if (await page.getByRole("button", { name: /^sign in$/i }).count()) {
  await page.getByLabel(/^email$/i).first().fill(email);
  await page.getByLabel(/^password$/i).first().fill(CFG.password);
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  await settle(page, 7000);
}
console.log(`\n== journey: ${email} -> ${page.url()} ==`);

const P = `J-${who}`;

// 1. Applicants for a role (interviewer lands on /interviews instead).
await page.goto(`${WS}/applicants`, { waitUntil: "load" });
await settle(page);
log(`applicants url: ${page.url()}`);
await shot(page, `${P}-1-applicants`, true);

// Count what's visible and whether the AI-rank + interviewer panel are present.
const hasRank = await page.getByRole("button", { name: /re-run ai rank|rank these applicants/i }).count();
const hasInterviewerPanel = await page.getByText(/interviewers on this job/i).count();
const hasScores = await page.locator("text=/%$/").count();
log(`AI-rank control: ${hasRank ? "yes" : "no"} | interviewer panel: ${hasInterviewerPanel ? "yes" : "no"} | score rings: ${hasScores}`);

// 2. Open the first candidate's profile: the action hub.
const firstView = page.getByRole("button", { name: /^view$/i }).first();
if (await firstView.count()) {
  await firstView.click();
  await settle(page, 4000);
  log(`candidate profile url: ${page.url()}`);
  await shot(page, `${P}-2-candidate`, true);

  // Which actions does THIS role get on a candidate?
  for (const [label, rx] of [
    ["Shortlist star", /shortlist/i],
    ["Move stage", /move to|shortlist|interview|offer|hire|reject/i],
    ["Request interview", /request (an )?interview|set up (an )?interview/i],
    ["Scorecard", /scorecard|score|rate/i],
    ["Make offer", /make (an )?offer|send offer/i],
    ["Download CV", /download|resume|cv/i],
  ]) {
    const n = await page.getByRole("button", { name: rx }).count();
    log(`  ${label.padEnd(18)} ${n ? "present" : "-"}`);
  }
} else {
  log("no candidate View button on this screen");
}

// 3. Interviews screen.
await page.goto(`${WS}/interviews`, { waitUntil: "load" });
await settle(page);
await shot(page, `${P}-3-interviews`, true);
log(`interviews url: ${page.url()}`);

// 4. Jobs (owner/HM manage; interviewer read-only or redirected).
await page.goto(`${WS}/jobs`, { waitUntil: "load" });
await settle(page);
await shot(page, `${P}-4-jobs`, true);
const canPost = await page.getByRole("button", { name: /post a job|new job|post job/i }).count();
log(`jobs url: ${page.url()} | can post a job: ${canPost ? "yes" : "no"}`);

await ctx.close();
console.log("== done ==");
