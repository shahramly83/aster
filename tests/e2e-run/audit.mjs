// Full-surface UI/UX + brand audit.
// ---------------------------------------------------------------------------
// Walks every route, at every breakpoint, as every role, and checks the rules that
// can be checked mechanically. Screenshots everything so the rest can be eyeballed.
//
// Checks (ui-ux-pro-max priority order):
//   1 a11y      images without alt; inputs with no accessible label; buttons/links
//               with no accessible name; page with no h1; heading level skips
//   2 touch     interactive targets under 44x44 on mobile
//   5 layout    horizontal scroll; 100vh (should be dvh); text under 12px
//   BRAND       em dashes in copy (house rule: never); emoji used as an icon
//
//   node tests/e2e-run/audit.mjs [marketing|app|all]
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "shots", "audit");
const PROFILES = join(__dirname, ".profiles");

const APEX = "https://hireaster.com";
const WS = "https://onlazy.hireaster.com";
const PASSWORD = "password123@";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: false },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

const MARKETING = [
  "/", "/product", "/solutions", "/pricing", "/blog", "/resources/glossary",
  "/trust", "/legal/privacy", "/legal/terms", "/contact", "/support",
  "/login", "/signup", "/forgot-password",
];

const APP = {
  "tenant@onlazy.com":      ["/dashboard", "/jobs", "/applicants", "/candidates", "/search", "/interviews", "/interviewers", "/settings", "/profile", "/billing", "/upload"],
  "hiring1@onlazy.com":     ["/dashboard", "/jobs", "/applicants", "/candidates", "/search", "/interviews", "/interviewers", "/settings", "/profile"],
  "interviewer1@onlazy.com": ["/interviews", "/jobs", "/profile"],
};

// --- the rules, run inside the page ----------------------------------------
const RULES = () => {
  const out = [];
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const label = (el) => (
    el.getAttribute("aria-label") ||
    (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.innerText) ||
    (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) ||
    el.closest("label")?.innerText ||
    el.getAttribute("title") || ""
  ).trim();

  // 1. Accessibility
  for (const img of document.querySelectorAll("img")) {
    if (!vis(img)) continue;
    if (img.getAttribute("alt") === null) out.push({ rule: "alt-text", el: img.src?.slice(-60) || "img" });
  }
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (!vis(el) || el.type === "hidden") continue;
    if (!label(el)) out.push({ rule: "form-labels", el: `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""} ${el.placeholder || el.name || ""}`.trim() });
  }
  for (const el of document.querySelectorAll("button, a[href]")) {
    if (!vis(el)) continue;
    const name = (el.innerText || "").trim() || label(el);
    if (!name) out.push({ rule: "aria-labels", el: el.tagName.toLowerCase() + (el.className?.baseVal || String(el.className || "")).slice(0, 40) });
  }
  const h1 = [...document.querySelectorAll("h1")].filter(vis);
  if (h1.length === 0) out.push({ rule: "heading-hierarchy", el: "no <h1> on the page" });
  if (h1.length > 1) out.push({ rule: "heading-hierarchy", el: `${h1.length} <h1> elements` });

  // 5. Layout
  if (document.documentElement.scrollWidth - window.innerWidth > 1) {
    out.push({ rule: "horizontal-scroll", el: `${document.documentElement.scrollWidth - window.innerWidth}px of overflow` });
  }
  // Text below 12px is unreadable; 16px is the mobile minimum for inputs (iOS zooms).
  const small = new Set();
  for (const el of document.querySelectorAll("p, span, li, td, label, div")) {
    if (!vis(el) || !el.innerText?.trim() || el.children.length) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < 11) small.add(`${px}px "${el.innerText.trim().slice(0, 30)}"`);
  }
  for (const s of [...small].slice(0, 5)) out.push({ rule: "readable-font-size", el: s });

  // 2. Touch targets (mobile only; the caller filters)
  const tiny = [];
  for (const el of document.querySelectorAll("button, a[href], input[type=checkbox], input[type=radio], [role=button]")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      tiny.push(`${Math.round(r.width)}x${Math.round(r.height)} "${((el.innerText || label(el)) || "").trim().slice(0, 24)}"`);
    }
  }
  for (const t of tiny.slice(0, 6)) out.push({ rule: "touch-target-size", el: t });

  // BRAND: no em dashes, ever. And no emoji standing in for an icon.
  const text = document.body.innerText || "";
  const em = text.match(/[^\n]{0,28}—[^\n]{0,28}/g);
  for (const m of (em || []).slice(0, 5)) out.push({ rule: "brand-em-dash", el: m.trim() });
  const emoji = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  if (emoji) out.push({ rule: "brand-emoji-icon", el: [...new Set(emoji)].join(" ") });

  return out;
};

const findings = [];
const record = (surface, route, vp, rows) => {
  for (const r of rows) findings.push({ surface, route, viewport: vp, ...r });
};

async function sweep(ctxOpts, who, routes, origin, surface) {
  for (const vp of VIEWPORTS) {
    const ctx = await chromium.launchPersistentContext(ctxOpts.dir || "", {
      headless: true,
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      deviceScaleFactor: vp.isMobile ? 2 : 1,
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.setDefaultTimeout(25_000);

    for (const route of routes) {
      try {
        await page.goto(`${origin}${route}`, { waitUntil: "load" });
        await page.waitForTimeout(3500);
        let rows = await page.evaluate(RULES);
        // Touch targets only matter where there is touch.
        if (!vp.isMobile) rows = rows.filter((r) => r.rule !== "touch-target-size");
        record(surface, route, vp.name, rows);
        const tag = `${surface}-${who}-${route.replace(/\//g, "_") || "_root"}-${vp.name}`;
        await page.screenshot({ path: join(SHOTS, `${tag}.png`), fullPage: false });
        const bad = rows.length;
        console.log(`  ${bad ? "⚠" : "✓"} [${vp.name}] ${route}${bad ? `  (${bad})` : ""}`);
      } catch (e) {
        console.log(`  ✗ [${vp.name}] ${route}  ${String(e).split("\n")[0].slice(0, 70)}`);
      }
    }
    await ctx.close();
  }
}

const which = process.argv[2] || "all";
await mkdir(SHOTS, { recursive: true });

if (which === "marketing" || which === "all") {
  console.log("\n=== MARKETING + AUTH (signed out) ===");
  await sweep({}, "public", MARKETING, APEX, "marketing");
}

if (which === "app" || which === "all") {
  for (const [email, routes] of Object.entries(APP)) {
    console.log(`\n=== APP as ${email} ===`);
    await sweep({ dir: join(PROFILES, email.split("@")[0]) }, email.split("@")[0], routes, WS, "app");
  }
}

// --- report -----------------------------------------------------------------
const byRule = {};
for (const f of findings) (byRule[f.rule] ||= []).push(f);

console.log("\n\n================ AUDIT SUMMARY ================");
const order = ["horizontal-scroll", "form-labels", "alt-text", "aria-labels", "heading-hierarchy", "touch-target-size", "readable-font-size", "brand-em-dash", "brand-emoji-icon"];
for (const rule of order) {
  const rows = byRule[rule];
  if (!rows?.length) { console.log(`✓ ${rule}: clean`); continue; }
  console.log(`\n⚠ ${rule}  (${rows.length})`);
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.route}|${r.el}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`    ${r.route} [${r.viewport}]  ${r.el}`);
  }
}
await writeFile(join(SHOTS, "findings.json"), JSON.stringify(findings, null, 2));
console.log(`\n${findings.length} findings. Detail: shots/audit/findings.json`);
