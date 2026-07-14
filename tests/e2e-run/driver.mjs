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
const AVATAR = join(ROOT, "tests", "fixtures", "tara-avatar.png");
const RESUME = join(ROOT, "tests", "fixtures", "resume.pdf");

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

export async function shot(page, name, full = false) {
  await mkdir(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
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

  // Two separate uploads live on this screen: the COMPANY LOGO and the user's
  // PROFILE PHOTO. Fill both, and say which is which.
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  console.log(`  file inputs on page: ${count}`);
  if (count >= 1) {
    await fileInputs.nth(0).setInputFiles(LOGO);
    console.log("  ✓ company logo attached");
    await settle(page, 2000);
  }
  if (count >= 2) {
    await fileInputs.nth(1).setInputFiles(AVATAR);
    console.log("  ✓ profile photo attached");
    await settle(page, 2000);
  } else {
    console.log("  ⚠ no second file input — profile photo could not be set");
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
async function invite(only) {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  await page.goto(`${wsOrigin()}/interviewers`, { waitUntil: "load" });
  await settle(page, 4000);
  await shot(page, "07-team-before");

  let invites = [
    ...CFG.managers.map((m) => ({ ...m, role: "admin" })),
    ...CFG.interviewers.map((i) => ({ ...i, role: "interviewer" })),
  ];
  if (only && only.length) invites = invites.filter((p) => only.includes(p.email));
  console.log(`▶ invite: ${invites.map((i) => `${i.email}(${i.role})`).join(", ")}`);

  for (const person of invites) {
    console.log(`  → inviting ${person.email} as ${person.role}`);

    // The Work email field takes only the LOCAL PART; the workspace domain
    // (@onlazy.com) is locked on as a suffix, so you can't invite outsiders.
    const emailBox = page.getByPlaceholder("jane").first();
    if (!(await emailBox.isVisible().catch(() => false))) {
      const btn = page.getByRole("button", { name: /invite teammate/i }).first();
      if (!(await btn.count())) { console.log("  ❌ no 'Invite teammate' button"); break; }
      await btn.click();
      await settle(page, 1500);
    }
    if (!(await emailBox.isVisible().catch(() => false))) {
      await shot(page, `invite-FAIL-${key(person.email)}`);
      console.log(`  ❌ invite form did not open for ${person.email}`);
      continue;
    }
    await emailBox.fill(person.email.split("@")[0]);

    // The role picker is two BUTTONS ("Hiring Manager" / "Interviewer"), each
    // describing itself. Click the one we want and verify it took.
    const wanted = person.role === "admin" ? "Hiring Manager" : "Interviewer";
    const roleBtn = page.getByRole("button", { name: new RegExp(`^${wanted}`, "i") })
      .filter({ hasText: /full access|assigned interviews/i }).first();
    if (await roleBtn.count()) {
      await roleBtn.click();
      await settle(page, 600);
    } else {
      console.log(`  ⚠ role button "${wanted}" not found — invite may default to Hiring Manager`);
    }

    await page.getByRole("button", { name: /^send invite$|^send$/i }).last().click();
    await settle(page, 4500);

    // Verify what the app says it actually did.
    const banner = await page.getByText(/invite sent to/i).first().innerText().catch(() => "");
    const said = /as an interviewer/i.test(banner) ? "interviewer" : /hiring manager/i.test(banner) ? "admin" : "?";
    console.log(`     ${said === person.role ? "✓" : "❌"} app says: ${banner.trim().slice(0, 90)}`);
  }

  await shot(page, "08-team-after-invites");
  console.log("  ✅ invites sent.");
  console.log("  ⏸  NEXT: for EACH invite email, run:");
  console.log('      node tests/e2e-run/driver.mjs accept <email> "<invite link>"');
  await ctx.close();
}

// 5) Accept an invite: open the link, set the password, land in the workspace.
async function accept(url) {
  if (!url) throw new Error('Usage: driver.mjs accept "<invite url>"');

  // The invite page locks the email to whoever was invited, so read it off the
  // page rather than trusting a hand-typed argument. Open in a throwaway context
  // first, learn who this is, then continue in that person's own profile.
  const probe = await chromium.launchPersistentContext(join(PROFILES, "_probe"), { headless: true });
  const p0 = probe.pages()[0] || (await probe.newPage());
  await p0.goto(url, { waitUntil: "load" });
  await p0.waitForTimeout(6000);
  const text = await p0.locator("body").innerText().catch(() => "");
  await probe.close();

  const found = allPeople().map((x) => x.email).find((e) => text.includes(e));
  if (!found) {
    console.log("▶ accept: could not read an invited email from that link.");
    console.log("  page said:\n  " + text.split("\n").filter(Boolean).slice(0, 12).join("\n  "));
    return;
  }
  const email = found;
  const person = personFor(email);

  const { ctx, page } = await ctxFor(email);
  console.log(`▶ accept: ${email} (${CFG.managers.some((m) => m.email === email) ? "hiring manager" : "interviewer"})`);
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

// Buy a plan for real, through Stripe Checkout, with a TEST card.
//   node tests/e2e-run/driver.mjs subscribe scale monthly [declined|3ds]
async function subscribe(plan = "scale", cycle = "monthly", variant = "ok") {
  const CARDS = {
    ok: "4242424242424242",
    declined: "4000000000000002",
    "3ds": "4000002500003155",
  };
  const card = CARDS[variant] || CARDS.ok;

  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log(`▶ subscribe: ${plan}/${cycle} with ${variant} card ${card}`);

  await page.goto(`${wsOrigin()}/billing`, { waitUntil: "load" });
  await settle(page, 5000);

  // The saved session does not always survive between runs, and a cancelled
  // workspace lands here signed out. Sign in rather than failing on a missing
  // button: the point of this command is the payment, not the login.
  if (await page.getByRole("button", { name: /^sign in$/i }).count()) {
    console.log("  (signed out; signing back in)");
    await signInOn(page, CFG.tenant.email);
    await settle(page, 6000);
    // Don't force /billing back on: a cancelled workspace is held on the paywall
    // and bounced off /billing, so navigating there again just logs us out. Stay
    // wherever sign-in lands and let the plan buttons be found there.
    console.log(`  landed on ${page.url()}`);
  }

  // Pick the cycle, then the plan's Subscribe button.
  if (cycle === "yearly") {
    const y = page.getByRole("button", { name: /^yearly/i }).first();
    if (await y.count()) { await y.click(); await settle(page, 1200); }
  }
  // The CTA is only "Subscribe" from a trial. Once a plan is live it reads
  // "Upgrade" or "Downgrade", and clicking it changes the plan in place instead
  // of opening Checkout, so match every label and handle both outcomes.
  const CTA = /subscribe|upgrade|downgrade|switch/i;
  const label = plan[0].toUpperCase() + plan.slice(1);
  const card_ = page.locator("div").filter({ hasText: new RegExp(`^${label}`, "i") })
    .filter({ has: page.getByRole("button", { name: CTA }) }).last();
  // The lapsed/cancelled paywall (DeletedWorkspaceScreen) has no "Subscribe"
  // button at all: its CTAs are the plan names themselves. Fall back to those so
  // the resubscribe path is testable.
  const paywallBtn = page.getByRole("button", { name: new RegExp(`^${label}\\b`, "i") }).first();
  const btn = (await card_.count())
    ? card_.getByRole("button", { name: CTA }).first()
    : (await page.getByRole("button", { name: CTA }).count())
      ? page.getByRole("button", { name: CTA }).first()
      : paywallBtn;
  const cta = (await btn.innerText().catch(() => "")).trim().replace(/\s+/g, " ");
  console.log(`  CTA on ${label}: "${cta}"`);
  await btn.click();

  await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 }),
    page.waitForURL(/plan=changed/, { timeout: 45_000 }),
  ]).catch(() => {});

  // Changing an existing plan never opens Checkout: there is already a card on
  // file, so Stripe reprices the live subscription and prorates it.
  if (/plan=changed/.test(page.url())) {
    await settle(page, 4000);
    await shot(page, `P-changed-${plan}`);
    const cur = await page.getByText(/current plan/i).locator("xpath=ancestor::div[1]").innerText().catch(() => "");
    console.log(`  ✅ plan changed in place (no checkout, prorated)\n${cur.split("\n").map((l) => "     " + l).join("\n")}`);
    await ctx.close();
    return;
  }

  if (!/checkout\.stripe\.com/.test(page.url())) {
    await shot(page, `P-no-checkout-${plan}`);
    const err = await page.getByText(/error|could not|couldn't/i).first().innerText().catch(() => "");
    console.log(`  ❌ never reached Stripe. ${err}`);
    await ctx.close();
    return;
  }
  const isTest = /cs_test_/.test(page.url());
  console.log(`  ${isTest ? "🟢 TEST" : "🔴 LIVE"} session (${page.url().match(/cs_(test|live)_/)?.[0]})`);
  if (!isTest) { console.log("  ABORT: refusing to enter a card on a LIVE session."); await ctx.close(); return; }

  await settle(page, 6000);
  await shot(page, `P1-checkout-${plan}`);

  // Stripe hosted Checkout renders its fields on its own domain (no iframes).
  const fill = async (sel, val) => {
    const el = page.locator(sel).first();
    if (await el.count()) { await el.fill(val); return true; }
    return false;
  };
  await fill("#email", CFG.tenant.email);
  await fill("#cardNumber", card);
  await fill("#cardExpiry", "12 / 34");
  await fill("#cardCvc", "123");
  await fill("#billingName", "Tara Tenant");
  const country = page.locator("#billingCountry").first();
  if (await country.count()) await country.selectOption("MY").catch(() => {});
  await fill("#billingPostalCode", "50250");
  await settle(page, 1200);
  await shot(page, `P2-card-filled-${plan}`);

  await page.locator('button[type="submit"], .SubmitButton').first().click();
  console.log("  → submitted payment, waiting for Stripe + webhook…");

  // 3DS pops a challenge, and it lives in an iframe nested inside another iframe.
  // A frameLocator on the top document never reaches it, so walk every frame on
  // the page and click COMPLETE wherever it turns up.
  if (variant === "3ds") {
    await settle(page, 8000);
    let clicked = false;
    for (const fr of page.frames()) {
      const done = fr.getByRole("button", { name: /^(complete|authorize)$/i }).first();
      if (await done.count().catch(() => 0)) {
        await done.click({ timeout: 15_000 }).catch(() => {});
        clicked = true;
        console.log("  ✓ completed the 3DS challenge");
        break;
      }
    }
    if (!clicked) console.log("  ⚠ no 3DS challenge appeared");
  }

  await page.waitForURL(/\/billing|\/dashboard/, { timeout: 90_000 }).catch(() => {});
  await settle(page, 8000); // let the webhook land
  console.log(`  landed: ${page.url()}`);
  await shot(page, `P3-after-pay-${plan}`);

  // Judge the payment by where we ended up, not by scanning for the word
  // "declined". Still sitting on checkout.stripe.com means it did NOT go through;
  // reading the absence of an error as success reported a 3DS payment as paid when
  // the challenge had never even been answered.
  const stillOnStripe = /checkout\.stripe\.com/.test(page.url());
  const body = await page.locator("body").innerText().catch(() => "");
  const declined = /declin|card was declined|failed/i.test(body);
  if (stillOnStripe || declined) {
    console.log(`  ❌ payment did NOT complete${declined ? " (card declined)" : " (never left Stripe)"}`);
  } else {
    console.log("  ✅ payment went through, returned to the app");
  }
  await ctx.close();
}

// Revoke pending invites (by email). Used to undo a wrongly-roled invite.
async function revoke(...emails) {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log(`▶ revoke: ${emails.join(", ")}`);
  await page.goto(`${wsOrigin()}/interviewers`, { waitUntil: "load" });
  await settle(page, 4000);

  // Re-query each time: the list re-renders after every revoke, so indices move.
  for (const email of emails) {
    let clicked = false;
    const buttons = page.getByRole("button", { name: /^revoke$/i });
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const btn = buttons.nth(i);
      // Walk up to the card that holds this button and check whose row it is.
      const card = btn.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
      const text = await card.innerText().catch(() => "");
      if (!text.includes(email)) continue;
      await btn.click();
      await settle(page, 1500);
      // Only confirm INSIDE a dialog. Matching /revoke/ globally would hit another
      // row's Revoke button and delete the wrong invite.
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        const confirm = dialog.getByRole("button", { name: /revoke|confirm|yes|remove/i }).last();
        if (await confirm.count()) await confirm.click().catch(() => {});
      }
      await settle(page, 3500);
      console.log(`  ✓ revoked ${email}`);
      clicked = true;
      break;
    }
    if (!clicked) console.log(`  ✗ no Revoke row matched ${email}`);
  }
  await shot(page, "07b-team-after-revoke");
  await ctx.close();
}

