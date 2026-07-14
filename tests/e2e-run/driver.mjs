// Staged E2E driver for a full manual-equivalent run against PRODUCTION.
// ---------------------------------------------------------------------------
// The signup + invite flows are gated on emailed links, which a script can't
// read. So this runs in stages: each stage does what it can, screenshots, and
// stops where a link is needed. You paste the link, we continue.
//
// Each account keeps its own persistent browser profile, so a session survives
// between stages.
//
//   node tests/e2e-run/driver.mjs signup
//   node tests/e2e-run/driver.mjs confirm "<link from the email>"
//   node tests/e2e-run/driver.mjs profile
//   node tests/e2e-run/driver.mjs invite
//   node tests/e2e-run/driver.mjs accept hiring1@onlazy.com "<invite link>"
//   node tests/e2e-run/driver.mjs login tenant
//   node tests/e2e-run/driver.mjs shot tenant /dashboard
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PROFILES = join(__dirname, ".profiles");
const SHOTS = join(__dirname, "shots");
const LOGO = join(ROOT, "tests", "fixtures", "onlazy-logo.png");

// --- The test workspace -----------------------------------------------------
export const CFG = {
  base: process.env.E2E_BASE || "https://hireaster.com",
  company: "Onlazy Blogger Sdn Bhd",
  slug: "onlazy",
  password: "password123@",
  tenant: { email: "tenant@onlazy.com", first: "Tara", last: "Tenant" },
  managers: [
    { email: "hiring1@onlazy.com", first: "Hana", last: "Manager" },
    { email: "hiring2@onlazy.com", first: "Haziq", last: "Manager" },
    { email: "hiring3@onlazy.com", first: "Hema", last: "Manager" },
  ],
  interviewers: [
    { email: "interviewer1@onlazy.com", first: "Ivan", last: "Reviewer" },
    { email: "interviewer2@onlazy.com", first: "Iris", last: "Reviewer" },
    { email: "interviewer3@onlazy.com", first: "Idris", last: "Reviewer" },
  ],
};
const allPeople = () => [CFG.tenant, ...CFG.managers, ...CFG.interviewers];
const personFor = (email) => allPeople().find((p) => p.email === email);
// The workspace lives on its own subdomain once provisioned.
const wsOrigin = () => (CFG.base.includes("hireaster.com") ? `https://${CFG.slug}.hireaster.com` : CFG.base);

// --- Browser plumbing -------------------------------------------------------
const key = (email) => email.split("@")[0];

export async function ctxFor(who) {
  await mkdir(PROFILES, { recursive: true });
  await mkdir(SHOTS, { recursive: true });
  const dir = join(PROFILES, key(who));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30_000);
  return { ctx, page };
}

export async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${file}`);
  return file;
}

const settle = (page, ms = 2500) => page.waitForTimeout(ms);

// --- Stages -----------------------------------------------------------------

// 1) Sign the tenant up. Stops at the "check your email" state.
async function signup() {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log(`▶ signup: ${CFG.tenant.email} / ${CFG.company}`);

  await page.goto(`${CFG.base}/signup`, { waitUntil: "load" });
  await settle(page);

  await page.fill("#su-company", CFG.company);
  await page.fill("#su-first", CFG.tenant.first);
  await page.fill("#su-last", CFG.tenant.last);
  await page.fill("#su-email", CFG.tenant.email);
  await page.fill("#su-password", CFG.password);
  await page.fill("#su-confirm", CFG.password);

  // The slug auto-derives from the company name; force ours so the subdomain
  // is predictable.
  await page.fill("#su-url", CFG.slug);
  await settle(page, 2000); // debounced availability check

  await shot(page, "01-signup-filled");

  const slugTaken = await page.getByText(/taken|not available|already/i).count();
  if (slugTaken) {
    console.log(`  ⚠ slug "${CFG.slug}" may be taken — check the screenshot.`);
  }

  const cta = page.getByRole("button", { name: /free trial|create account|continue to payment/i }).first();
  const disabled = await cta.isDisabled();
  console.log(`  CTA "${(await cta.innerText()).trim()}" enabled=${!disabled}`);
  if (disabled) {
    await shot(page, "01-signup-BLOCKED");
    console.log("  ❌ Submit is disabled — form validation is unhappy. See screenshot.");
    await ctx.close();
    return;
  }

  await cta.click();
  await settle(page, 6000);
  await shot(page, "02-signup-submitted");

  const sent = await page.getByText(/confirmation link|check your (email|inbox)/i).count();
  const err = await page.getByText(/couldn't|could not|error|already/i).count();
  if (sent) {
    console.log("  ✅ Signup accepted. Confirmation email sent.");
    console.log(`  ⏸  NEXT: paste the link from the email to ${CFG.tenant.email}:`);
    console.log(`      node tests/e2e-run/driver.mjs confirm "<link>"`);
  } else if (err) {
    const text = await page.locator("body").innerText();
    console.log("  ❌ Signup error. Page says:\n" + text.slice(0, 600));
  } else {
    console.log("  ⚠ Unexpected state after submit — see 02-signup-submitted.png");
  }
  await ctx.close();
}

// 2) Open the emailed confirmation link and land in the workspace.
async function confirm(url) {
  if (!url) throw new Error('Pass the link: driver.mjs confirm "<url>"');
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log(`▶ confirm: opening the emailed link`);
  await page.goto(url, { waitUntil: "load" });
  await settle(page, 8000); // confirm -> provision -> forward to subdomain
  console.log(`  landed on: ${page.url()}`);
  await shot(page, "03-after-confirm");

  // If it dropped us at a login form, sign in to finish.
  if (/\/login/.test(page.url()) && (await page.locator("input[type=email], #li-email").count())) {
    console.log("  → confirmation landed on login; signing in");
    await signInOn(page, CFG.tenant.email);
  }
  console.log(`  now at: ${page.url()}`);
  await shot(page, "04-workspace");
  await ctx.close();
}

// Shared: sign in on whatever login page `page` is currently showing.
async function signInOn(page, email) {
  const emailBox = page.getByLabel(/^email$/i).first();
  await emailBox.fill(email);
  await page.getByLabel(/^password$/i).first().fill(CFG.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await settle(page, 8000);
}

// Log a given account in from scratch (used after invites are accepted).
async function login(who) {
  const email = who.includes("@") ? who : CFG[who]?.email || CFG.tenant.email;
  const { ctx, page } = await ctxFor(email);
  console.log(`▶ login: ${email}`);
  await page.goto(`${wsOrigin()}/login`, { waitUntil: "load" });
  await settle(page);
  await signInOn(page, email);
  console.log(`  now at: ${page.url()}`);
  await shot(page, `login-${key(email)}`);
  await ctx.close();
}

// 3) Fill the company profile + upload the logo (tenant).
async function profile() {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log("▶ profile: completing company + personal profile, uploading logo");
  await page.goto(`${wsOrigin()}/profile`, { waitUntil: "load" });
  await settle(page, 4000);
  await shot(page, "05-profile-before");

  // Try the accessible label first (that's how a real user / screen reader finds
  // a field). Fall back to the placeholder, so we still make progress on builds
  // where the label isn't wired to its input.
  const fill = async (label, labelRe, placeholderRe, value) => {
    let el = page.getByLabel(labelRe).first();
    let via = "label";
    if (!(await el.count())) {
      el = page.getByPlaceholder(placeholderRe).first();
      via = "placeholder (label NOT linked — a11y bug)";
    }
    if (!(await el.count())) { console.log(`  ✗ ${label}: not found at all`); return false; }
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.fill(value);
    const got = await el.inputValue();
    console.log(`  ${got === value ? "✓" : "⚠"} ${label} via ${via}`);
    return got === value;
  };

  await fill("Company name", /company name/i, /your company/i, CFG.company);
  await fill("Registration no", /registration/i, /202301012345/i, "202401234567 (1234567-A)");
  await fill("Street address", /street address/i, /unit \/ building/i, "Level 12, Menara Onlazy, Jalan Sultan Ismail");
  await fill("City", /^city$/i, /^Kuala Lumpur$/i, "Kuala Lumpur");
  await fill("State", /state/i, /^Selangor$/i, "Wilayah Persekutuan");
  await fill("Postcode", /postcode|postal/i, /^50450$/i, "50250");
  await fill("Country", /^country$/i, /^Malaysia$/i, "Malaysia");
  await fill("First name", /first name/i, /^Jane$/i, CFG.tenant.first);
  await fill("Last name", /last name/i, /^Tan$/i, CFG.tenant.last);
  await fill("Contact number", /phone|contact number/i, /\+60 12 345 6789/i, "+60 3-2711 8899");

  // Logo upload.
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  if (count) {
    await fileInputs.first().setInputFiles(LOGO);
    console.log("  → logo file attached");
    await settle(page, 2500);
  } else {
    console.log("  ⚠ no file input found on the profile screen");
  }

  const save = page.getByRole("button", { name: /save/i }).first();
  if (await save.count()) {
    await save.click();
    await settle(page, 5000);
    console.log("  → saved");
  } else {
    console.log("  ⚠ no Save button found");
  }
  await shot(page, "06-profile-after");
  await ctx.close();
}

// 4) Invite the 6 teammates. Stops; you paste each invite link.
async function invite() {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log("▶ invite: 3 hiring managers + 3 interviewers");
  await page.goto(`${wsOrigin()}/interviewers`, { waitUntil: "load" });
  await settle(page, 4000);
  await shot(page, "07-team-before");

  const invites = [
    ...CFG.managers.map((m) => ({ ...m, role: "admin" })),
    ...CFG.interviewers.map((i) => ({ ...i, role: "interviewer" })),
  ];

  for (const person of invites) {
    console.log(`  → inviting ${person.email} as ${person.role}`);
    const btn = page.getByRole("button", { name: /invite teammate/i }).first();
    if (!(await btn.count())) { console.log("  ❌ no 'Invite teammate' button"); break; }
    await btn.click();
    await settle(page, 1200);

    const emailBox = page.getByLabel(/email/i).first();
    await emailBox.fill(person.email);

    // Role selector: hiring manager (admin) vs interviewer.
    const roleSel = page.locator("select").first();
    if (await roleSel.count()) {
      await roleSel.selectOption(person.role).catch(async () => {
        // fall back to matching by visible label
        const label = person.role === "admin" ? /hiring manager/i : /interviewer/i;
        const opt = page.getByRole("option", { name: label });
        if (await opt.count()) await roleSel.selectOption({ label: await opt.first().innerText() });
      });
    } else {
      const radio = page.getByText(person.role === "admin" ? /hiring manager/i : /interviewer/i).first();
      if (await radio.count()) await radio.click().catch(() => {});
    }

    await page.getByRole("button", { name: /send|invite/i }).last().click();
    await settle(page, 4000);
  }

  await shot(page, "08-team-after-invites");
  console.log("  ✅ invites sent.");
  console.log("  ⏸  NEXT: for EACH invite email, run:");
  console.log('      node tests/e2e-run/driver.mjs accept <email> "<invite link>"');
  await ctx.close();
}

// 5) Accept an invite: open the link, set the password, land in the workspace.
async function accept(email, url) {
  if (!email || !url) throw new Error('Usage: driver.mjs accept <email> "<invite url>"');
  const person = personFor(email);
  if (!person) throw new Error(`Unknown account: ${email}`);

  const { ctx, page } = await ctxFor(email);
  console.log(`▶ accept: ${email}`);
  await page.goto(url, { waitUntil: "load" });
  await settle(page, 5000);
  await shot(page, `09-accept-${key(email)}-open`);

  // The accept form asks for a name + password (email is locked to the invite).
  const first = page.getByLabel(/first name/i).first();
  if (await first.count()) await first.fill(person.first);
  const last = page.getByLabel(/last name/i).first();
  if (await last.count()) await last.fill(person.last);

  const pw = page.getByLabel(/^password$/i).first();
  if (await pw.count()) await pw.fill(CFG.password);
  const cpw = page.getByLabel(/confirm/i).first();
  if (await cpw.count()) await cpw.fill(CFG.password);

  const cta = page.getByRole("button", { name: /create|accept|join|sign in/i }).first();
  if (await cta.count()) {
    await cta.click();
    await settle(page, 8000);
  }
  console.log(`  now at: ${page.url()}`);
  await shot(page, `10-accept-${key(email)}-done`);
  await ctx.close();
}

// Utility: screenshot any route as any account.
async function shotRoute(who, route) {
  const email = who.includes("@") ? who : CFG[who]?.email || CFG.tenant.email;
  const { ctx, page } = await ctxFor(email);
  await page.goto(`${wsOrigin()}${route}`, { waitUntil: "load" });
  await settle(page, 4000);
  console.log(`${email} @ ${route} -> ${page.url()}`);
  await shot(page, `route-${key(email)}-${route.replace(/\//g, "_")}`);
  await ctx.close();
}

// --- CLI --------------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
const run = {
  signup: () => signup(),
  confirm: () => confirm(args[0]),
  profile: () => profile(),
  invite: () => invite(),
  accept: () => accept(args[0], args[1]),
  login: () => login(args[0] || "tenant"),
  shot: () => shotRoute(args[0], args[1] || "/dashboard"),
};
if (!run[cmd]) {
  console.log("Commands: signup | confirm <url> | profile | invite | accept <email> <url> | login <who> | shot <who> <route>");
  process.exit(1);
}
await run[cmd]();