// Billing probe. SAFE: it opens Stripe Checkout and screenshots it, but never
// enters card details. The point is to learn whether Stripe is in TEST or LIVE
// mode before anyone types a card number.
async function billing() {
  const { ctx, page } = await ctxFor(CFG.tenant.email);
  console.log("▶ billing: reading the plan page, then probing Stripe Checkout");

  await page.goto(`${wsOrigin()}/billing`, { waitUntil: "load" });
  await settle(page, 5000);
  await shot(page, "B1-billing-page");

  const body = await page.locator("body").innerText();
  console.log("  --- billing page says ---");
  console.log("  " + body.split("\n").filter(Boolean).slice(0, 18).join("\n  "));

  // Kick off a real checkout session (creates a Stripe session; charges nothing).
  const cta = page.getByRole("button", { name: /subscribe|upgrade|choose|start/i }).first();
  if (!(await cta.count())) {
    console.log("  ⚠ no subscribe/upgrade button found");
    await ctx.close();
    return;
  }
  console.log(`  → clicking "${(await cta.innerText()).trim()}"`);
  await cta.click();
  await settle(page, 12000);

  const url = page.url();
  console.log(`  landed on: ${url}`);
  await shot(page, "B2-after-subscribe");

  if (/checkout\.stripe\.com/.test(url)) {
    const txt = await page.locator("body").innerText().catch(() => "");
    const isTest = /test mode/i.test(txt);
    console.log(`  ✅ reached Stripe Checkout`);
    console.log(`  ${isTest ? "🟢 TEST MODE — safe to test with card 4242 4242 4242 4242" : "🔴 NO test banner — treat as LIVE. DO NOT enter a real card."}`);
  } else {
    console.log("  ⚠ did not reach Stripe Checkout — see screenshot for the error.");
  }
  await ctx.close();
}

// Utility: screenshot any route as any account.
// List every button on a route, with its accessible name and disabled state.
// When a click times out, this says whether the control is missing, renamed or
// simply disabled, instead of leaving us guessing at selectors.
async function listButtons(who, route) {
  const email = who.includes("@") ? who : CFG[who]?.email || CFG.tenant.email;
  const { ctx, page } = await ctxFor(email);
  await page.goto(`${wsOrigin()}${route}`, { waitUntil: "load" });
  await settle(page, 6000);
  console.log(`${email} @ ${page.url()}`);
  for (const b of await page.getByRole("button").all()) {
    const t = (await b.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    console.log(`  [button] "${t}" disabled=${await b.isDisabled().catch(() => "?")}`);
  }
  await ctx.close();
}

async function shotRoute(who, route) {
  const email = who.includes("@") ? who : CFG[who]?.email || CFG.tenant.email;
  const { ctx, page } = await ctxFor(email);
  await page.goto(`${wsOrigin()}${route}`, { waitUntil: "load" });
  await settle(page, 4000);
  console.log(`${email} @ ${route} -> ${page.url()}`);
  // Full page: the fold hides real content (the invoice table sits under it) and
  // a viewport shot would quietly pass a screen that never rendered.
  await shot(page, `route-${key(email)}-${route.replace(/\//g, "_")}`, true);
  await ctx.close();
}

// --- CLI --------------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
const run = {
  signup: () => signup(),
  confirm: () => confirm(args[0]),
  profile: () => profile(),
  invite: () => invite(args[0] ? args : null),
  revoke: () => revoke(...args),
  accept: () => accept(args[0], args[1]),
  login: () => login(args[0] || "tenant"),
  billing: () => billing(),
  subscribe: () => subscribe(args[0], args[1], args[2]),
  shot: () => shotRoute(args[0], args[1] || "/dashboard"),
  buttons: () => listButtons(args[0], args[1] || "/dashboard"),
};
if (!run[cmd]) {
  console.log("Commands: signup | confirm <url> | profile | invite | accept <email> <url> | login <who> | shot <who> <route>");
  process.exit(1);
}
await run[cmd]();
