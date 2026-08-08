// ============================================================================
// Aster Admin Portal: internal-only console, fully separate from the customer
// app. Mounted at /admin/* (see App.jsx). Renders standalone, so it injects its
// own design tokens rather than relying on the marketing app's styles.
//
// Guardrails baked into the UI:
//  - Admin accounts are separate from company (customer) users.
//  - Candidate resumes are NEVER accessible here; candidate PII is masked.
//  - Card/payment details are never stored or displayed (no digits anywhere).
//  - Role-based access: Super Admin, Support Admin, Billing Admin, enforced in
//    the nav AND in each screen (defense in depth), plus an audit trail.
// Every screen reads live data through is_admin()-gated RPCs and RLS. The only
// mock left is ADMIN_ACCOUNTS, used solely for the demo sign-in when Supabase
// keys are absent (hasSupabase === false); it is unreachable in production.
// ============================================================================
import { useState, useEffect, useRef } from "react";
import { supabase, hasSupabase } from "./lib/supabase";
// The one limits table the customer app enforces against, so the allowances
// shown here cannot drift from the ones actually applied.
import { PLAN_LIMITS } from "./lib/plan";
import WorldMap from "./admin-world-map";
import DatePicker from "./admin-date-picker";

const ADMIN_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
:root{
--bg:#FAFAFB;--page:#E7E8EE;--canvas:#FFFFFF;--card:#FFFFFF;--line:#ECECEF;--line-strong:#DEDEE3;
/* Bento palette: soft tints carrying ink-dark text, so every card clears 4.5:1. */
--t-blue:#DCE8F8;--t-lav:#E7E4FB;--t-peach:#FBDFD0;--t-mint:#DCEFE3;--t-sand:#F6EBD8;
/* Same light blue the customer dashboard runs on, and a brand-blue pill so the
   console never introduces a black the product does not use. */
--c-active:#2B49F0;--c-trial:#A78BFA;--c-risk:#F2775A;--pill:#0B2AE0;--app-bg:#F2F6FF;
--ink:#12132A;--ink-2:#56566A;--ink-3:#6E6E7C;
--brand:#0B2AE0;--brand-2:#3550EE;--brand-0:#5570F5;--brand-soft:#EAEEFE;
--adm:#FFFFFF;--adm-2:#F7F9FC;--adm-line:#ECECEF;--adm-ink:#4A5568;--adm-ink-2:#6B7280;
--ok:#16A34A;--ok-soft:#E7F6EC;--warn:#B45309;--warn-soft:#FBF0E4;--danger:#DC2626;--danger-soft:#FCEBEB;--info:#2563EB;--info-soft:#E8EFFD;
}
.adm{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.adm-display{font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em;}
.adm .grad{background:linear-gradient(135deg,#5570F5,#0B2AE0 55%,#3550EE);}
.adm .txt-grad{background:linear-gradient(120deg,#5570F5,#0B2AE0 50%,#3550EE);-webkit-background-clip:text;background-clip:text;color:transparent;}
.adm-shadow{box-shadow:0 1px 2px rgba(18,19,42,.04),0 10px 26px -16px rgba(18,19,42,.16);}
.adm .tnum{font-variant-numeric:tabular-nums;}
.adm-row{transition:background-color .15s ease;}
.adm-row:hover{background:#F7F9FC;}
.adm-nav-item:hover{background:#F7F9FC;}
/* Segment chips. The border is declared here so the inline style only has to
   carry the colour, which is what changes per state. */
.adm-seg{border:1px solid var(--line);transition:background-color .15s ease,border-color .15s ease,color .15s ease;}
.adm-seg:hover[aria-pressed="false"]{border-color:var(--line-strong);background:#FBFCFE;}
/* Sortable headers read as text until you go near them, which keeps the header
   row quiet on a table that is mostly read, not sorted. */
.adm-sort{transition:color .15s ease;}
.adm-sort:hover{color:var(--ink);}
.adm-x:hover{background:var(--app-bg);color:var(--ink-2);}
.adm-open{transition:background-color .15s ease,border-color .15s ease,color .15s ease;}
.adm-open:hover{background:var(--app-bg);border-color:var(--line-strong);color:var(--ink);}
.adm-datefield{transition:border-color .15s ease,box-shadow .15s ease;}
.adm-datefield:hover:not(:disabled){border-color:var(--line-strong);}
.adm-datefield[aria-expanded="true"]{border-color:var(--brand-0);box-shadow:0 0 0 3px var(--brand-soft);}
.adm-cal{box-shadow:0 1px 2px rgba(18,19,42,.04),0 18px 40px -18px rgba(18,19,42,.28);}
.adm-cal-nav:hover,.adm-cal-foot:hover{background:var(--app-bg);}
.adm-cal-day{transition:background-color .12s ease;}
.adm-cal-day:hover:not(:disabled):not([aria-selected="true"]){background:var(--app-bg);}
.adm-input{transition:border-color .15s ease,box-shadow .15s ease;}
.adm-input:focus{outline:none;border-color:var(--brand-0);box-shadow:0 0 0 3px var(--brand-soft);}
/* Underline on hover only, so a table of names is not a wall of blue rules. */
.adm-link{text-underline-offset:3px;}
.adm-link:hover{text-decoration:underline;}
/* One focus ring for everything focusable, drawn outside the element so it is
   never clipped by a rounded corner or an overflow container. */
.adm :is(button,a,input,select,summary,[tabindex]):focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px;}
@media (prefers-reduced-motion:reduce){
  .adm *,.adm *::before,.adm *::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;}
}
.adm ::-webkit-scrollbar{width:10px;height:10px}.adm ::-webkit-scrollbar-thumb{background:#d9d9e3;border-radius:8px;border:2px solid transparent;background-clip:content-box}
.adm-side ::-webkit-scrollbar-thumb{background:#d9d9e3}
.adm-page{background:var(--app-bg);}
.adm button,.adm [role="button"],.adm select,.adm summary{cursor:pointer;}
.adm-tab{transition:background-color .2s ease,color .2s ease;}
.adm-tab:hover:not([aria-current="page"]){background:#F2F2F7;}
.adm-bento{transition:box-shadow .2s ease,transform .2s ease;}
.adm-clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
/* Native number spinners are grey OS chrome that clashes with everything here,
   and the rates are typed, not nudged. Type=number is kept for the numeric
   keypad and validation. */
.adm input[type=number]::-webkit-outer-spin-button,
.adm input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;appearance:none;margin:0;}
.adm input[type=number]{-moz-appearance:textfield;appearance:textfield;}
.adm-pop{animation:admPop .16s ease-out;}
@keyframes admPop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.adm-stack>*+*{margin-left:-10px;}
.adm :focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:10px;}
@media (prefers-reduced-motion:reduce){.adm *{animation-duration:.01ms !important;transition-duration:.01ms !important;}}
`;

// ---------------------------------------------------------------------------
// Icons (stroke, currentColor)
// ---------------------------------------------------------------------------
const PATHS = {
  dashboard: "M4 5h6v6H4zM14 5h6v4h-6zM14 13h6v6h-6zM4 15h6v4H4z",
  building: "M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15M15 10h4a1 1 0 0 1 1 1v10M3 21h18M7 8h1M11 8h1M7 12h1M11 12h1M7 16h1M11 16h1",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1a3.5 3.5 0 0 0-3-3.46M16.5 4.2a3.5 3.5 0 0 1 0 6.6",
  card: "M3 8h18M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm4 8h3",
  chart: "M4 20V10M10 20V4M16 20v-7M4 20h16",
  headset: "M4 13a8 8 0 0 1 16 0M4 13v3a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Zm-3 5a5 5 0 0 1-4 2",
  flag: "M5 21V4M5 4c3-1.5 5 1.5 8 0s5 0 5 0v9c-2 0-2 1.5-5 0s-5 1.5-8 0",
  audit: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  shield: "M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z",
  check: "M4 12l5 5L20 6",
  mail: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 .5 9 6 9-6",
  close: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  arrowUpRight: "M7 17L17 7M8 7h9v9",
  warning: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  key: "M15 7a4 4 0 1 1-4 4l-6 6H3v-2l6-6a4 4 0 0 1 6-2Z",
  eyeOff: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.5 9.5 0 0 1 12 5c5 0 9 5 9 7a12 12 0 0 1-2.2 2.9M6.1 6.1C3.8 7.5 2 10 2 12c0 2 4 7 10 7a9.7 9.7 0 0 0 3.6-.7",
  filter: "M4 5h16l-6 8v5l-4 2v-7L4 5Z",
  calendar: "M3 9h18M8 3v4M16 3v4M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  ban: "M5.6 5.6l12.8 12.8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v4h-4",
  dot: "M12 12h.01",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 2 8 2 8H4s2-1 2-8M10.3 21a2 2 0 0 0 3.4 0",
  spark: "M12 3l1.9 5.6L20 10l-6.1 1.4L12 17l-1.9-5.6L4 10l6.1-1.4L12 3Z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  jobs: "M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm6-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18",
  menu: "M4 7h16M4 12h16M4 17h16",
};
// The real Aster app-icon mark (blue rounded square + white burst), used in the
// admin header/login in place of the old "A" letter badge. The SVG rounds its
// own corners, so no extra background/radius is needed on the container.
function Icon({ name, className = "w-5 h-5", style }) {
  const filled = name === "dot";
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {filled ? <circle cx="12" cy="12" r="4" /> : <path d={PATHS[name] || PATHS.dot} />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Audit presentation
// ---------------------------------------------------------------------------
// What kind of action a log line describes, so the eye can sort them without
// reading. Matched on the action text the database writes.
const AUDIT_CLASS = [
  { test: /suspend|deactivat|block|remove/i,        tone: "var(--c-risk)", label: "Access removed" },
  { test: /restor|reactivat|unblock/i,              tone: "var(--ok)",     label: "Access restored" },
  { test: /plan|subscription|currency|credit|cost/i, tone: "var(--brand)",  label: "Billing" },
  { test: /password|reset/i,                        tone: "var(--warn)",   label: "Credentials" },
  { test: /flag|template|booking|date/i,            tone: "var(--c-trial)", label: "Configuration" },
];
const auditTone = (action) => (AUDIT_CLASS.find((c) => c.test.test(action || "")) || { tone: "var(--ink-3)" }).tone;

// The database writes the raw tier ("Changed plan to scale"), which reads as a
// typo next to a properly capitalised company name. Capitalise the tier and
// nothing else, so the wording stays whatever the audit row actually says.
const auditText = (action) =>
  String(action || "").replace(/\b(launch|scale|elite|enterprise)\b/gi, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());

// Collapse a run of identical actions into one line with a count. Seven test
// clicks on the same button should read as one entry, not seven.
function collapseAudit(rows) {
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.action === r.action && prev.target === r.target && prev.actor === r.actor) {
      prev.count += 1;
      continue;
    }
    out.push({ ...r, count: 1 });
  }
  return out;
}

// Today / Yesterday / an actual date, for grouping the full log.
function dayBucket(iso) {
  if (!iso) return "Just now";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Just now";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const SETTINGS_TABS = [
  { key: "rates",           label: "Currency rates",  roles: ["super", "billing"] },
  // What we charge, kept apart from what we pay. Two screens because one screen
  // makes it far too easy to edit the wrong number.
  { key: "credit_prices",   label: "Credit pricing",  roles: ["super", "billing"] },
  { key: "promos",          label: "Promo codes",     roles: ["super", "billing"] },
  { key: "ai_costs",        label: "AI costs",        roles: ["super", "billing"] },
  { key: "flags",           label: "Feature flags",   roles: ["super"] },
  { key: "email_templates", label: "Email templates", roles: ["super", "support"] },
  { key: "usage",           label: "Usage monitoring", roles: ["super", "support", "billing"] },
  { key: "audit",           label: "Audit logs",      roles: ["super", "billing"] },
];

// ---------------------------------------------------------------------------
// Roles & permissions (RBAC)
// ---------------------------------------------------------------------------
const ROLE_META = {
  super:   { label: "Super Admin",   short: "Super",   tint: "#0B2AE0", blurb: "Full access to every area and action." },
  support: { label: "Support Admin", short: "Support", tint: "#2563EB", blurb: "Accounts, users and support. No billing or flags." },
  billing: { label: "Billing Admin", short: "Billing", tint: "#16A34A", blurb: "Subscriptions, revenue and audit. No user or support tools." },
};

// Which sections each role may open. Enforced in the sidebar and per screen.
const SECTIONS = [
  { key: "dashboard",     label: "Dashboard",        icon: "dashboard", roles: ["super", "support", "billing"] },
  { key: "workspaces",    label: "Workspaces",       icon: "building",  roles: ["super", "support", "billing"] },
  { key: "support",       label: "Support",           icon: "headset",   roles: ["super", "support"] },
  { key: "bookings",      label: "Bookings",         icon: "calendar",  roles: ["super", "support"] },
  // Money screens the dashboard links out to rather than trying to hold. A card
  // that grows a list stops being a summary.
  { key: "revenue",       label: "Revenue",          icon: "card",      roles: ["super", "billing"] },
  { key: "settings",      label: "Settings",         icon: "spark",     roles: ["super", "support", "billing"] },
];

// Fine-grained actions -> roles allowed.
const PERMS = {
  "company.suspend":     ["super"],
  "company.restore":     ["super"],
  "user.reset":          ["super", "support"],
  "user.deactivate":     ["super"],
  "subscription.change": ["super", "billing"],
  "company.comp":        ["super", "billing"],
  "flag.toggle":         ["super"],
  "booking.block":       ["super", "support"],
  "support.resolve":     ["super", "support"],
  "template.edit":       ["super", "support"],
  "aicost.edit":         ["super", "billing"],
  "creditprice.edit":    ["super", "billing"],
  "booking.manage":      ["super", "support"],
  // Publishing a workspace's roles to third-party job sites is done on the
  // customer's behalf, so support can switch a pilot customer on after asking.
  "company.feed":        ["super", "support"],
};
const can = (role, action) => (PERMS[action] || []).includes(role);
const sectionAllowed = (role, key) => (SECTIONS.find((s) => s.key === key)?.roles || []).includes(role);

// ---------------------------------------------------------------------------
// Helpers: masking, formatting
// ---------------------------------------------------------------------------
// are account holders and shown normally; candidates are applicants and are not.
const LOADED_AT = Date.now();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const ADMIN_ACCOUNTS = [
  { id: "a1", name: "Priya Nair",   email: "priya@hireaster.com",  role: "super",   title: "Platform Lead" },
  { id: "a2", name: "Marcus Lee",   email: "marcus@hireaster.com", role: "support", title: "Support Engineer" },
  { id: "a3", name: "Dana Osei",    email: "dana@hireaster.com",   role: "billing", title: "Finance Ops" },
];

// The feature-flag CATALOG: the real list of platform features and their default
// state. Not mock data, this is config. Live enabled-state loads from platform_flags
// on login and is merged over these defaults.
const INIT_FLAGS = [
  { key: "ai_dedup_v2",         label: "AI dedup v2",              desc: "Second-gen deduplication across old and new CVs.", enabled: true,  rollout: 100, env: "prod" },
  { key: "voice_screening",     label: "Voice screening (beta)",   desc: "AI voice interview for phone-screen replacement.", enabled: false, rollout: 15,  env: "prod" },
  { key: "career_site_builder", label: "Career site builder",      desc: "Hosted branded careers page and job board.",      enabled: true,  rollout: 100, env: "prod" },
  { key: "whatsapp_scheduling", label: "WhatsApp scheduling",      desc: "Candidate self-booking over WhatsApp.",           enabled: true,  rollout: 60,  env: "prod" },
  { key: "advanced_analytics",  label: "Advanced analytics",       desc: "Custom funnel reports and cohort breakdowns.",    enabled: false, rollout: 30,  env: "prod" },
  { key: "sso_login",           label: "SSO (Google / Microsoft)", desc: "Customer sign-in via Google/Microsoft SSO. Enterprise.", enabled: false, rollout: 0,   env: "prod" },
  { key: "white_label",         label: "White-label branding",     desc: "Custom branding / white-label for Enterprise workspaces.", enabled: false, rollout: 0,   env: "prod" },
  { key: "sso_scim",            label: "SSO + SCIM provisioning",  desc: "Enterprise SSO directory sync (SCIM).",           enabled: false, rollout: 0,   env: "prod" },
  { key: "new_billing_ui",      label: "New billing UI",           desc: "Redesigned in-app billing and invoices.",         enabled: false, rollout: 0,   env: "staging" },
  { key: "ranked_reasons_v3",   label: "Ranked reasons v3",        desc: "Richer explanations on every match score.",       enabled: false, rollout: 5,   env: "prod" },
];


// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------
const STATUS_TONE = {
  active: "ok", trialing: "info", trial: "info", pending: "warn", open: "info", past_due: "warn",
  suspended: "danger", churned: "ink", canceled: "ink", resolved: "ok", invited: "warn", high: "warn", urgent: "danger", normal: "info", low: "ink",
};
const TONE = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" }, warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" }, info: { bg: "var(--info-soft)", fg: "var(--info)" },
  ink: { bg: "#EFEFF3", fg: "var(--ink-2)" }, brand: { bg: "var(--brand-soft)", fg: "var(--brand)" },
};
function Badge({ children, tone = "ink", dot = false }) {
  const t = TONE[tone] || TONE.ink;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.fg }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.fg }} />}
      {children}
    </span>
  );
}
const StatusBadge = ({ value }) => <Badge tone={STATUS_TONE[value] || "ink"} dot>{String(value).replace("_", " ")}</Badge>;

function Card({ children, className = "", pad = "p-5 sm:p-6" }) {
  return <div className={`rounded-2xl adm-shadow ${pad} ${className}`} style={{ background: "#fff", border: "1px solid var(--line)" }}>{children}</div>;
}
// ---------------------------------------------------------------------------
// Bento primitives
// ---------------------------------------------------------------------------
// The dashboard's building block: a soft white card. Rounder and shadow-led
// rather than border-led, so tinted cards can nest inside without fighting it.
function Tile({ children, className = "", pad = "p-5 sm:p-6", style }) {
  return <div className={`adm-bento rounded-[24px] ${pad} ${className}`} style={{ background: "#fff", boxShadow: "0 1px 2px rgba(18,19,42,.04), 0 18px 40px -28px rgba(18,19,42,.28)", ...style }}>{children}</div>;
}
function TileHead({ title, right }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <h3 className="text-lg font-bold adm-display text-neutral-900 truncate">{title}</h3>
      {right}
    </div>
  );
}
// The pill "See all" affordance sitting in each card header.
function SeeAll({ children = "See all", onClick }) {
  return (
    <button onClick={onClick} className="text-xs font-semibold px-3.5 py-2 rounded-full shrink-0 transition-colors hover:bg-neutral-100" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>{children}</button>
  );
}
// The corner arrow on a summary card: this figure has a page behind it. Icon
// only, so it never competes with the number, but it carries a real label for
// anyone not looking at it.
function OpenArrow({ onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="adm-open w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center"
      style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
      <Icon name="arrowUpRight" className="w-4 h-4" />
    </button>
  );
}
// Initials avatar. Candidate faces never appear in the admin portal, so every
// avatar here is a generated monogram for a company or an admin.
function Monogram({ label, size = 32, tint, soft = false, bg, fg, ring = true }) {
  const text = (label || "?").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="rounded-full inline-flex items-center justify-center font-bold shrink-0"
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.36),
        background: bg || (soft ? "var(--brand-soft)" : (tint || "linear-gradient(135deg,#5570F5,#0B2AE0)")),
        color: fg || (soft ? "var(--brand)" : "#fff"),
        border: ring ? "2px solid #fff" : "none",
      }}>{text}</span>
  );
}

// Three concentric arcs, one per workspace status. Percentages are also printed
// in the legend, so the chart never carries meaning by colour alone.
function StatusDonut({ slices }) {
  const R = [86, 66, 46];
  const SW = 15;
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[220px] h-auto" role="img"
      aria-label={slices.map((s) => `${s.label} ${s.pct}%`).join(", ")}>
      {slices.map((s, i) => {
        const c = 2 * Math.PI * R[i];
        return (
          <g key={s.label} transform="rotate(-90 100 100)">
            <circle cx="100" cy="100" r={R[i]} fill="none" stroke="#EFEFF5" strokeWidth={SW} />
            <circle cx="100" cy="100" r={R[i]} fill="none" stroke={s.color} strokeWidth={SW} strokeLinecap="round"
              strokeDasharray={`${(c * s.pct) / 100} ${c}`} style={{ transition: "stroke-dasharray .4s ease" }} />
          </g>
        );
      })}
    </svg>
  );
}

// Paired bars per plan: how many workspaces are paying vs not yet paying.
// Same unit on both series, so the comparison is honest.
function PlanColumns({ rows }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  return (
    <div className="flex items-end justify-between gap-3 sm:gap-4 h-[170px]">
      {rows.map((r) => (
        <div key={r.label} className="flex-1 flex flex-col items-center gap-2 h-full">
          <div className="flex-1 w-full flex items-end justify-center gap-1.5">
            {[{ v: r.a, fill: "var(--c-risk)" }, { v: r.b, fill: "#BFD4EC" }].map((s, i) => (
              <div key={i} className="relative w-full max-w-[22px] h-full flex items-end">
                <div className="w-full rounded-full" style={{ height: `${s.v ? Math.max(9, (s.v / max) * 100) : 4}%`, background: s.v ? s.fill : "#EFEFF5" }} title={`${r.label}: ${s.v}`} />
              </div>
            ))}
          </div>
          <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
function SectionHead({ title, left, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold adm-display text-neutral-900">{title}</h1>
        {left}
      </div>
      {children}
    </div>
  );
}
// head accepts plain strings, or { label, align, key } to right-align a numeric
// column and make it sortable. Strings still work, so the tables that do not
// sort were left alone.
function TableShell({ head, children, sort, onSort, minWidth = 640 }) {
  const cols = head.map((h) => (typeof h === "string" ? { label: h } : h));
  return (
    <Card pad="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              {cols.map((c, i) => {
                const sortable = !!(c.key && onSort);
                const active = sortable && sort?.key === c.key;
                const label = (
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {/* Direction is drawn, not just implied by which header is
                        bold: an arrow that only appears on the active column is
                        the one thing that says which way the sort runs. */}
                    {active && (
                      <Icon name="chevronDown" className="w-3 h-3 transition-transform"
                        style={{ transform: sort.dir === "asc" ? "rotate(180deg)" : "none" }} />
                    )}
                  </span>
                );
                return (
                  <th key={i}
                    aria-sort={sortable ? (active ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={`font-semibold px-4 sm:px-5 py-3.5 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}
                    style={{ color: active ? "var(--ink-2)" : "var(--ink-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {sortable ? (
                      <button type="button" onClick={() => onSort(c.key)}
                        className={`adm-sort inline-flex items-center gap-1 rounded ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                        {label}
                      </button>
                    ) : label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}
const Td = ({ children, className = "", ...p }) => <td className={`px-4 sm:px-5 py-3.5 align-middle ${className}`} {...p}>{children}</td>;
function ActionBtn({ children, onClick, disabled, tone = "ink", icon }) {
  const danger = tone === "danger";
  return (
    <button onClick={onClick} disabled={disabled} title={disabled ? "You do not have permission for this action" : undefined}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ border: "1px solid var(--line)", color: disabled ? "var(--ink-3)" : danger ? "var(--danger)" : "var(--ink-2)", background: "#fff" }}>
      {icon && <Icon name={disabled ? "lock" : icon} className="w-3.5 h-3.5" />} {children}
    </button>
  );
}
function Toggle({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} title={disabled ? "Super Admin only" : undefined}
      className="relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      style={{ background: on ? "var(--brand)" : "var(--line-strong)" }}>
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(20px)" : "none", boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </button>
  );
}
function NoAccess({ role }) {
  return (
    <div className="max-w-md mx-auto text-center py-20">
      <span className="w-14 h-14 rounded-2xl inline-flex items-center justify-center" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icon name="lock" className="w-7 h-7" /></span>
      <h2 className="text-xl font-bold adm-display mt-5 text-neutral-900">Insufficient permissions</h2>
      <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>Your role ({ROLE_META[role].label}) does not have access to this area. This attempt is recorded in the audit log.</p>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
// monthlyRevenueMYR lived here and computed MRR by adding up every active
// company's list price. The overview now reads real Stripe charges instead, so
// a projection nobody was billed for had no reader left. planMonthlyMYR below
// still prices a single workspace, which is a different question.
const ringgit = (n) => "RM " + Math.round(n).toLocaleString("en-MY");
// Sub-ringgit figures (a single AI call) need the sen, a monthly total does not.
const ringgit2 = (n) => "RM " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The five AI actions the app charges a credit for, in the order they appear on
// screen. Keys match credit_spend_log.kind and the ai_unit_costs rows.
// 'YYYY-MM' -> 'July 2026'. The period key is what the RPC filters on.
const monthLabel = (p) => {
  const [y, m] = String(p || "").split("-").map(Number);
  if (!y || !m) return p;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};
// The current month plus the previous eleven, newest first.
const recentPeriods = (n = 12) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
};

// `limit` names the PLAN_LIMITS field each credit kind draws down, so a monthly
// allowance can be shown beside the usage.
const AI_KINDS = [
  { key: "resume_screen",       label: "Resume screening",    limit: "resumeUploads" },
  { key: "applicant_screen",    label: "Applicant screening", limit: "parseApplicant" },
  { key: "ai_rank",             label: "AI rank",             limit: "aiRunsPerMonth" },
  { key: "ai_insight",          label: "AI insight",          limit: "aiInsightsPerMonth" },
  { key: "interview_questions", label: "Interview questions", limit: "interviewQuestionsPerMonth" },
];

// The monthly allowance for one kind on one plan. Falls back to Launch, matching
// the customer app's fail-closed lookup.
const allowanceFor = (plan, kind) => {
  const tier = PLAN_LIMITS[String(plan || "").toLowerCase()] || PLAN_LIMITS.launch;
  return tier[AI_KINDS.find((k) => k.key === kind)?.limit];
};

// Usage against allowance. Over 100% is legitimate: purchased top-up credits are
// not capped by the plan, so the bar flags it rather than treating it as an error.
function UsageCell({ used, allowance }) {
  const unlimited = !Number.isFinite(allowance);
  const share = unlimited ? 0 : Math.min(100, pct(used, allowance || 1));
  const over = !unlimited && used > allowance;
  return (
    <div className="min-w-[76px]">
      <span className="tnum text-sm" style={{ color: used ? "var(--ink)" : "var(--ink-3)" }}>
        {used.toLocaleString()}
        <span style={{ color: "var(--ink-3)" }}> / {unlimited ? "∞" : allowance.toLocaleString()}</span>
      </span>
      {!unlimited && (
        <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: "#EEF2FB" }}>
          <div className="h-full rounded-full" style={{ width: `${over ? 100 : share}%`, background: over ? "var(--c-risk)" : "#A9C0F5" }} />
        </div>
      )}
    </div>
  );
}

// What one workspace's AI ran up this month, in ringgit. Cost is modelled, not
// measured: nothing records model spend, so this is usage x the rate an admin
// set under AI costs. Returns 0 while the rates are still zero.
function aiCostFor(usageRow, rates) {
  if (!usageRow || !rates) return 0;
  return AI_KINDS.reduce((sum, k) => sum + (usageRow[k.key] || 0) * (rates[k.key] || 0), 0) / 100;
}

// Plan tiers, in upgrade order, with the tint each one carries in the charts.
const PLAN_ORDER = ["Launch", "Scale", "Elite", "Enterprise"];

// The three attention cards at the top of the console. Each one is a real
// query over live admin data, and each links to the screen that fixes it.
const ATTENTION_CARDS = [
  {
    key: "suspended", tint: "var(--t-peach)", flag: "Needs action", flagTone: "var(--c-risk)",
    title: ["Suspended", "workspaces"], to: "companies", icon: "ban",
    pick: (d) => d.companies.filter((c) => c.status === "suspended"),
    of: (d) => d.companies.length, unit: "workspaces",
  },
  {
    key: "tickets", tint: "var(--t-blue)", flag: "Open", flagTone: "#1D4ED8",
    title: ["Support", "tickets"], to: "support", icon: "headset",
    pick: (d) => d.tickets.filter((t) => t.status === "open"),
    of: (d) => d.tickets.length, unit: "tickets",
  },
  {
    key: "trials", tint: "var(--t-lav)", flag: "Converting", flagTone: "#6D3BD4",
    title: ["Workspaces", "on trial"], to: "companies", icon: "spark",
    pick: (d) => d.companies.filter((c) => c.status === "trial"),
    of: (d) => d.companies.length, unit: "workspaces",
  },
];

function AttentionCard({ card, data, go, allowed }) {
  const items = card.pick(data);
  const total = card.of(data);
  const names = items.slice(0, 3).map((x) => x.name || x.company || x.subject || "—");
  return (
    <div className="rounded-[20px] p-4 sm:p-5 flex flex-col" style={{ background: card.tint }}>
      <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/70" style={{ color: card.flagTone }}>
        <Icon name={card.icon} className="w-3 h-3" /> {card.flag}
      </span>
      <h4 className="text-[22px] sm:text-2xl font-bold adm-display leading-[1.15] mt-4" style={{ color: "var(--ink)" }}>
        {card.title[0]}<br />{card.title[1]}
      </h4>
      <div className="flex items-center gap-0 adm-stack mt-4 min-h-[32px]">
        {names.length === 0
          ? <span className="text-xs" style={{ color: "var(--ink-2)" }}>Nothing here right now</span>
          : names.map((n, i) => <Monogram key={i} label={n} size={30} bg="rgba(255,255,255,.85)" fg={card.flagTone} />)}
        {items.length > 3 && <span className="rounded-full inline-flex items-center justify-center text-[10px] font-bold" style={{ width: 30, height: 30, background: "rgba(255,255,255,.85)", color: card.flagTone, border: "2px solid #fff" }}>+{items.length - 3}</span>}
      </div>
      <div className="mt-auto pt-5">
        <div className="h-1.5 rounded-full overflow-hidden bg-white/60">
          <div className="h-full rounded-full" style={{ width: `${pct(items.length, total || 1)}%`, background: card.flagTone }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <button onClick={() => go(card.to)} disabled={!allowed(card.to)}
            className="text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "var(--ink-2)" }}>
            {allowed(card.to) ? "Open" : "No access"}
          </button>
          <span className="text-xs font-bold tnum" style={{ color: "var(--ink)" }}>{items.length}/{total}</span>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ role, companies, users, tickets, audit, planPrices, revTotals = [], revLoaded = false, topupTotals = [], recentTopups = [], go }) {
  const active = companies.filter((c) => c.status === "active").length;
  const trials = companies.filter((c) => c.status === "trial").length;
  const suspended = companies.filter((c) => c.status === "suspended").length;
  const canRevenue = role === "billing" || role === "super";
  const seats = companies.reduce((s, c) => s + (c.seats || 0), 0);
  const jobs = companies.reduce((s, c) => s + (c.activeJobs || 0), 0);
  const cands = companies.reduce((s, c) => s + (c.candidates || 0), 0);
  const interviews = companies.reduce((s, c) => s + (c.interviews || 0), 0);
  const hired = companies.reduce((s, c) => s + (c.hired || 0), 0);
  const upcoming = companies.reduce((s, c) => s + (c.upcoming || 0), 0);

  // Workspaces that have stayed a year: still active AND opened over a year
  // ago. Age alone would count the ones that left, which is the opposite of
  // what the number is for.
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const veterans = companies.filter((c) => c.status === "active" && c.createdAt && new Date(c.createdAt) <= yearAgo).length;

  // Where the customers are. Grouped case-insensitively so "malaysia" and
  // "Malaysia" are one country, and the ones who never filled in an address are
  // shown as their own row rather than silently dropped: a chart that omits
  // them makes the coverage look better than it is.
  const byCountry = new Map();
  companies.forEach((c) => {
    const raw = (c.country || "").trim();
    const key = raw ? raw.toLowerCase() : "__none";
    const row = byCountry.get(key) || { label: raw || "Not set", n: 0, unknown: !raw };
    row.n += 1;
    byCountry.set(key, row);
  });
  const countries = [...byCountry.values()]
    .sort((a, b) => (a.unknown - b.unknown) || (b.n - a.n) || a.label.localeCompare(b.label))
    .slice(0, 6);
  // The map shades named countries only; "Not set" has nowhere to go on it.
  const mapCounts = Object.fromEntries([...byCountry.values()].filter((c) => !c.unknown).map((c) => [c.label, c.n]));
  const mapMax = Math.max(1, ...Object.values(mapCounts));

  // Subscriptions running out. Already-expired first, because those are the ones
  // that need doing something about, then nearest renewal.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiring = companies
    .filter((c) => c.periodEnd && c.status !== "suspended")
    .map((c) => ({ ...c, daysLeft: Math.round((new Date(c.periodEnd) - today) / 86400000) }))
    .filter((c) => c.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  // Revenue: succeeded Stripe charges, in sen, per currency. Ringgit is shown on
  // the tile and anything else is named underneath rather than converted into it.
  const myrIn = (rows, bucket) => (rows || []).filter((r) => r.bucket === bucket && r.currency === "myr")
    .reduce((s, r) => s + Number(r.amount_cents || 0), 0) / 100;
  const countIn = (rows, bucket, field) => (rows || []).filter((r) => r.bucket === bucket)
    .reduce((s, r) => s + Number(r[field] || 0), 0);
  const otherCcyIn = (rows) => [...new Set((rows || []).filter((r) => r.currency !== "myr")
    .map((r) => String(r.currency || "").toUpperCase()))];

  const slices = [
    { label: "Active", pct: pct(active, companies.length), color: "var(--c-active)", n: active },
    { label: "On trial", pct: pct(trials, companies.length), color: "var(--c-trial)", n: trials },
    { label: "Suspended", pct: pct(suspended, companies.length), color: "var(--c-risk)", n: suspended },
  ];
  const planRows = PLAN_ORDER.map((p) => {
    const inPlan = companies.filter((c) => c.plan === p);
    return { label: p, a: inPlan.filter((c) => c.status === "active").length, b: inPlan.filter((c) => c.status !== "active").length };
  });

  return (
    <div>
      {/* Row 1: attention cards + status donut */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Tile className="xl:col-span-3">
          <TileHead title="Needs attention" right={<SeeAll onClick={() => go("companies")} />} />
          <div className="grid gap-3 sm:grid-cols-3">
            {ATTENTION_CARDS.map((card) => (
              <AttentionCard key={card.key} card={card} data={{ companies, tickets }} go={go} allowed={(k) => sectionAllowed(role, k)} />
            ))}
          </div>
        </Tile>

        <Tile className="xl:col-span-2">
          <TileHead title="Workspace status" right={<span className="text-xs shrink-0" style={{ color: "var(--ink-3)" }}>Total {companies.length}</span>} />
          {companies.length === 0 ? (
            <p className="text-sm py-12 text-center" style={{ color: "var(--ink-3)" }}>No workspaces yet, so there is nothing to chart.</p>
          ) : (
            <div className="flex items-center gap-4">
              <ul className="space-y-4 shrink-0">
                {slices.map((s) => (
                  <li key={s.label}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="text-sm" style={{ color: "var(--ink-2)" }}>{s.label}</span>
                    </div>
                    <p className="text-[26px] font-bold adm-display tnum leading-tight" style={{ color: "var(--ink)" }}>{s.pct}%</p>
                    <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>{s.n} of {companies.length}</p>
                  </li>
                ))}
              </ul>
              <div className="flex-1 flex justify-center"><StatusDonut slices={slices} /></div>
            </div>
          )}
        </Tile>
      </div>

      {/* Row 2: the plain totals strip */}
      <div className="grid gap-4 mt-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { l: "Company users", v: users.length || seats, t: "var(--t-lav)", i: "users" },
          { l: "Total candidates", v: cands, t: "var(--t-sand)", i: "lock" },
          { l: "Open jobs", v: jobs, t: "var(--t-mint)", i: "jobs" },
          { l: "Stayed over a year", v: veterans, t: "var(--t-blue)", i: "check" },
        ].map((x) => (
          <Tile key={x.l} pad="p-5">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl inline-flex items-center justify-center shrink-0" style={{ background: x.t, color: "var(--ink)" }}><Icon name={x.i} className="w-[18px] h-[18px]" /></span>
              <div className="min-w-0">
                <p className="text-2xl font-bold adm-display tnum leading-none" style={{ color: "var(--ink)" }}>{Number(x.v).toLocaleString()}</p>
                <p className="text-xs mt-1" style={{ color: "var(--ink-2)" }}>{x.l}</p>
              </div>
            </div>
          </Tile>
        ))}
      </div>

      {/* Row 2b: money in, over three windows. Malaysian days, not UTC. Total
          revenue is everything Stripe took; top-ups are the slice of it bought
          as credits, which is why one sits beside the other rather than under
          it. They are not meant to add up. */}
      {canRevenue && (
        <div className="grid gap-4 mt-4 xl:grid-cols-2">
          <Tile pad="p-5">
            <TileHead title="Total revenue"
              right={<OpenArrow onClick={() => go("revenue")} label="Open revenue detail" />} />
            <div className="grid gap-3 sm:grid-cols-3">
              {[["This year", "year"], ["This month", "month"], ["Today", "today"]].map(([label, b]) => (
                <div key={b}>
                  <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{label}</p>
                  <p className="text-[26px] font-bold adm-display tnum leading-tight mt-1" style={{ color: "var(--ink)" }}>
                    {revLoaded ? ringgit2(myrIn(revTotals, b)) : "—"}
                  </p>
                  <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                    {revLoaded ? `${countIn(revTotals, b, "payments")} payments` : "Reading Stripe…"}
                  </p>
                </div>
              ))}
            </div>
            {/* Only speaks up when it has to: a figure that silently drops
                non-ringgit takings would be wrong without saying so. */}
            {otherCcyIn(revTotals).length > 0 && (
              <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
                Ringgit shown. Also taken in {otherCcyIn(revTotals).join(", ")}.
              </p>
            )}
          </Tile>

          <Tile pad="p-5">
            <TileHead title="Credit top-ups"
              right={<OpenArrow onClick={() => go("revenue")} label="Open credit top-up detail" />} />
            <div className="grid gap-3 sm:grid-cols-3">
              {[["This year", "year"], ["This month", "month"], ["Today", "today"]].map(([label, b]) => (
                <div key={b}>
                  <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{label}</p>
                  <p className="text-[26px] font-bold adm-display tnum leading-tight mt-1" style={{ color: "var(--ink)" }}>
                    {ringgit2(myrIn(topupTotals, b))}
                  </p>
                  <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                    {countIn(topupTotals, b, "purchases")} purchases
                  </p>
                </div>
              ))}
            </div>
            {otherCcyIn(topupTotals).length > 0 && (
              <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
                Ringgit shown above. Also taken in {otherCcyIn(topupTotals).join(", ")}.
              </p>
            )}
          </Tile>
        </div>
      )}

      {/* Row 3: rank, plan chart, activity feed */}
      <div className="grid gap-4 mt-4 xl:grid-cols-3">
        <Tile>
          <TileHead title="Expiring soon" right={<SeeAll onClick={() => go("subscriptions")} />} />
          {expiring.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: "var(--ink-3)" }}>
              Nothing expiring in the next 30 days.
            </p>
          ) : (
            <ul className="space-y-4">
              {expiring.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <Monogram label={c.name} size={38} soft />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-neutral-900 truncate">{c.name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--ink-3)" }}>{c.plan} · {c.cycle}</p>
                  </div>
                  {/* Gone already reads differently from going, so it is coloured
                      differently rather than being one more number in a list. */}
                  <span className="text-xs font-semibold tnum shrink-0 text-right"
                    style={{ color: c.daysLeft < 0 ? "var(--c-risk)" : c.daysLeft <= 7 ? "#B45309" : "var(--ink-2)" }}>
                    {c.daysLeft < 0
                      ? `Expired ${Math.abs(c.daysLeft)}d ago`
                      : c.daysLeft === 0 ? "Expires today" : `${c.daysLeft}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile>
          <TileHead title="Plan mix" right={sectionAllowed(role, "subscriptions") && <SeeAll onClick={() => go("subscriptions")} />} />
          <div className="flex flex-wrap items-center gap-4 mb-4">
            {[{ l: "Paying", c: "var(--c-risk)" }, { l: "Trial or suspended", c: "#BFD4EC" }].map((x) => (
              <span key={x.l} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ink-2)" }}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: x.c }} /> {x.l}
              </span>
            ))}
          </div>
          {companies.length === 0
            ? <p className="text-sm py-12 text-center" style={{ color: "var(--ink-3)" }}>No workspaces yet.</p>
            : <PlanColumns rows={planRows} />}
          {/* MRR used to sit here. It was a projection: every active company's
              list price added up, not money anyone had paid. Total revenue above
              reads real Stripe charges, so this only invited the two to be
              compared as though they measured the same thing. */}
        </Tile>

        {/* Every role sees this one. It carries no money and no personal data,
            unlike the admin activity feed that used to sit here, which had to be
            hidden from Support because the audit_log policy refuses them. */}
        <Tile>
          <TileHead title="Country" right={<SeeAll onClick={() => go("companies")} />} />
          <WorldMap counts={mapCounts} max={mapMax} />
          {/* The map cannot show a workspace with no address, and that is the
              majority until people fill in their billing details. The rows carry
              the ones the map has to leave out. */}
          <ul className="space-y-2 mt-4">
            {countries.map((c) => (
              <li key={c.label} className="flex items-center justify-between gap-3">
                <span className="text-sm truncate" style={{ color: c.unknown ? "var(--ink-3)" : "var(--ink-2)" }}>{c.label}</span>
                <span className="text-sm font-semibold tnum shrink-0" style={{ color: "var(--ink)" }}>{c.n}</span>
              </li>
            ))}
            {countries.length === 0 && (
              <li className="text-sm py-2 text-center" style={{ color: "var(--ink-3)" }}>No workspaces yet.</li>
            )}
          </ul>
        </Tile>
      </div>
    </div>
  );
}

// Restoring a suspended workspace has to answer "back onto which plan?", so it
// opens this rather than flipping status silently. Plans are pickable cards
// rather than a dropdown: four options, each with its price, is quicker to read
// than a select and matches the rest of the console.
function StatusDialog({ company, mode, planPrices, onClose, onConfirm }) {
  const [plan, setPlan] = useState(company.plan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const restoring = mode === "restore";
  const changingPlan = restoring && plan !== company.plan;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Monthly price for the picker, in the same ringgit the pricing page quotes.
  const priceOf = (name) => {
    const p = planPrices?.[`${name.toLowerCase()}|monthly`];
    const sen = p?.currencies?.myr ?? (String(p?.currency || "").toLowerCase() === "myr" ? p.amount : null);
    return sen == null ? null : ringgit(sen / 100) + "/mo";
  };

  const go = async () => {
    setBusy(true); setErr("");
    const problem = await onConfirm(company, restoring ? "active" : "suspended", restoring ? plan : null);
    setBusy(false);
    if (problem) setErr(problem); else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
      onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label={`${restoring ? "Restore" : "Suspend"} ${company.name}`}>
      <div className="adm-pop w-full sm:max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
        style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>

        <div className="px-6 sm:px-7 pt-6 pb-5" style={{ background: restoring ? `linear-gradient(135deg,#5570F5,#0B2AE0)` : `linear-gradient(135deg,#F2775A,#DC2626)` }}>
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold adm-display text-white leading-snug">
                {restoring ? "Restore" : "Suspend"} {company.name}?
              </h2>
              <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,.85)" }}>
                {restoring
                  ? "The team gets access back straight away. Pick the plan it returns on."
                  : `All ${company.seats} ${company.seats === 1 ? "person" : "people"} lose access until you restore it. Nothing is deleted.`}
              </p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Close"
              className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ color: "#fff", background: "rgba(255,255,255,.18)" }}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-6 sm:px-7 py-6">

          {restoring ? (
            <fieldset className="mt-6">
              <legend className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--ink-3)" }}>Plan on restore</legend>
              {/* Enterprise is sold and priced by hand, so it is not something
                  to assign from here. It only appears when the workspace is
                  already on it, so restoring cannot silently downgrade them. */}
              <div className="grid grid-cols-2 gap-2">
                {PLAN_ORDER.filter((p) => p !== "Enterprise" || company.plan === "Enterprise").map((p) => {
                  const on = plan === p;
                  const price = priceOf(p);
                  return (
                    <button key={p} type="button" onClick={() => setPlan(p)} aria-pressed={on}
                      className="text-left rounded-2xl px-4 py-3 transition-colors"
                      style={{
                        background: on ? "var(--brand-soft)" : "#fff",
                        border: `1.5px solid ${on ? "var(--brand)" : "var(--line-strong)"}`,
                      }}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold" style={{ color: on ? "var(--brand)" : "var(--ink)" }}>{p}</span>
                        {on && <Icon name="check" className="w-4 h-4" />}
                      </span>
                      <span className="block text-[11px] mt-0.5 tnum" style={{ color: "var(--ink-3)" }}>
                        {p === company.plan ? "Current plan" : price || (p === "Enterprise" ? "Custom priced" : "—")}
                      </span>
                    </button>
                  );
                })}
              </div>
              {changingPlan && (
                <p className="flex items-center gap-2 text-xs mt-3 rounded-xl px-3 py-2.5" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                  <Icon name="warning" className="w-4 h-4 shrink-0" />
                  This also moves them from {company.plan} to {plan}.
                </p>
              )}
            </fieldset>
          ) : (
            <ul className="mt-6 space-y-2">
              {[
                `${company.activeJobs} open ${company.activeJobs === 1 ? "job" : "jobs"} stop accepting applications`,
                "Everyone is signed out and cannot sign back in",
                "Candidate data, jobs and billing history are kept",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm" style={{ color: "var(--ink-2)" }}>
                  <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: "var(--ink-3)" }} />
                  {line}
                </li>
              ))}
            </ul>
          )}

          {err && (
            <p className="flex items-start gap-2 text-sm mt-4 rounded-xl px-3 py-2.5" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5" /> {err}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 sm:px-7 py-4" style={{ background: "var(--app-bg)" }}>
          <button onClick={onClose} disabled={busy}
            className="h-11 px-5 rounded-xl text-sm font-semibold bg-white transition-colors hover:bg-neutral-50"
            style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>Cancel</button>
          <button onClick={go} disabled={busy} autoFocus
            className="h-11 px-5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 inline-flex items-center justify-center gap-2"
            style={{ background: restoring ? "var(--brand)" : "var(--danger)" }}>
            {busy && <Icon name="refresh" className="w-4 h-4" />}
            {busy ? "Working…" : restoring ? `Restore on ${plan}` : "Suspend workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
// One workspace, opened from the list. Companies, User management and
// Subscriptions were three views of the same thing, so this pulls them into one
// place: the team, the plan and the AI bill for a single company, next to the
// actions that change them.
//
// Each tab gates itself. The nav used to do this for free, but inside a drawer
// a Billing admin must not see Team and a Support admin must not see Billing,
// so the check lives on the tab rather than on the route.
const WS_TABS = [
  { key: "overview", label: "Overview", section: "companies" },
  { key: "team",     label: "Team",     section: "users" },
  { key: "billing",  label: "Billing",  section: "subscriptions" },
  { key: "usage",    label: "AI usage", section: "usage" },
];

function WsRow({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
      <span className="text-sm" style={{ color: "var(--ink-2)" }}>{label}</span>
      <span className="text-sm font-semibold tnum text-right" style={{ color: "var(--ink)" }}>
        {value}{hint && <span className="block text-[11px] font-normal" style={{ color: "var(--ink-3)" }}>{hint}</span>}
      </span>
    </div>
  );
}

function WorkspaceDrawer({ company, role, users, subs, usage, aiCosts, planPrices, lastSeen, onClose, onUserAction, onOpenSection }) {
  const tabs = WS_TABS.filter((t) => sectionAllowed(role, t.section));
  const [tab, setTab] = useState(tabs[0]?.key);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const team = users.filter((u) => u.companyId === company.id);
  const sub = subs.find((s) => s.companyId === company.id);
  const use = usage.find((u) => u.companyId === company.id);
  const cost = aiCostFor(use, aiCosts);
  const monthly = planMonthlyMYR(company.plan, company.cycle, planPrices);
  const priced = aiCosts && Object.values(aiCosts).some((v) => v > 0);


  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15,27,51,0.35)" }} onClick={onClose}>
      <aside className="adm-pop w-full max-w-xl h-full overflow-y-auto bg-white" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={company.name}
        style={{ boxShadow: "-30px 0 80px -30px rgba(15,27,51,.45)" }}>

        <header className="sticky top-0 z-10 px-6 pt-5 pb-3" style={{ background: "#fff", borderBottom: "1px solid var(--line)" }}>
          <div className="flex items-start gap-3">
            <Monogram label={company.name} size={40} soft />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold adm-display text-neutral-900 truncate">{company.name}</h2>
              <p className="text-xs mt-0.5 flex flex-wrap items-center gap-x-2" style={{ color: "var(--ink-3)" }}>
                <Badge tone={company.plan === "Enterprise" ? "brand" : "ink"}>{company.plan}</Badge>
                <StatusBadge value={company.status} />
                <span className="tnum">{lastSeen}</span>
              </p>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="w-9 h-9 rounded-full grid place-items-center shrink-0 hover:bg-neutral-100" style={{ color: "var(--ink-3)" }}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex gap-1 mt-4 -mb-3 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} aria-current={tab === t.key ? "page" : undefined}
                className="h-10 px-3.5 rounded-t-xl text-sm font-semibold whitespace-nowrap"
                style={{ color: tab === t.key ? "var(--brand)" : "var(--ink-2)", borderBottom: `2px solid ${tab === t.key ? "var(--brand)" : "transparent"}` }}>
                {t.label}{t.key === "team" && team.length > 0 ? ` (${team.length})` : ""}
              </button>
            ))}
          </nav>
        </header>

        <div className="px-6 py-5">
          {tab === "overview" && (
            <div>
              <WsRow label="Owner" value={company.owner || "None on record"} />
              <WsRow label="Seats" value={company.seats} />
              <WsRow label="Open jobs" value={company.activeJobs} />
              <WsRow label="Candidates" value={company.candidates.toLocaleString()} hint="counted only, never readable here" />
              <WsRow label="Interviews" value={(company.interviews || 0).toLocaleString()} hint={company.upcoming ? `${company.upcoming} still ahead` : undefined} />
              <WsRow label="Hired" value={(company.hired || 0).toLocaleString()} />
              <WsRow label="Last seen" value={lastSeen} />
            </div>
          )}

          {tab === "team" && (
            team.length === 0
              ? <p className="text-sm py-8 text-center" style={{ color: "var(--ink-3)" }}>Nobody on this workspace yet.</p>
              : <ul className="space-y-2">
                  {team.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "var(--app-bg)" }}>
                      <Monogram label={u.name} size={32} soft />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-neutral-900 truncate">{u.name}</p>
                        <p className="text-xs truncate" style={{ color: "var(--ink-3)" }}>{u.email}</p>
                      </div>
                      <Badge tone={u.role === "Owner" ? "brand" : "ink"}>{u.role}</Badge>
                      {u.status === "suspended"
                        ? <ActionBtn icon="refresh" disabled={!can(role, "user.deactivate")} onClick={() => onUserAction(u, "unblock")}>Unblock</ActionBtn>
                        : <ActionBtn icon="ban" tone="danger" disabled={!can(role, "user.deactivate")} onClick={() => onUserAction(u, "block")}>Block</ActionBtn>}
                    </li>
                  ))}
                </ul>
          )}

          {tab === "billing" && (
            <div>
              <WsRow label="Plan" value={company.plan} />
              <WsRow label="Cycle" value={sub?.cycle || company.cycle || "—"} />
              <WsRow label="Subscription" value={sub?.status || "—"} />
              <WsRow label="Monthly" value={monthly == null ? (company.plan === "Enterprise" ? "Custom" : "—") : ringgit(monthly)} />
              <WsRow label="Renews" value={sub?.renews || "—"} />
              <WsRow label="AI cost this month" value={priced ? ringgit2(cost) : "—"} />
              <WsRow label="Margin"
                value={monthly == null ? "—" : (monthly - cost < 0 ? "−" : "") + ringgit2(Math.abs(monthly - cost))}
                hint={monthly == null ? "custom-priced, revenue unknown" : undefined} />
              <button onClick={() => onOpenSection("subscriptions")} className="text-xs font-semibold mt-4" style={{ color: "var(--brand)" }}>
                Change plan in Subscriptions
              </button>
            </div>
          )}

          {tab === "usage" && (
            !use || use.total === 0
              ? <p className="text-sm py-8 text-center" style={{ color: "var(--ink-3)" }}>No AI actions this month.</p>
              : <div>
                  {AI_KINDS.map((k) => (
                    <WsRow key={k.key} label={k.label}
                      value={(use[k.key] || 0).toLocaleString()}
                      hint={priced ? ringgit2(((use[k.key] || 0) * (aiCosts[k.key] || 0)) / 100) : undefined} />
                  ))}
                  <WsRow label="Total" value={use.total.toLocaleString()} hint={priced ? ringgit2(cost) : undefined} />
                </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// Ending a comp used to be a silent toggle because it did nothing to access.
// It suspends now (0173), so it needs the same confirmation the Suspend action
// has, and it has to say which of the two outcomes applies to THIS workspace.
function EndCompDialog({ company, willSuspend, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const go = async () => {
    setBusy(true); setErr("");
    const problem = await onConfirm(company);
    setBusy(false);
    if (problem) setErr(problem); else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
      onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label={`End comp for ${company.name}`}>
      <div className="adm-pop w-full sm:max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
        style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 sm:px-7 pt-6 pb-5"
          style={{ background: willSuspend ? "linear-gradient(135deg,#F2775A,#DC2626)" : "linear-gradient(135deg,#5570F5,#0B2AE0)" }}>
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold adm-display text-white leading-snug">End comp for {company.name}?</h2>
              <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,.85)" }}>
                {willSuspend
                  ? `Nothing else is paying for this workspace, so all ${company.seats} ${company.seats === 1 ? "person" : "people"} lose access immediately and have to buy a plan to get back in.`
                  : "This workspace is paying or still inside its trial, so it keeps access. Only the free grant is removed."}
              </p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Close"
              className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ color: "#fff", background: "rgba(255,255,255,.18)" }}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-6 sm:px-7 py-6">
          {willSuspend && (
            <ul className="text-sm space-y-2" style={{ color: "var(--ink-2)" }}>
              <li>They see the same paywall as a lapsed trial, with the plan picker on it.</li>
              <li>Nothing is deleted today. Jobs, candidates and any bought credits are kept for 30 days.</li>
              <li>Subscribing at any point in that window restores everything.</li>
            </ul>
          )}
          {err && <p className="text-sm mt-4" style={{ color: "var(--danger, #B42318)" }}>{err}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} disabled={busy}
              className="text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors hover:bg-[color:var(--bg)] disabled:opacity-50"
              style={{ color: "var(--ink-2)", border: "1px solid var(--line-strong)" }}>Cancel</button>
            <button onClick={go} disabled={busy}
              className="text-sm font-semibold rounded-xl px-4 py-2.5 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: willSuspend ? "#DC2626" : "var(--brand)" }}>
              {busy ? "Working…" : willSuspend ? "End comp and suspend" : "End comp"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Companies({ role, companies, setCompanies, users = [], subs = [], usage, aiCosts, planPrices, activity = [], audit, onAction, go }) {
  const [openWs, setOpenWs] = useState(null);   // workspace shown in the drawer
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(null);   // { company, mode }
  const [dormantOnly, setDormantOnly] = useState(false);
  // Dormant: a PAYING workspace nobody has signed into for 30 days. Trials are
  // excluded because a quiet trial is expected, not alarming; this is churn you
  // can still act on. "never" counts only once we have been recording long
  // enough to tell silence from a column that was empty until 0157.
  const DORMANT_DAYS = 30;
  const seenAt = new Map(activity.map((a) => [a.company_id, a.last_active_at]));
  const daysQuiet = (id) => {
    const at = seenAt.get(id);
    if (!at) return null;
    return Math.floor((LOADED_AT - new Date(at).getTime()) / 86400000);
  };
  const isDormant = (c) => {
    if (c.status !== "active") return false;
    const d = daysQuiet(c.id);
    return d != null && d >= DORMANT_DAYS;
  };
  const dormantCount = companies.filter(isDormant).length;

  const costOf = (id) => aiCostFor(usage.find((u) => u.companyId === id), aiCosts);
  const priced = aiCosts && Object.values(aiCosts).some((v) => v > 0);

  // One row of chips that both counts and filters. An ops console is read by
  // asking "how many are suspended" and then "which ones", and a count you
  // cannot click makes you go and type the answer into search instead.
  const [seg, setSeg] = useState("all");
  const SEGMENTS = [
    { key: "all", label: "All", match: () => true },
    { key: "active", label: "Active", match: (c) => c.status === "active" && !c.compedAt },
    { key: "trial", label: "Trial", match: (c) => c.status === "trial" },
    { key: "comped", label: "Comped", match: (c) => !!c.compedAt },
    { key: "suspended", label: "Suspended", match: (c) => c.status === "suspended", tone: "danger" },
    { key: "dormant", label: "Dormant", match: isDormant, tone: "warn" },
  ].map((s) => ({ ...s, n: companies.filter(s.match).length }));

  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  const sortVal = (c, key) => {
    switch (key) {
      case "seats": return c.seats || 0;
      case "jobs": return c.activeJobs || 0;
      case "candidates": return c.candidates || 0;
      // Never-seen sorts as the quietest rather than the busiest: an unknown is
      // not the same as "active today", and putting it top would hide the real
      // dormant workspaces underneath it.
      case "seen": { const d = daysQuiet(c.id); return d == null ? Number.MAX_SAFE_INTEGER : d; }
      case "ai": return costOf(c.id);
      default: return String(c.name || "").toLowerCase();
    }
  };
  const rows = companies
    .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => (dormantOnly ? isDormant(c) : (SEGMENTS.find((s) => s.key === seg) || SEGMENTS[0]).match(c)))
    .sort((a, a2) => {
      const x = sortVal(a, sort.key), y = sortVal(a2, sort.key);
      const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const [compDialog, setCompDialog] = useState(null);   // company pending "End comp"

  // Whether ending the comp will lock them out. Mirrors 0173's rule; the
  // database still decides, this only picks which warning the dialog shows.
  const compWouldSuspend = (c) =>
    !(c.subStatus === "active" || c.subStatus === "past_due") &&
    !(c.subStatus === "trialing" && c.status === "trial");

  // Grant or withdraw a free plan. Withdrawing suspends unless something else is
  // paying for the workspace (0173), so it goes through a confirmation.
  const onComp = async (c, on) => {
    const suspending = !on && compWouldSuspend(c);
    setCompanies((cs) => cs.map((x) => x.id === c.id ? {
      ...x,
      compedAt: on ? new Date().toISOString() : null,
      status: suspending ? "suspended" : x.status,
    } : x));
    const err = await onAction("admin_set_comped", { p_company: c.id, p_comped: on, p_note: null },
      on ? "Comped workspace" : suspending ? "Ended comp and suspended workspace" : "Ended comp", c.name);
    if (err) setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, compedAt: c.compedAt, status: c.status } : x));
    return err;
  };

  // Publish (or stop publishing) this workspace's open roles to the external
  // job-site feed. The customer has the same switch in their own Settings; this
  // one exists so a pilot can be turned on during the call that sells it.
  const onFeed = async (c, on) => {
    setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, feedEnabled: on } : x));
    const err = await onAction("admin_set_company_feed", { p_company_id: c.id, p_enabled: on },
      on ? "Enabled job-site feed" : "Disabled job-site feed", c.name);
    if (err) setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, feedEnabled: c.feedEnabled } : x));
  };

  // Confirmed from the dialog. Status first, then the plan when it changed, so a
  // failed plan change cannot leave a workspace suspended-but-reported-restored.
  const apply = async (c, status, plan) => {
    setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, status, plan: plan || x.plan } : x));   // optimistic
    const err = await onAction("admin_set_company_status", { p_company: c.id, p_suspend: status === "suspended" },
      status === "suspended" ? "Suspended company" : "Restored company", c.name);
    if (err) {
      setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, status: c.status, plan: c.plan } : x));
      return err;
    }
    if (plan && plan !== c.plan) {
      const planErr = await onAction("admin_change_plan", { p_company: c.id, p_plan: plan.toLowerCase() },
        "Changed subscription plan", `${c.name} → ${plan}`);
      if (planErr) {
        setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, plan: c.plan } : x));
        return `Restored, but the plan change failed: ${planErr}`;
      }
    }
    return null;
  };

  return (
    <div>
      <SectionHead title="">
        <div className="flex items-center gap-2">
          <label className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ink-3)" }}><Icon name="search" className="w-4 h-4" /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies"
              aria-label="Search companies"
              className="adm-input pl-9 pr-8 h-11 rounded-xl text-sm w-64" style={{ border: "1px solid var(--line)", background: "#fff" }} />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search"
                className="adm-x absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center" style={{ color: "var(--ink-3)" }}>
                <Icon name="close" className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
        </div>
      </SectionHead>

      {/* Segments carry the counts, so the shape of the book of business reads
          off one line before anyone has filtered anything. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {SEGMENTS.map((s) => {
          const on = !dormantOnly && seg === s.key;
          const accent = s.tone === "danger" ? "var(--c-risk)" : s.tone === "warn" ? "var(--warn)" : "var(--brand, #0B2AE0)";
          return (
            <button key={s.key} type="button" aria-pressed={on}
              onClick={() => { setDormantOnly(false); setSeg(s.key); }}
              className="adm-seg h-9 pl-3 pr-2.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-2"
              style={{
                background: on ? accent : "#fff",
                borderColor: on ? accent : "var(--line)",
                color: on ? "#fff" : s.n === 0 ? "var(--ink-3)" : "var(--ink-2)",
              }}>
              {s.label}
              <span className="tnum text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: on ? "rgba(255,255,255,0.22)" : "var(--app-bg)", color: on ? "#fff" : "var(--ink-3)" }}>{s.n}</span>
            </button>
          );
        })}
      </div>

      <TableShell
        minWidth={880}
        sort={sort} onSort={onSort}
        head={[
          { label: "Company", key: "name" },
          "Plan", "Status",
          { label: "Seats", key: "seats", align: "right" },
          { label: "Jobs", key: "jobs", align: "right" },
          { label: "Candidates", key: "candidates", align: "right" },
          { label: "Last seen", key: "seen", align: "right" },
          { label: "AI this month", key: "ai", align: "right" },
          "Actions",
        ]}>
        {rows.map((c) => {
          const u = usage.find((x) => x.companyId === c.id);
          const cost = costOf(c.id);
          const quiet = daysQuiet(c.id);
          return (
            <tr key={c.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
              <Td>
                <div className="flex items-center gap-3">
                  <Monogram label={c.name} size={34} soft />
                  <div className="min-w-0">
                    <button onClick={() => setOpenWs(c)} className="adm-link font-semibold text-neutral-900 text-left truncate block max-w-[15rem]">{c.name}</button>
                    <div className="text-xs truncate max-w-[15rem]" style={{ color: "var(--ink-3)" }}>{c.owner || "No owner on record"}</div>
                  </div>
                </div>
              </Td>
              <Td><Badge tone={c.plan === "Enterprise" ? "brand" : "ink"}>{c.plan}</Badge></Td>
              <Td>{c.compedAt ? <Badge tone="brand" dot>comped</Badge> : <StatusBadge value={c.status} />}</Td>
              <Td className="tnum text-right">{c.seats}</Td>
              <Td className="tnum text-right">{c.activeJobs}</Td>
              {/* The padlock says these are counted and never readable. It stays
                  on the row rather than moving to a footnote, because that is
                  the promise the whole console is built on. */}
              <Td className="text-right">
                <span className="inline-flex items-center gap-1.5 tnum" title="Counted only, never readable here">
                  <span style={{ color: "var(--ink-3)" }}><Icon name="lock" className="w-3.5 h-3.5" /></span>
                  {c.candidates.toLocaleString()}
                </span>
              </Td>
              <Td className="text-right">
                {quiet == null
                  ? <span className="text-xs" style={{ color: "var(--ink-3)" }}>not recorded</span>
                  : <span className="text-sm tnum font-medium" style={{ color: isDormant(c) ? "var(--warn)" : "var(--ink-2)" }}>{quiet === 0 ? "today" : `${quiet}d ago`}</span>}
              </Td>
              <Td className="text-right">
                <div className="tnum font-semibold" style={{ color: cost > 0 ? "var(--ink)" : "var(--ink-3)" }}>
                  {priced ? ringgit2(cost) : "—"}
                </div>
                <div className="text-xs tnum" style={{ color: "var(--ink-3)" }}>
                  {u ? `${u.total.toLocaleString()} AI ${u.total === 1 ? "action" : "actions"}` : "no usage"}
                </div>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {/* Comp is offered only where it means something: a paying
                      workspace already has its plan and Stripe owns it. */}
                  {c.compedAt
                    ? <ActionBtn icon="close" disabled={!can(role, "company.comp")} onClick={() => setCompDialog(c)}>End comp</ActionBtn>
                    : <ActionBtn icon="spark" disabled={!can(role, "company.comp") || c.subStatus === "active"} onClick={() => onComp(c, true)}>Comp</ActionBtn>}
                  {/* Job-site advertising. Labelled by what the click does, like
                      the buttons either side of it: "Unlist" means it is on. */}
                  {c.feedEnabled
                    ? <ActionBtn icon="close" disabled={!can(role, "company.feed")} onClick={() => onFeed(c, false)}>Unlist</ActionBtn>
                    : <ActionBtn icon="external" disabled={!can(role, "company.feed") || c.status === "suspended"} onClick={() => onFeed(c, true)}>Advertise</ActionBtn>}
                  {c.status === "suspended"
                    ? <ActionBtn icon="refresh" disabled={!can(role, "company.restore")} onClick={() => setDialog({ company: c, mode: "restore" })}>Restore</ActionBtn>
                    : <ActionBtn icon="ban" tone="danger" disabled={!can(role, "company.suspend")} onClick={() => setDialog({ company: c, mode: "suspend" })}>Suspend</ActionBtn>}
                </div>
              </Td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={9} className="px-5 py-14 text-center">
              <span className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: "var(--app-bg)", color: "var(--ink-3)" }}>
                <Icon name="search" className="w-5 h-5" />
              </span>
              <p className="text-sm font-semibold mt-3" style={{ color: "var(--ink-2)" }}>
                {q ? `Nothing matches "${q}"` : "No workspaces in this view"}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>
                {q ? "Check the spelling, or clear the search." : "Try a different filter above."}
              </p>
              {(q || seg !== "all") && (
                <button type="button" onClick={() => { setQ(""); setSeg("all"); setDormantOnly(false); }}
                  className="adm-link text-xs font-semibold mt-3" style={{ color: "var(--brand, #0B2AE0)" }}>
                  Clear filters
                </button>
              )}
            </td>
          </tr>
        )}
      </TableShell>
      {!priced && (
        <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>
          AI cost shows a dash until the per-action rates are set under AI costs.
        </p>
      )}
      {openWs && (
        <WorkspaceDrawer
          company={companies.find((x) => x.id === openWs.id) || openWs}
          role={role} users={users} subs={subs} usage={usage} aiCosts={aiCosts} planPrices={planPrices}
          lastSeen={(() => { const d = daysQuiet(openWs.id); return d == null ? "not recorded" : d === 0 ? "seen today" : `seen ${d}d ago`; })()}
          onClose={() => setOpenWs(null)}
          onUserAction={(u, mode) => onAction("admin_set_user_status", { p_profile: u.id, p_active: mode === "unblock" },
            mode === "block" ? "Blocked user access" : "Restored user access", u.email)}
          onOpenSection={() => { setOpenWs(null); go("workspaces"); }} />
      )}
      {dialog && <StatusDialog company={dialog.company} mode={dialog.mode} planPrices={planPrices} onClose={() => setDialog(null)} onConfirm={apply} />}
      {compDialog && (
        <EndCompDialog company={compDialog} willSuspend={compWouldSuspend(compDialog)}
          onClose={() => setCompDialog(null)} onConfirm={(c) => onComp(c, false)} />
      )}
    </div>
  );
}
// Blocking or unblocking a person's access, and sending them a reset email, are
// both things you want to be sure about before they happen. One dialog covers
// all three, naming the consequence rather than just the verb.
function UserActionDialog({ user, company, mode, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const meta = {
    block:   { title: "Block access for", cta: "Block access", btn: "var(--danger)",
               body: "They are signed out and cannot sign back in until you unblock them. Their account, assignments and history are kept.",
               points: ["Cannot sign in to the workspace", "Stays on the team list, marked suspended", "Nothing is deleted"] },
    unblock: { icon: "refresh", tint: "var(--t-mint)",      fg: "#166534",       title: "Restore access for", cta: "Unblock", btn: "var(--brand)",
               body: "They can sign in again immediately, with the same role and assignments they had before.",
               points: ["Can sign in straight away", "Role and assignments unchanged"] },
    reset:   { icon: "mail",    tint: "var(--brand-soft)",  fg: "var(--brand)",  title: "Send a password reset to", cta: "Send reset email", btn: "var(--brand)",
               body: "Aster emails them a reset link. Nobody here sees or sets the password, and their current one keeps working until they use the link.",
               points: ["Sent to the address below", "Link expires on its own", "Their session is not ended"] },
  }[mode];

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const go = async () => {
    setBusy(true); setErr("");
    const problem = await onConfirm(user, mode);
    setBusy(false);
    if (problem) setErr(problem); else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
      onClick={() => !busy && onClose()} role="dialog" aria-modal="true">
      <div className="adm-pop w-full sm:max-w-md rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
        style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>
        {/* A gradient band carries the tone instead of an icon chip, matching
            the mobile app's sign-in header. Red only when access is removed. */}
        <div className="px-6 sm:px-7 pt-6 pb-5"
          style={{ background: mode === "block" ? "linear-gradient(135deg,#F2775A,#DC2626)" : "linear-gradient(135deg,#5570F5,#0B2AE0)" }}>
          <h2 className="text-lg font-bold adm-display text-white leading-snug">{meta.title} {user.name}?</h2>
          <p className="text-xs mt-1 tnum" style={{ color: "rgba(255,255,255,.75)" }}>{user.email} · {company} · {user.role}</p>
          <p className="text-sm mt-3" style={{ color: "rgba(255,255,255,.9)" }}>{meta.body}</p>
        </div>
        <div className="px-6 sm:px-7 py-6">
          <ul className="space-y-1.5">
            {meta.points.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
                <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: "var(--ink-3)" }} />{p}
              </li>
            ))}
          </ul>
          {err && (
            <p className="flex items-start gap-2 text-sm mt-4 rounded-xl px-3 py-2.5" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5" /> {err}
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 sm:px-7 py-4" style={{ background: "var(--app-bg)" }}>
          <button onClick={onClose} disabled={busy} className="h-11 px-5 rounded-xl text-sm font-semibold bg-white"
            style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>Cancel</button>
          <button onClick={go} disabled={busy} autoFocus
            className="h-11 px-5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: meta.btn }}>{busy ? "Working…" : meta.cta}</button>
        </div>
      </div>
    </div>
  );
}

function Users({ role, companies, users, setUsers, audit, onAction }) {
  const cName = (id) => companies.find((c) => c.id === id)?.name || "—";
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [userRole, setUserRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [dialog, setDialog] = useState(null);      // { user, mode }
  const [toast, setToast] = useState("");

  const roles = [...new Set(users.map((u) => u.role).filter(Boolean))].sort();
  const term = q.trim().toLowerCase();
  const rows = users.filter((u) =>
    (!term || `${u.name} ${u.email}`.toLowerCase().includes(term)) &&
    (company === "all" || u.companyId === company) &&
    (userRole === "all" || u.role === userRole) &&
    (status === "all" || u.status === status));

  // One place for all three actions, so each reports its own failure.
  const run = async (u, mode) => {
    if (mode === "reset") {
      const err = await onAction("__reset_password__", { email: u.email }, "Sent password reset", u.email);
      if (err) return err;
      setToast(`Reset email sent to ${u.email}.`);
      return null;
    }
    const next = mode === "block" ? "suspended" : "active";
    setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status: next } : x));   // optimistic
    const err = await onAction("admin_set_user_status", { p_profile: u.id, p_active: next === "active" },
      mode === "block" ? "Blocked user access" : "Restored user access", u.email);
    if (err) {
      setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status: u.status } : x));   // rollback
      return err;
    }
    setToast(mode === "block" ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`);
    return null;
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const select = "h-11 rounded-xl px-3 pr-8 text-sm bg-white appearance-none";
  const selectStyle = { border: "1px solid var(--line)", color: "var(--ink-2)" };

  return (
    <div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }}><Icon name="search" className="w-4 h-4" /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email"
            className="w-full pl-9 pr-3 h-11 rounded-xl text-sm bg-white" style={{ border: "1px solid var(--line)" }} />
        </label>
        {[
          { v: company, set: setCompany, all: "All companies", opts: companies.map((c) => [c.id, c.name]) },
          { v: userRole, set: setUserRole, all: "All roles", opts: roles.map((r) => [r, r]) },
          { v: status, set: setStatus, all: "All statuses", opts: [["active", "Active"], ["suspended", "Blocked"], ["invited", "Invited"]] },
        ].map((f, i) => (
          <div key={i} className="relative">
            <select value={f.v} onChange={(e) => f.set(e.target.value)} className={select} style={selectStyle}>
              <option value="all">{f.all}</option>
              {f.opts.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ink-3)" }}><Icon name="chevronDown" className="w-3.5 h-3.5" /></span>
          </div>
        ))}
        {(term || company !== "all" || userRole !== "all" || status !== "all") && (
          <button onClick={() => { setQ(""); setCompany("all"); setUserRole("all"); setStatus("all"); }}
            className="h-11 px-4 rounded-xl text-sm font-semibold" style={{ color: "var(--brand)" }}>Clear</button>
        )}
        <span className="text-xs tnum ml-auto" style={{ color: "var(--ink-3)" }}>{rows.length} of {users.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] py-16 text-center" style={{ background: "#fff", border: "1px solid var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>No users match those filters.</p>
        </div>
      ) : (
        <TableShell head={["User", "Company", "Role", "Access", "Last active", "Actions"]}>
          {rows.map((u) => (
            <tr key={u.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
              <Td><div className="font-semibold text-neutral-900">{u.name}</div><div className="text-xs" style={{ color: "var(--ink-3)" }}>{u.email}</div></Td>
              <Td style={{ color: "var(--ink-2)" }}>{cName(u.companyId)}</Td>
              <Td><Badge tone={u.role === "Owner" ? "brand" : "ink"}>{u.role}</Badge></Td>
              <Td>{u.status === "suspended" ? <Badge tone="danger" dot>blocked</Badge> : <StatusBadge value={u.status} />}</Td>
              <Td>
                {u.lastActive
                  ? <span style={{ color: "var(--ink-2)" }}>{u.lastActive}</span>
                  : <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                      {u.joined ? `Joined ${u.joined}, not seen since` : "Never signed in"}
                    </span>}
              </Td>
              <Td>
                <div className="flex gap-2">
                  <ActionBtn icon="mail" disabled={!can(role, "user.reset")} onClick={() => setDialog({ user: u, mode: "reset" })}>Reset password</ActionBtn>
                  {u.status === "suspended"
                    ? <ActionBtn icon="refresh" disabled={!can(role, "user.deactivate")} onClick={() => setDialog({ user: u, mode: "unblock" })}>Unblock</ActionBtn>
                    : <ActionBtn icon="ban" tone="danger" disabled={!can(role, "user.deactivate")} onClick={() => setDialog({ user: u, mode: "block" })}>Block access</ActionBtn>}
                </div>
              </Td>
            </tr>
          ))}
        </TableShell>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 adm-pop flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-medium text-white"
          role="status" aria-live="polite" style={{ background: "var(--pill)", boxShadow: "0 20px 50px -20px rgba(15,27,51,.6)" }}>
          <Icon name="check" className="w-4 h-4" /> {toast}
        </div>
      )}
      {dialog && (
        <UserActionDialog user={dialog.user} company={cName(dialog.user.companyId)} mode={dialog.mode}
          onClose={() => setDialog(null)} onConfirm={run} />
      )}
    </div>
  );
}
// Monthly price of a plan in ringgit, from the live Stripe prices. A yearly
// subscription contributes a twelfth of its price per month.
function planMonthlyMYR(plan, cycle, planPrices) {
  const key = String(plan || "").toLowerCase();
  if (!planPrices || !key || key === "enterprise") return null;
  const p = planPrices[`${key}|${cycle === "yearly" ? "yearly" : "monthly"}`] || planPrices[`${key}|monthly`];
  const sen = p?.currencies?.myr ?? (String(p?.currency || "").toLowerCase() === "myr" ? p.amount : null);
  if (sen == null) return null;
  return (p.interval === "year" ? sen / 12 : sen) / 100;
}

// Upgrade and downgrade are different decisions with different consequences, so
// they get one flow that names which is happening and spells out the effect.
// Direction comes from the plan order, not from the button that opened it.
function PlanChangeDialog({ sub, company, planPrices, onClose, onConfirm }) {
  const [plan, setPlan] = useState(sub.plan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const rank = (p) => PLAN_ORDER.indexOf(p);
  const direction = plan === sub.plan ? "same" : rank(plan) > rank(sub.plan) ? "up" : "down";
  // Only an active subscription is actually being charged; a trial is not.
  const billing = sub.status === "active";
  const nowPrice = planMonthlyMYR(sub.plan, sub.cycle, planPrices);
  const nextPrice = planMonthlyMYR(plan, sub.cycle, planPrices);
  const delta = nowPrice != null && nextPrice != null ? nextPrice - nowPrice : null;

  // What actually tightens on a downgrade, from the limits the app enforces.
  const limitDrops = (() => {
    if (direction !== "down") return [];
    const from = PLAN_LIMITS[sub.plan.toLowerCase()] || {};
    const to = PLAN_LIMITS[plan.toLowerCase()] || {};
    const named = [
      { f: "maxJobs", l: "Active jobs" },
      { f: "parseApplicant", l: "Applicant screenings" },
      { f: "resumeUploads", l: "Resume screenings" },
      { f: "aiRunsPerMonth", l: "AI rank" },
      { f: "aiInsightsPerMonth", l: "AI insight" },
      { f: "interviewQuestionsPerMonth", l: "Interview questions" },
    ];
    const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString() : "∞");
    return named.filter(({ f }) => (to[f] ?? 0) < (from[f] ?? 0)).map(({ f, l }) => `${l}: ${fmt(from[f])} → ${fmt(to[f])}`);
  })();

  const go = async () => {
    setBusy(true); setErr("");
    const problem = await onConfirm(sub, plan);
    setBusy(false);
    if (problem) setErr(problem); else onClose();
  };

  const verb = direction === "up" ? "Upgrade" : direction === "down" ? "Downgrade" : "Change plan";
  const tone = direction === "down" ? "var(--warn)" : "var(--brand)";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
      onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label={`Change plan for ${company}`}>
      <div className="adm-pop w-full sm:max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
        style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>

        <div className="p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="w-12 h-12 rounded-2xl inline-flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
              <Icon name="card" className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold adm-display text-neutral-900 leading-snug">Change plan</h2>
              <p className="text-sm mt-1.5" style={{ color: "var(--ink-2)" }}>
                {company} is on <strong>{sub.plan}</strong>, billed {sub.cycle}
                {nowPrice != null && <> at <span className="tnum">{ringgit(nowPrice)}/mo</span></>}.
              </p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Close"
              className="w-9 h-9 rounded-full grid place-items-center shrink-0 transition-colors hover:bg-neutral-100" style={{ color: "var(--ink-3)" }}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>

          <fieldset className="mt-6">
            <legend className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--ink-3)" }}>Move to</legend>
            <div className="grid grid-cols-2 gap-2">
              {/* Enterprise is negotiated by hand, so it is only offered to a
                  workspace already on it. */}
              {PLAN_ORDER.filter((p) => p !== "Enterprise" || sub.plan === "Enterprise").map((p) => {
                const on = plan === p;
                const price = planMonthlyMYR(p, sub.cycle, planPrices);
                const dir = p === sub.plan ? null : rank(p) > rank(sub.plan) ? "Upgrade" : "Downgrade";
                return (
                  <button key={p} type="button" onClick={() => setPlan(p)} aria-pressed={on}
                    className="text-left rounded-2xl px-4 py-3 transition-colors"
                    style={{ background: on ? "var(--brand-soft)" : "#fff", border: `1.5px solid ${on ? "var(--brand)" : "var(--line-strong)"}` }}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold" style={{ color: on ? "var(--brand)" : "var(--ink)" }}>{p}</span>
                      {on && <Icon name="check" className="w-4 h-4" />}
                    </span>
                    <span className="block text-[11px] mt-0.5 tnum" style={{ color: "var(--ink-3)" }}>
                      {p === sub.plan ? "Current plan" : price != null ? `${ringgit(price)}/mo · ${dir}` : p === "Enterprise" ? "Custom priced" : dir}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {direction !== "same" && (
            <div className="mt-4 rounded-2xl px-4 py-3" style={{ background: "var(--app-bg)" }}>
              <p className="text-sm font-semibold" style={{ color: tone }}>
                {verb} to {plan}
                {/* A price delta only means something to someone being billed.
                    A trial pays nothing, so quoting one would be fiction. */}
                {billing && delta != null && delta !== 0 && (
                  <span className="tnum font-normal" style={{ color: "var(--ink-2)" }}>
                    {" "}· {delta > 0 ? "+" : "−"}{ringgit(Math.abs(delta))}/mo
                  </span>
                )}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--ink-2)" }}>
                {!billing
                  ? `This workspace is ${sub.status || "not subscribed"}, so nothing is billed and no subscription is created. It changes which tier the allowances come from.`
                  : direction === "up"
                    ? "Higher allowances apply immediately. This does NOT change what the payment processor charges: update the subscription there too."
                    : "Lower allowances apply immediately. This does NOT change what the payment processor charges: update the subscription there too."}
              </p>
              {limitDrops.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {limitDrops.map((l) => (
                    <li key={l} className="flex items-start gap-2 text-xs tnum" style={{ color: "var(--warn)" }}>
                      <Icon name="warning" className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {l}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {err && (
            <p className="flex items-start gap-2 text-sm mt-4 rounded-xl px-3 py-2.5" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5" /> {err}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 sm:px-7 py-4" style={{ background: "var(--app-bg)" }}>
          <button onClick={onClose} disabled={busy}
            className="h-11 px-5 rounded-xl text-sm font-semibold bg-white transition-colors hover:bg-neutral-50"
            style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>Cancel</button>
          <button onClick={go} disabled={busy || direction === "same"} autoFocus
            className="h-11 px-5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: direction === "down" ? "var(--warn)" : "var(--brand)" }}>
            {busy ? "Working…" : direction === "same" ? "Pick a different plan" : `${verb} to ${plan}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MarginPanel({ companies, usage, aiCosts, planPrices }) {
  // What each workspace pays us against what its AI cost this month. Enterprise
  // is custom-priced with no Stripe figure, so its revenue is unknown rather
  // than guessed, and it is left out of the totals.
  const margins = companies.map((c) => {
    const cost = aiCostFor(usage.find((u) => u.companyId === c.id), aiCosts);
    const rev = c.subStatus === "active" ? planMonthlyMYR(c.plan, c.cycle, planPrices) : 0;
    return { ...c, cost, rev, margin: rev == null ? null : rev - cost, known: rev != null };
  });
  const knownMargins = margins.filter((m) => m.known);
  const losing = knownMargins.filter((m) => m.margin < 0).sort((a, b) => a.margin - b.margin);
  const worst = [...knownMargins].sort((a, b) => a.margin - b.margin).slice(0, 6);
  const netMargin = knownMargins.reduce((s, m) => s + m.margin, 0);
  const costed = aiCosts && Object.values(aiCosts).some((v) => v > 0);
  // Every figure is meaningless at a zero rate, so say so rather than render a
  // table of zeros that reads like real margin.
  if (!costed) {
    return (
      <Tile className="mt-4">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Margin needs the AI rates set. Until then every workspace would show its
          revenue as profit, which is not true.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>Settings &rsaquo; AI costs</p>
      </Tile>
    );
  }
  return (
      <Tile className="mt-4">
        <TileHead
          title="Margin by workspace"
          right={<span className="text-xs tnum" style={{ color: netMargin < 0 ? "var(--c-risk)" : "var(--ink-3)" }}>
            Net {ringgit2(netMargin)}/mo
          </span>} />
        {losing.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 mb-4" style={{ background: "var(--danger-soft)" }}>
            <span style={{ color: "var(--danger)" }} className="shrink-0 mt-0.5"><Icon name="warning" className="w-4 h-4" /></span>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              <strong style={{ color: "var(--danger)" }}>{losing.length} {losing.length === 1 ? "workspace costs" : "workspaces cost"} more than they pay.</strong>{" "}
              {losing.slice(0, 3).map((m) => m.name).join(", ")}{losing.length > 3 ? " and others" : ""}.
            </p>
          </div>
        )}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {worst.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
              <span className="font-semibold text-neutral-900 min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-xs tnum" style={{ color: "var(--ink-3)" }}>
                pays {ringgit2(m.rev)} · costs {ringgit2(m.cost)}
              </span>
              <span className="text-sm font-bold tnum w-24 text-right" style={{ color: m.margin < 0 ? "var(--c-risk)" : "var(--ok)" }}>
                {m.margin < 0 ? "−" : ""}{ringgit2(Math.abs(m.margin))}
              </span>
            </li>
          ))}
        </ul>
        {margins.some((m) => !m.known) && (
          <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
            {margins.filter((m) => !m.known).length} Enterprise {margins.filter((m) => !m.known).length === 1 ? "workspace is" : "workspaces are"} custom-priced,
            so their revenue is unknown and they are left out of the net figure. Their AI cost still shows on Usage monitoring.
          </p>
        )}
      </Tile>
  );
}

function Subscriptions({ role, companies, subs, setSubs, planPrices, topups = [], audit, onAction }) {
  const cName = (id) => companies.find((c) => c.id === id)?.name || "—";
  const [dialog, setDialog] = useState(null);
  const allowed = can(role, "subscription.change");

  // Ringgit top-ups summed; anything charged in another currency is named
  // rather than converted at whatever today's rate happens to be.
  const topupMYR = topups.filter((t) => t.currency === "myr").reduce((a, t) => a + Number(t.amount_cents || 0), 0);
  const otherCurrencies = [...new Set(topups.filter((t) => t.currency !== "myr").map((t) => String(t.currency).toUpperCase()))];

  const mrrOf = (s) => (s.status === "active" ? planMonthlyMYR(s.plan, s.cycle, planPrices) : null);
  const total = subs.reduce((a, s) => a + (mrrOf(s) || 0), 0);

  const change = async (sub, plan) => {
    setSubs((ss) => ss.map((x) => x.companyId === sub.companyId ? { ...x, plan } : x));   // optimistic
    const err = await onAction("admin_change_plan", { p_company: sub.companyId, p_plan: plan.toLowerCase() },
      "Changed subscription plan", `${cName(sub.companyId)} → ${plan}`);
    if (err) {
      setSubs((ss) => ss.map((x) => x.companyId === sub.companyId ? { ...x, plan: sub.plan } : x));   // rollback
      return err;
    }
    return null;
  };

  return (
    <div>
      <SectionHead title="">
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Active MRR</p>
            <p className="text-lg font-bold adm-display tnum" style={{ color: "var(--ok)" }}>
              {planPrices ? ringgit(total) : "—"}
            </p>
          </div>
          {/* Credit top-ups are billed on top of the plan, so they are shown
              beside MRR rather than folded into it: one is recurring, the other
              is not, and adding them would make MRR mean something else. */}
          <div className="text-right">
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Top-ups this month</p>
            <p className="text-lg font-bold adm-display tnum" style={{ color: topupMYR ? "var(--ok)" : "var(--ink-3)" }}>
              {ringgit(topupMYR / 100)}
            </p>
            {otherCurrencies.length > 0 && (
              <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                plus {otherCurrencies.join(", ")}
              </p>
            )}
          </div>
        </div>
      </SectionHead>
      <TableShell head={["Company", "Plan", "Cycle", "Status", "Monthly", "Renews", "Actions"]}>
        {subs.map((s) => {
          const monthly = planMonthlyMYR(s.plan, s.cycle, planPrices);
          return (
            <tr key={s.companyId} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
              <Td className="font-semibold text-neutral-900">{cName(s.companyId)}</Td>
              <Td><Badge tone={s.plan === "Enterprise" ? "brand" : "ink"}>{s.plan}</Badge></Td>
              <Td style={{ color: "var(--ink-2)" }}>{s.cycle}</Td>
              <Td><StatusBadge value={s.status} /></Td>
              <Td className="tnum">
                {monthly == null
                  ? <span style={{ color: "var(--ink-3)" }}>{s.plan === "Enterprise" ? "Custom" : "—"}</span>
                  : <>
                      <span style={{ color: s.status === "active" ? "var(--ink)" : "var(--ink-3)" }}>{ringgit(monthly)}</span>
                      {s.status !== "active" && <div className="text-[11px]" style={{ color: "var(--ink-3)" }}>not billing yet</div>}
                    </>}
              </Td>
              <Td style={{ color: "var(--ink-2)" }}>{s.renews}</Td>
              <Td>
                {s.status === "active"
                  ? <span className="text-xs" style={{ color: "var(--ink-3)" }} title="Stripe rewrites the plan from its own subscription events, so changing it here would not be charged and would revert.">Manage in Stripe</span>
                  : <ActionBtn icon="refresh" disabled={!allowed} onClick={() => setDialog(s)}>Change plan</ActionBtn>}
              </Td>
            </tr>
          );
        })}
      </TableShell>
      {!planPrices && (
        <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>Prices are still loading from Stripe.</p>
      )}
      {dialog && (
        <PlanChangeDialog sub={dialog} company={cName(dialog.companyId)} planPrices={planPrices}
          onClose={() => setDialog(null)} onConfirm={change} />
      )}
    </div>
  );
}
function Usage({ role, usage, aiCosts, period, periods, onPeriod }) {
  const [sort, setSort] = useState("cost");
  const priced = aiCosts && Object.values(aiCosts).some((v) => v > 0);

  const rows = usage.map((u) => ({ ...u, cost: aiCostFor(u, aiCosts) }));
  rows.sort((a, b) => (sort === "cost" ? b.cost - a.cost || b.total - a.total : b.total - a.total));

  const totals = AI_KINDS.reduce((m, k) => ({ ...m, [k.key]: rows.reduce((s, r) => s + (r[k.key] || 0), 0) }), {});
  const grandActions = rows.reduce((s, r) => s + r.total, 0);
  const grandCost = rows.reduce((s, r) => s + r.cost, 0);
  const active = rows.filter((r) => r.total > 0).length;
  const maxCost = Math.max(1, ...rows.map((r) => r.cost));

  return (
    <div>
      <SectionHead title="">
        <label className="relative">
          <select value={period} onChange={(e) => onPeriod(e.target.value)}
            className="appearance-none h-11 pl-4 pr-9 rounded-xl text-sm font-medium bg-white" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
            {periods.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ink-3)" }}><Icon name="chevronDown" className="w-3.5 h-3.5" /></span>
        </label>
      </SectionHead>

      {/* Month at a glance */}
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Tile pad="p-5">
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>AI cost this month</p>
          <p className="text-3xl font-bold adm-display tnum mt-1" style={{ color: "var(--ink)" }}>{priced ? ringgit2(grandCost) : "—"}</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>
            {priced ? "Usage times the rates you set" : "Set the rates under AI costs"}
          </p>
        </Tile>
        <Tile pad="p-5">
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>AI actions</p>
          <p className="text-3xl font-bold adm-display tnum mt-1" style={{ color: "var(--ink)" }}>{grandActions.toLocaleString()}</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>{active} of {rows.length} workspaces active</p>
        </Tile>
        <Tile pad="p-5">
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>Cost per action</p>
          <p className="text-3xl font-bold adm-display tnum mt-1" style={{ color: "var(--ink)" }}>
            {priced && grandActions ? ringgit2(grandCost / grandActions) : "—"}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>Blended across all action types</p>
        </Tile>
      </div>

      {/* Where the actions went */}
      <Tile className="mb-4">
        <TileHead title="By action type" right={<span className="text-xs" style={{ color: "var(--ink-3)" }}>{monthLabel(period)}</span>} />
        <div className="grid gap-3 sm:grid-cols-5">
          {AI_KINDS.map((k) => {
            const n = totals[k.key] || 0;
            const share = pct(n, grandActions || 1);
            return (
              <div key={k.key} className="rounded-2xl p-4" style={{ background: "var(--app-bg)" }}>
                <p className="text-xs" style={{ color: "var(--ink-2)" }}>{k.label}</p>
                <p className="text-xl font-bold adm-display tnum mt-1" style={{ color: "var(--ink)" }}>{n.toLocaleString()}</p>
                <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: "#fff" }}>
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: "#A9C0F5" }} />
                </div>
                <p className="text-[11px] mt-1.5 tnum" style={{ color: "var(--ink-3)" }}>
                  {share}%{priced && ` · ${ringgit2((n * (aiCosts[k.key] || 0)) / 100)}`}
                </p>
              </div>
            );
          })}
        </div>
      </Tile>

      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold" style={{ color: "var(--ink-2)" }}>Per workspace</h3>
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: "var(--app-bg)" }}>
          {[{ k: "cost", l: "By cost" }, { k: "actions", l: "By actions" }].map((s) => (
            <button key={s.k} onClick={() => setSort(s.k)} aria-pressed={sort === s.k}
              className="h-8 px-3.5 rounded-full text-xs font-semibold"
              style={{ background: sort === s.k ? "#fff" : "transparent", color: sort === s.k ? "var(--brand)" : "var(--ink-2)" }}>{s.l}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] py-16 text-center" style={{ background: "#fff", border: "1px solid var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>No workspaces to report on.</p>
        </div>
      ) : (
        <TableShell head={["Workspace", "Plan", ...AI_KINDS.map((k) => k.label), "Actions", "Cost"]}>
          {rows.map((u) => (
            <tr key={u.companyId} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
              <Td className="font-semibold text-neutral-900">{u.name}</Td>
              <Td><Badge tone={u.plan === "Enterprise" ? "brand" : "ink"}>{u.plan}</Badge></Td>
              {AI_KINDS.map((k) => (
                <Td key={k.key}><UsageCell used={u[k.key] || 0} allowance={allowanceFor(u.plan, k.key)} /></Td>
              ))}
              <Td className="tnum font-semibold">{u.total.toLocaleString()}</Td>
              <Td>
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#EEF2FB" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct(u.cost, maxCost)}%`, background: "#A9C0F5" }} />
                  </div>
                  <span className="text-xs tnum font-semibold shrink-0" style={{ color: "var(--ink)" }}>{priced ? ringgit2(u.cost) : "—"}</span>
                </div>
              </Td>
            </tr>
          ))}
        </TableShell>
      )}
      <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>
        Each figure is usage against that plan's monthly allowance. A bar can pass its
        allowance because purchased top-up credits are not capped by the plan.
      </p>
      {!priced && (
        <p className="text-xs mt-1.5" style={{ color: "var(--ink-3)" }}>
          Costs read as a dash until an admin sets the per-action rates under AI costs.
          {role === "support" && " Your role can see usage but not edit the rates."}
        </p>
      )}
    </div>
  );
}

// Rates editor. Sen per AI action, so a fraction of a sen per call is expressible.
// Promo codes. Stripe owns them; this is the window onto them, plus the one
// piece Aster owns: which code the site advertises.
//
// Nothing here edits a discount. Stripe will not allow it, and pretending
// otherwise would produce a form whose Save button sometimes lies.
function Promos({ role, companies = [], audit }) {
  const editable = can(role, "creditprice.edit");   // same money-touching roles
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState({ code: "", headline: "", enabled: true, cycles: "yearly" });
  const [bannerSaved, setBannerSaved] = useState(false);
  const [form, setForm] = useState({ code: "", percent_off: "10", duration: "once", expires_at: "", max_redemptions: "", first_time_only: false, company_id: "" });
  const [confirm, setConfirm] = useState(null);   // { kind: "create" | "toggle", ... }

  // supabase.functions.invoke throws away the response body on a non-2xx, so
  // `error.message` is always the same useless "Edge Function returned a
  // non-2xx status code". The real reason, including whatever Stripe said, is
  // on error.context. Read it, or every failure here looks identical.
  const reasonFrom = async (error, data) => {
    if (data?.error) return [data.error, data.detail].filter(Boolean).join(" · ");
    try {
      const body = await error?.context?.json?.();
      if (body?.error) return [body.error, body.detail].filter(Boolean).join(" · ");
    } catch { /* not JSON */ }
    return error?.message || "Something went wrong.";
  };

  const load = async () => {
    setErr("");
    const { data, error } = await supabase.functions.invoke("admin-promos", { body: { action: "list" } });
    if (error || data?.error) { setErr(await reasonFrom(error, data)); setCodes([]); return; }
    setCodes(data.codes || []);
  };
  useEffect(() => {
    if (!hasSupabase) { setCodes([]); return; }
    load();
    supabase.from("promo_banner").select("code, headline, enabled, promo_cycles").maybeSingle().then(({ data }) => {
      if (data) setBanner({ code: data.code || "", headline: data.headline || "", enabled: !!data.enabled, cycles: data.promo_cycles || "yearly" });
    });
  }, []); // eslint-disable-line

  const saveBanner = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_promo_banner", { p_code: banner.code || null, p_headline: banner.headline, p_enabled: banner.enabled, p_cycles: banner.cycles });
    setBusy(false);
    if (error) { setErr(error.message || "Could not save the banner."); return; }
    audit("Set promo banner", `${banner.enabled ? (banner.code || "none") : `${banner.code || "none"} (hidden)`} · codes on ${banner.cycles}`);
    setBannerSaved(true); setTimeout(() => setBannerSaved(false), 2000);
  };

  const doCreate = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("admin-promos", {
      body: {
        action: "create",
        code: form.code, percent_off: Number(form.percent_off), duration: form.duration,
        expires_at: form.expires_at || null,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        first_time_only: form.first_time_only,
        company_id: form.company_id || null,
      },
    });
    setBusy(false);
    if (error || data?.error) { setErr(await reasonFrom(error, data)); setConfirm(null); return; }
    audit("Created promo code", `${data.code} · ${data.percent_off}% off${data.target ? ` · ${data.target} only` : ""}`);
    setForm((f) => ({ ...f, code: "", max_redemptions: "", expires_at: "", company_id: "" }));
    setConfirm(null);
    load();
  };

  const doToggle = async (p) => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("admin-promos", { body: { action: "set_active", id: p.id, active: !p.active } });
    setBusy(false);
    if (error || data?.error) { setErr(await reasonFrom(error, data)); setConfirm(null); return; }
    audit(p.active ? "Switched off promo code" : "Switched on promo code", p.code);
    setConfirm(null);
    load();
  };

  const fmtTs = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
  const expired = (p) => p.expires_at && p.expires_at * 1000 < Date.now();
  const usedUp = (p) => p.max_redemptions && p.times_redeemed >= p.max_redemptions;
  const live = (p) => p.active && !expired(p) && !usedUp(p);

  if (codes === null) return <Card pad="p-6"><p className="text-sm" style={{ color: "var(--ink-3)" }}>Loading promo codes…</p></Card>;

  return (
    <div>
      {/* What the site advertises. Separate from the codes themselves, because
          a code can exist in Stripe without us shouting about it. */}
      <Card pad="p-4 sm:p-5" className="mb-4">
        <TileHead title="Advertised on the site" />
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Code</label>
            <input value={banner.code} onChange={(e) => setBanner((b) => ({ ...b, code: e.target.value.toUpperCase() }))}
              placeholder="none" disabled={!editable}
              className="adm-input h-9 rounded-lg px-3 text-sm w-40 font-mono tracking-wider"
              style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Line above it</label>
            <input value={banner.headline} onChange={(e) => setBanner((b) => ({ ...b, headline: e.target.value }))}
              disabled={!editable}
              className="adm-input h-9 rounded-lg px-3 text-sm w-full"
              style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm h-9" style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={banner.enabled} disabled={!editable}
              onChange={(e) => setBanner((b) => ({ ...b, enabled: e.target.checked }))} />
            Show it
          </label>
          {editable && <ActionBtn icon="check" disabled={busy} onClick={saveBanner}>{bannerSaved ? "Saved" : "Save"}</ActionBtn>}
        </div>
        <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
          Leave the code empty, or untick, and the banner disappears rather than advertising something that fails at checkout.
        </p>

        {/* Which checkouts offer a code box at all. This is the only reliable
            way to keep an offer to one cycle: a Stripe coupon restricts by
            product, and monthly and yearly share the same three, so no coupon
            can tell them apart. */}
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--ink-2)" }}>Where the code box appears</p>
          <div className="inline-flex rounded-xl p-1 gap-1" style={{ background: "var(--app-bg)" }}>
            {[
              { key: "yearly", label: "Yearly only" },
              { key: "both", label: "Monthly and yearly" },
              { key: "none", label: "Off" },
            ].map((o) => {
              const on = banner.cycles === o.key;
              return (
                <button key={o.key} type="button" disabled={!editable} aria-pressed={on}
                  onClick={() => setBanner((b) => ({ ...b, cycles: o.key }))}
                  className="h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
                  style={{ background: on ? "#fff" : "transparent", color: on ? "var(--brand)" : "var(--ink-2)", boxShadow: on ? "0 1px 2px rgba(18,19,42,.10)" : "none" }}>
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--ink-3)" }}>
            {banner.cycles === "yearly"
              ? "Monthly checkout has no promo field, so a yearly offer cannot be used on a monthly plan."
              : banner.cycles === "both"
                ? "A code typed at monthly checkout will apply. Nothing in Stripe can keep a yearly offer off a monthly plan while both share the same products."
                : "No promo field on any checkout. Existing discounts on live subscriptions are unaffected."}
          </p>
        </div>
      </Card>

      {editable && (
        <Card pad="p-4 sm:p-5" className="mb-4">
          <TileHead title="New code" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Code</label>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="WELCOME20"
                className="adm-input h-9 rounded-lg px-3 text-sm w-full font-mono tracking-wider"
                style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Percent off</label>
              <input type="number" min="1" max="100" value={form.percent_off}
                onChange={(e) => setForm((f) => ({ ...f, percent_off: e.target.value }))}
                className="adm-input h-9 rounded-lg px-3 text-sm w-full tnum"
                style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Applies</label>
              <select value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                className="adm-input h-9 rounded-lg px-2 text-sm w-full" style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}>
                <option value="once">To the first payment</option>
                <option value="forever">To every payment</option>
                <option value="repeating">For 12 months</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Expires</label>
              <DatePicker value={form.expires_at} onChange={(v) => setForm((f) => ({ ...f, expires_at: v }))}
                leadDays={0} placeholder="Never" id="promo-expiry" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Max redemptions</label>
              <input type="number" min="1" value={form.max_redemptions} placeholder="Unlimited"
                onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                className="adm-input h-9 rounded-lg px-3 text-sm w-full tnum"
                style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
            </div>
            <div className="xl:col-span-2">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Only for</label>
              <select value={form.company_id} onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                className="adm-input h-9 rounded-lg px-2 text-sm w-full" style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}>
                <option value="">Anyone</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <label className="inline-flex items-center gap-2 text-sm self-end h-9" style={{ color: "var(--ink-2)" }}>
              <input type="checkbox" checked={form.first_time_only}
                onChange={(e) => setForm((f) => ({ ...f, first_time_only: e.target.checked }))} />
              First purchase only
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4">
            <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
              A code string can never be reused, and its discount can never be edited. Getting it wrong means creating another one.
            </p>
            <ActionBtn icon="spark" disabled={busy || !form.code || !form.percent_off}
              onClick={() => setConfirm({ kind: "create" })}>Create code</ActionBtn>
          </div>
        </Card>
      )}

      {err && <p className="text-sm mb-3" style={{ color: "var(--danger)" }}>{err}</p>}

      <TableShell minWidth={900} head={[
        "Code", "Discount", "Status",
        { label: "Used", align: "right" },
        { label: "Expires", align: "right" },
        "Restricted to", editable ? "" : "",
      ]}>
        {codes.map((p) => (
          <tr key={p.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td>
              <span className="font-mono font-bold tracking-wider text-neutral-900">{p.code}</span>
              {/* Stripe lets the same string exist on several promotion codes,
                  archived ones included, and they cannot be deleted. Only the
                  live one can be what a customer actually redeems, so only that
                  one is badged: tagging every row with the string made two
                  identical lines both claim to be the advertised code. */}
              {banner.code && p.code === banner.code && live(p) && (
                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                  style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>ON SITE</span>
              )}
              {/* The id, so two rows sharing a string can be told apart at all. */}
              <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--ink-3)" }}>{String(p.id || "").replace(/^promo_/, "")}</div>
            </Td>
            <Td>
              {/* A bare dash told you nothing about why. Naming the coupon at
                  least says where to look in Stripe. */}
              <span className="tnum font-semibold">
                {p.percent_off != null ? `${p.percent_off}% off`
                  : p.amount_off != null ? `${String(p.coupon_currency || "").toUpperCase()} ${(p.amount_off / 100).toFixed(2)} off`
                  : <span className="font-mono text-xs font-normal" style={{ color: "var(--ink-3)" }}>{p.coupon_id || "no coupon"}</span>}
              </span>
              <div className="text-xs" style={{ color: "var(--ink-3)" }}>
                {p.duration === "forever" ? "every payment" : p.duration === "repeating" ? `${p.duration_in_months} months` : "first payment"}
              </div>
            </Td>
            <Td>
              {live(p) ? <Badge tone="ok" dot>live</Badge>
                : !p.active ? <Badge tone="ink">off</Badge>
                : expired(p) ? <Badge tone="warn">expired</Badge>
                : <Badge tone="warn">used up</Badge>}
            </Td>
            <Td className="text-right tnum">
              {p.times_redeemed}{p.max_redemptions ? <span style={{ color: "var(--ink-3)" }}> / {p.max_redemptions}</span> : ""}
            </Td>
            <Td className="text-right text-sm tnum" style={{ color: expired(p) ? "var(--warn)" : "var(--ink-2)" }}>
              {fmtTs(p.expires_at) || <span style={{ color: "var(--ink-3)" }}>never</span>}
            </Td>
            <Td className="text-sm" style={{ color: "var(--ink-2)" }}>
              {p.customer_name || (p.customer ? "one workspace" : null) || (p.first_time_transaction ? "first purchase only" : <span style={{ color: "var(--ink-3)" }}>anyone</span>)}
            </Td>
            {editable && (
              <Td>
                <div className="flex justify-end">
                  <ActionBtn icon={p.active ? "ban" : "refresh"} tone={p.active ? "danger" : "ink"} disabled={busy}
                    onClick={() => setConfirm({ kind: "toggle", promo: p })}>
                    {p.active ? "Switch off" : "Switch on"}
                  </ActionBtn>
                </div>
              </Td>
            )}
          </tr>
        ))}
        {codes.length === 0 && (
          <tr><td colSpan={7} className="px-5 py-14 text-center">
            <p className="text-sm font-semibold" style={{ color: "var(--ink-2)" }}>No promo codes in Stripe yet</p>
            <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Create one above and it appears here.</p>
          </td></tr>
        )}
      </TableShell>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
          onClick={() => !busy && setConfirm(null)} role="dialog" aria-modal="true" aria-label="Confirm promo change">
          <div className="adm-pop w-full sm:max-w-md rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
            style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: confirm.kind === "create" ? "linear-gradient(135deg,#5570F5,#0B2AE0)" : "linear-gradient(135deg,#F2775A,#DC2626)" }}>
              <h2 className="text-xl font-bold adm-display text-white leading-snug">
                {confirm.kind === "create" ? `Create ${form.code}?` : confirm.promo.active ? `Switch off ${confirm.promo.code}?` : `Switch on ${confirm.promo.code}?`}
              </h2>
              <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,.85)" }}>
                {confirm.kind === "create" ? "This creates a coupon and a code in Stripe." : confirm.promo.active ? "Nobody will be able to redeem it from now on." : "It becomes redeemable again."}
              </p>
            </div>
            <div className="px-6 py-5">
              {confirm.kind === "create" ? (
                <ul className="text-sm space-y-1.5" style={{ color: "var(--ink-2)" }}>
                  {/* Which cycles this can be typed on is a setting now, so the
                      sentence has to read it. Hardcoded "on monthly and yearly"
                      kept telling people that after they had set it to yearly
                      only, which is exactly the sort of confident wrong detail
                      a confirmation dialog must not carry. */}
                  <li>
                    <b style={{ color: "var(--ink)" }}>{form.percent_off}% off</b>{" "}
                    {form.duration === "forever" ? "every payment" : form.duration === "repeating" ? "for 12 months" : "the first payment"}
                    {banner.cycles === "both" ? ", on monthly and yearly."
                      : banner.cycles === "yearly" ? ", on yearly checkout only."
                      : ". No checkout offers a code box right now, so nobody can redeem it until you turn one on."}
                  </li>
                  <li>Expires: <b style={{ color: "var(--ink)" }}>{form.expires_at ? new Date(form.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "never"}</b></li>
                  <li>Redemptions: <b style={{ color: "var(--ink)" }}>{form.max_redemptions || "unlimited"}</b></li>
                  <li>Who: <b style={{ color: "var(--ink)" }}>{form.company_id ? (companies.find((c) => c.id === form.company_id)?.name || "one workspace") : form.first_time_only ? "anyone, first purchase only" : "anyone"}</b></li>
                </ul>
              ) : (
                <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                  {confirm.promo.code} has been redeemed <span className="tnum">{confirm.promo.times_redeemed}</span> {confirm.promo.times_redeemed === 1 ? "time" : "times"}.
                  {confirm.promo.active && banner.code === confirm.promo.code && (
                    <> It is also the code advertised on the site, so clear that above or the banner will point at a dead code.</>
                  )}
                </p>
              )}
              {confirm.kind === "create" && (
                <p className="text-xs mt-4 p-3 rounded-xl" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                  The code string and its discount are permanent once created. Neither can be changed afterwards, only switched off.
                </p>
              )}
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setConfirm(null)} disabled={busy}
                  className="h-10 px-4 rounded-xl text-sm font-semibold" style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink-2)" }}>Cancel</button>
                <button onClick={() => (confirm.kind === "create" ? doCreate() : doToggle(confirm.promo))} disabled={busy}
                  className="h-10 px-4 rounded-xl text-sm font-semibold text-white"
                  style={{ background: confirm.kind === "create" ? "var(--brand)" : "var(--danger)" }}>
                  {busy ? "Working…" : confirm.kind === "create" ? "Create it" : confirm.promo.active ? "Switch it off" : "Switch it on"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The page behind the two money cards on the dashboard. Those cards answer "how
// much"; everything that answers "whose, which, when" lives here, because a
// summary card that grows a list has stopped being a summary.
function Revenue({ revTotals = [], revLoaded, topupTotals = [], topupRows = [], go }) {
  const myrIn = (rows, bucket) => (rows || []).filter((r) => r.bucket === bucket && r.currency === "myr")
    .reduce((s, r) => s + Number(r.amount_cents || 0), 0) / 100;
  const countIn = (rows, bucket, field) => (rows || []).filter((r) => r.bucket === bucket)
    .reduce((s, r) => s + Number(r[field] || 0), 0);

  const WINDOWS = [["This year", "year"], ["This month", "month"], ["Today", "today"]];

  return (
    <div>
      <SectionHead title="Revenue" />

      <div className="grid gap-4 xl:grid-cols-2">
        <Tile pad="p-5">
          <TileHead title="Total revenue"
            right={<span className="text-xs shrink-0" style={{ color: "var(--ink-3)" }}>Subscriptions and top-ups</span>} />
          <div className="grid gap-3 sm:grid-cols-3">
            {WINDOWS.map(([label, b]) => (
              <div key={b}>
                <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{label}</p>
                <p className="text-[26px] font-bold adm-display tnum leading-tight mt-1" style={{ color: "var(--ink)" }}>
                  {revLoaded ? ringgit2(myrIn(revTotals, b)) : "—"}
                </p>
                <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                  {revLoaded ? `${countIn(revTotals, b, "payments")} payments` : "Reading Stripe…"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
            Money in, as charged. Refunds and Stripe fees are not deducted.
          </p>
        </Tile>

        <Tile pad="p-5">
          <TileHead title="Credit top-ups"
            right={<span className="text-xs shrink-0" style={{ color: "var(--ink-3)" }}>Included in the total</span>} />
          <div className="grid gap-3 sm:grid-cols-3">
            {WINDOWS.map(([label, b]) => (
              <div key={b}>
                <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{label}</p>
                <p className="text-[26px] font-bold adm-display tnum leading-tight mt-1" style={{ color: "var(--ink)" }}>
                  {ringgit2(myrIn(topupTotals, b))}
                </p>
                <p className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                  {countIn(topupTotals, b, "purchases")} purchases
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: "var(--ink-3)" }}>
            One-off credit purchases. Subscription payments make up the rest of the total.
          </p>
        </Tile>
      </div>

      <h2 className="text-sm font-bold adm-display mt-6 mb-3" style={{ color: "var(--ink)" }}>Credit purchases</h2>
      <TableShell minWidth={720} head={[
        "Workspace", "Credit",
        { label: "Quantity", align: "right" },
        { label: "Paid", align: "right" },
        { label: "When", align: "right" },
      ]}>
        {topupRows.map((t) => (
          <tr key={t.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td>
              <div className="flex items-center gap-3">
                <Monogram label={t.company_name} size={30} soft />
                <span className="font-semibold text-neutral-900 truncate">{t.company_name}</span>
              </div>
            </Td>
            <Td><Badge tone="ink">{CREDIT_LABEL[t.kind] || t.kind}</Badge></Td>
            <Td className="tnum text-right">{Number(t.quantity).toLocaleString()}</Td>
            <Td className="text-right tnum font-semibold" style={{ color: "var(--ink)" }}>
              {t.currency === "myr"
                ? ringgit2(Number(t.amount_cents || 0) / 100)
                : `${String(t.currency).toUpperCase()} ${(Number(t.amount_cents || 0) / 100).toFixed(2)}`}
            </Td>
            <Td className="text-right">
              <span className="text-sm tnum" style={{ color: "var(--ink-2)" }}>{shortDay(t.created_at)}</span>
              <div className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                {new Date(t.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </Td>
          </tr>
        ))}
        {topupRows.length === 0 && (
          <tr>
            <td colSpan={5} className="px-5 py-14 text-center">
              <span className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: "var(--app-bg)", color: "var(--ink-3)" }}>
                <Icon name="card" className="w-5 h-5" />
              </span>
              <p className="text-sm font-semibold mt-3" style={{ color: "var(--ink-2)" }}>Nobody has bought credits yet</p>
              <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Top-ups appear here the moment one is paid for.</p>
            </td>
          </tr>
        )}
      </TableShell>
    </div>
  );
}

// What we CHARGE for a top-up credit. Deliberately a separate screen from AI
// costs, which is what we PAY: the two are one keystroke apart and a slip
// between them is a pricing incident rather than a wrong report.
//
// The number typed here is a USD base. Nobody is billed that: the buyer pays it
// times the currency rate times their plan discount, which is why every row
// shows what it actually becomes rather than making an admin hold three
// multiplications in their head.
const PLAN_DISCOUNT = [
  { plan: "Launch", mult: 1 },
  { plan: "Scale", mult: 0.9 },
  { plan: "Elite", mult: 0.8 },
];
const CUR_SYM = { usd: "$", myr: "RM", sgd: "S$" };
// The customer-facing name for a credit kind. credit_purchase_log stores the
// database key, and "ai_rank" on a money card reads like a bug.
const CREDIT_LABEL = {
  resume_screen: "Resume screening",
  applicant_screen: "Applicant screening",
  ai_rank: "AI Rank",
  ai_insight: "AI Insight",
  interview_questions: "AI Questions",
};
// "26 Jul" while it is this year, the year added once it stops being obvious.
const shortDay = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
};

function CreditPricing({ role, audit }) {
  const editable = can(role, "creditprice.edit");
  const [rows, setRows] = useState(null);          // [{ kind, price_usd_cents, label }]
  const [rates, setRates] = useState({ usd: 1, myr: 4.09, sgd: 1.29 });
  const [draft, setDraft] = useState({});          // { kind: "1.00" } while typing
  const [confirm, setConfirm] = useState(null);    // { kind, label, from, to }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!hasSupabase) { setRows([]); return; }
    supabase.from("credit_prices").select("kind, price_usd_cents, label").then(({ data }) => {
      if (Array.isArray(data)) setRows([...data].sort((a, b) => b.price_usd_cents - a.price_usd_cents));
    });
    supabase.from("currency_rates").select("currency, rate").then(({ data }) => {
      if (!Array.isArray(data)) return;
      setRates((r) => { const n = { ...r }; data.forEach((x) => { if (Number(x.rate) > 0) n[String(x.currency).toLowerCase()] = Number(x.rate); }); return n; });
    });
  }, []);

  // The buyer's price, derived exactly as buy-credits derives it, rounding the
  // same way. Anything else here would be a preview that lies.
  const charged = (cents, cur, mult) => Math.max(1, Math.round(cents * (rates[cur] || 1) * mult)) / 100;
  const money = (n, cur) => `${CUR_SYM[cur]}${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const askSave = (row) => {
    const raw = draft[row.kind];
    if (raw == null || raw === "") return;
    const to = Math.round(Number(raw) * 100);
    if (!Number.isFinite(to) || to < 0) { setErr("Enter a price of zero or more."); return; }
    if (to === row.price_usd_cents) { setDraft((d) => ({ ...d, [row.kind]: undefined })); return; }
    setErr("");
    setConfirm({ kind: row.kind, label: row.label, from: row.price_usd_cents, to });
  };

  const save = async () => {
    if (!confirm || busy) return;
    setBusy(true); setErr("");
    const { kind, to, from } = confirm;
    if (hasSupabase) {
      const { error } = await supabase.rpc("set_credit_price", { p_kind: kind, p_cents: to });
      if (error) { setErr(error.message || "Could not save that price."); setBusy(false); return; }
    }
    setRows((rs) => rs.map((r) => (r.kind === kind ? { ...r, price_usd_cents: to } : r)));
    setDraft((d) => ({ ...d, [kind]: undefined }));
    audit("Set credit price", `${kind}: $${(from / 100).toFixed(2)} → $${(to / 100).toFixed(2)}`);
    setConfirm(null); setBusy(false);
  };

  if (rows === null) return <Card pad="p-6"><p className="text-sm" style={{ color: "var(--ink-3)" }}>Loading prices…</p></Card>;

  return (
    <div>
      <Card pad="p-4 sm:p-5" className="mb-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "var(--t-mint)", color: "var(--ink)" }}>
            <Icon name="card" className="w-[18px] h-[18px]" />
          </span>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>This is what customers pay</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--ink-2)" }}>
              A saved price applies to the next top-up immediately, with no deploy. AI costs, on the other tab, is what a call costs us and changes nothing a customer sees.
            </p>
          </div>
        </div>
      </Card>

      <TableShell minWidth={860} head={[
        "Credit", { label: "Base (USD)", align: "right" },
        ...PLAN_DISCOUNT.map((p) => ({ label: `${p.plan}${p.mult < 1 ? ` −${Math.round((1 - p.mult) * 100)}%` : ""}`, align: "right" })),
        editable ? "Save" : "",
      ]}>
        {rows.map((r) => {
          const pending = draft[r.kind] != null && draft[r.kind] !== "" && Math.round(Number(draft[r.kind]) * 100) !== r.price_usd_cents;
          const shown = pending ? Math.round(Number(draft[r.kind]) * 100) : r.price_usd_cents;
          return (
            <tr key={r.kind} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
              <Td>
                <p className="font-semibold text-neutral-900">{r.label}</p>
                <p className="text-xs" style={{ color: "var(--ink-3)" }}>{r.kind}</p>
              </Td>
              <Td className="text-right">
                {editable ? (
                  <div className="inline-flex items-center gap-1">
                    <span className="text-sm" style={{ color: "var(--ink-3)" }}>$</span>
                    <input type="number" min="0" step="0.05" inputMode="decimal"
                      aria-label={`Base price for ${r.label} in US dollars`}
                      value={draft[r.kind] ?? (r.price_usd_cents / 100).toFixed(2)}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.kind]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") askSave(r); }}
                      className="adm-input w-24 h-9 rounded-lg px-2 text-sm text-right tnum"
                      style={{ border: `1px solid ${pending ? "var(--brand-0)" : "var(--line)"}`, background: "#fff", color: "var(--ink)" }} />
                  </div>
                ) : (
                  <span className="tnum font-semibold">${(r.price_usd_cents / 100).toFixed(2)}</span>
                )}
              </Td>
              {/* Ringgit is the currency nearly every workspace is billed in, so
                  it leads; the others sit under it rather than in more columns. */}
              {PLAN_DISCOUNT.map((p) => (
                <Td key={p.plan} className="text-right">
                  <div className="tnum font-semibold" style={{ color: pending ? "var(--brand)" : "var(--ink)" }}>
                    {money(charged(shown, "myr", p.mult), "myr")}
                  </div>
                  <div className="text-[11px] tnum" style={{ color: "var(--ink-3)" }}>
                    {money(charged(shown, "usd", p.mult), "usd")} · {money(charged(shown, "sgd", p.mult), "sgd")}
                  </div>
                </Td>
              ))}
              {editable && (
                <Td>
                  <div className="flex justify-end">
                    <ActionBtn icon="check" disabled={!pending || busy} onClick={() => askSave(r)}>Save</ActionBtn>
                  </div>
                </Td>
              )}
            </tr>
          );
        })}
      </TableShell>

      {err && <p className="text-sm mt-3" style={{ color: "var(--danger)" }}>{err}</p>}
      <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>
        Prices are a USD base. The buyer pays that times the currency rate (Currency rates tab) times their plan discount.
        {!editable && " Your role can see pricing but not change it."}
      </p>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }}
          onClick={() => !busy && setConfirm(null)} role="dialog" aria-modal="true" aria-label="Confirm the new price">
          <div className="adm-pop w-full sm:max-w-md rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
            style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg,#5570F5,#0B2AE0)" }}>
              <h2 className="text-xl font-bold adm-display text-white leading-snug">Change this price?</h2>
              <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,.85)" }}>
                Customers pay the new figure on their next top-up.
              </p>
            </div>
            <div className="px-6 py-5">
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            <span className="font-semibold" style={{ color: "var(--ink)" }}>{confirm.label}</span> changes from{" "}
            <span className="tnum">${(confirm.from / 100).toFixed(2)}</span> to{" "}
            <span className="tnum font-semibold" style={{ color: "var(--ink)" }}>${(confirm.to / 100).toFixed(2)}</span> per credit.
            This applies to the next top-up anyone buys.
          </p>
          <div className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--app-bg)" }}>
                  {["Plan", "Now", "After"].map((h, i) => (
                    <th key={h} className={`px-3 py-2 text-[11px] font-semibold ${i ? "text-right" : "text-left"}`}
                      style={{ color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_DISCOUNT.map((p) => {
                  const before = charged(confirm.from, "myr", p.mult);
                  const after = charged(confirm.to, "myr", p.mult);
                  return (
                    <tr key={p.plan} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="px-3 py-2" style={{ color: "var(--ink-2)" }}>{p.plan}</td>
                      <td className="px-3 py-2 text-right tnum" style={{ color: "var(--ink-3)" }}>{money(before, "myr")}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold"
                        style={{ color: after > before ? "var(--ok)" : after < before ? "var(--warn)" : "var(--ink)" }}>
                        {money(after, "myr")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setConfirm(null)} disabled={busy}
              className="h-10 px-4 rounded-xl text-sm font-semibold" style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink-2)" }}>
              Cancel
            </button>
            <button onClick={save} disabled={busy}
              className="h-10 px-4 rounded-xl text-sm font-semibold text-white" style={{ background: "var(--brand)" }}>
              {busy ? "Saving…" : "Change price"}
            </button>
          </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AiCosts({ role, rates, setRates, usage, audit }) {
  const editable = can(role, "aicost.edit");
  // Only what the admin has typed is held in state. Everything else reads
  // straight from `rates`, which arrives after this screen first renders: a
  // copy taken at mount would show zeros forever and let a Save overwrite a
  // real rate with 0.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const loaded = rates != null;
  const shown = (kind) => edits[kind] ?? (loaded ? String(rates[kind] ?? 0) : "");
  const dirty = (kind) => edits[kind] != null && Number(edits[kind]) !== Number(rates?.[kind] ?? 0);

  const monthTotals = AI_KINDS.reduce((m, k) => ({ ...m, [k.key]: usage.reduce((s, u) => s + (u[k.key] || 0), 0) }), {});
  const projected = AI_KINDS.reduce((s, k) => s + (monthTotals[k.key] || 0) * (Number(shown(k.key)) || 0), 0) / 100;

  const save = async (kind) => {
    const v = Number(shown(kind));
    setErr(""); setMsg("");
    if (!Number.isFinite(v) || v < 0) { setErr("Enter a rate of zero or more."); return; }
    setSaving(kind);
    if (hasSupabase) {
      const { error } = await supabase.rpc("set_ai_unit_cost", { p_kind: kind, p_cost_sen: v });
      if (error) { setSaving(""); setErr(error.message || "Could not save."); return; }
    }
    setSaving("");
    setRates((r) => ({ ...(r || {}), [kind]: v }));
    // Drop the edit so the field falls back to the stored rate from here on.
    setEdits((e) => { const next = { ...e }; delete next[kind]; return next; });
    audit("Set AI unit cost", `${kind} = ${v} sen`);
    setMsg("Saved. Every cost figure in the console now uses this rate.");
  };

  return (
    <div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 grid gap-3">
          {AI_KINDS.map((k) => {
            const used = monthTotals[k.key] || 0;
            const changed = dirty(k.key);
            return (
              <Tile key={k.key} pad="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-neutral-900">{k.label}</p>
                      {/* Usage with a zero rate is the usual reason a cost reads
                          RM 0.00, so say so where the rate is set. */}
                      {loaded && used > 0 && !Number(shown(k.key)) && (
                        <Badge tone="warn">rate not set</Badge>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 tnum" style={{ color: "var(--ink-3)" }}>
                      {used.toLocaleString()} this month · <code className="px-1 rounded" style={{ background: "var(--app-bg)" }}>{k.key}</code>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input type="number" step="0.0001" min="0" value={shown(k.key)} disabled={!editable || !loaded}
                        onChange={(e) => setEdits((d) => ({ ...d, [k.key]: e.target.value }))}
                        placeholder={loaded ? "" : "…"}
                        aria-label={`${k.label} cost in sen`}
                        className="w-28 h-10 rounded-xl pl-3 pr-10 text-sm text-right bg-white disabled:opacity-60" style={{ border: "1px solid var(--line-strong)" }} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--ink-3)" }}>sen</span>
                    </div>
                    <button onClick={() => save(k.key)} disabled={!editable || saving === k.key || !changed}
                      className="h-10 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: "var(--brand)" }}>
                      {saving === k.key ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <div className="w-full sm:w-auto text-right tnum" style={{ minWidth: 110 }}>
                    <p className="text-xs" style={{ color: "var(--ink-3)" }}>This month</p>
                    <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{ringgit2((used * (Number(shown(k.key)) || 0)) / 100)}</p>
                  </div>
                </div>
              </Tile>
            );
          })}
          {err && <p className="text-sm" style={{ color: "var(--danger)" }}>{err}</p>}
          {msg && <p className="text-sm" style={{ color: "var(--ok)" }}>{msg}</p>}
          {!editable && <p className="text-xs" style={{ color: "var(--ink-3)" }}>Your role can view these rates but not change them.</p>}
        </div>

        <Tile>
          <TileHead title="This month" />
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>Total AI cost at the rates above</p>
          <p className="text-4xl font-bold adm-display tnum mt-1" style={{ color: "var(--ink)" }}>{ringgit2(projected)}</p>
          <ul className="mt-5 space-y-2.5">
            {AI_KINDS.map((k) => {
              const line = ((monthTotals[k.key] || 0) * (Number(shown(k.key)) || 0)) / 100;
              return (
                <li key={k.key} className="flex items-center justify-between text-sm">
                  <span className="truncate" style={{ color: "var(--ink-2)" }}>{k.label}</span>
                  <span className="tnum shrink-0 ml-2" style={{ color: "var(--ink)" }}>{ringgit2(line)}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] mt-4 pt-4" style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
            Updates live as you type, before you save.
          </p>
        </Tile>
      </div>
    </div>
  );
}
// One ticket as a card. Bodies run to hundreds of words (the marketing chat
// pastes a whole transcript), so the preview is clamped to three lines and
// opens on demand rather than stretching the page.
function TicketCard({ t, company, canReply, onReply, onResolve }) {
  const [open, setOpen] = useState(false);
  const body = (t.note || "").trim();
  const long = body.length > 180;
  const tone = TONE[STATUS_TONE[t.priority] || "ink"];
  return (
    <div className="rounded-[20px] p-4 sm:p-5" style={{ background: "#fff", border: "1px solid var(--line)" }}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-2.5 h-2.5 rounded-full mt-2 shrink-0" style={{ background: tone.fg }} title={`${t.priority} priority`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-neutral-900">{t.subject}</h3>
            <StatusBadge value={t.status} />
            <Badge tone={STATUS_TONE[t.priority]}>{t.priority}</Badge>
          </div>
          <p className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: "var(--ink-3)" }}>
            <span className="tnum font-semibold">{t.id}</span>
            <span aria-hidden="true">·</span><span>{company}</span>
            <span aria-hidden="true">·</span><span>{t.channel}</span>
            <span aria-hidden="true">·</span><span>{t.updated}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {t.email && <ActionBtn icon="mail" disabled={!canReply} onClick={() => onReply(t)}>Reply</ActionBtn>}
          {t.status !== "resolved" && <ActionBtn icon="check" disabled={!canReply} onClick={() => onResolve(t)}>Resolve</ActionBtn>}
        </div>
      </div>

      {body && (
        <div className="mt-3 rounded-2xl px-4 py-3" style={{ background: "var(--app-bg)" }}>
          <p className={`text-sm whitespace-pre-wrap break-words ${open ? "" : "adm-clamp"}`} style={{ color: "var(--ink-2)" }}>{body}</p>
          {long && (
            <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold mt-2" style={{ color: "var(--brand)" }}
              aria-expanded={open}>{open ? "Show less" : "Show full message"}</button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <Monogram label={t.requester} size={26} soft />
        <span className="text-xs min-w-0 truncate" style={{ color: "var(--ink-2)" }}>
          {t.requester}{t.email && <span style={{ color: "var(--ink-3)" }}> · {t.email}</span>}
        </span>
      </div>
    </div>
  );
}

function Support({ role, companies, tickets, onResolve, onReply }) {
  // Real (DB) tickets carry the company name inline; mock rows reference a
  // mock company id, so fall back to a lookup.
  const cName = (t) => t.company || companies.find((c) => c.id === t.companyId)?.name || "—";
  const [replyTo, setReplyTo] = useState(null); // ticket currently being replied to
  const [filter, setFilter] = useState("open");
  const canReply = can(role, "support.resolve");
  const counts = {
    open: tickets.filter((t) => t.status !== "resolved").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    all: tickets.length,
  };
  const rows = tickets.filter((t) => filter === "all" || (filter === "open" ? t.status !== "resolved" : t.status === "resolved"));

  return (
    <div>
      <SectionHead title="Support">
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: "var(--app-bg)" }}>
          {[{ k: "open", l: "Open" }, { k: "resolved", l: "Resolved" }, { k: "all", l: "All" }].map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)} aria-pressed={filter === f.k}
              className="h-9 px-4 rounded-full text-xs font-semibold transition-colors"
              style={{ background: filter === f.k ? "#fff" : "transparent", color: filter === f.k ? "var(--brand)" : "var(--ink-2)", boxShadow: filter === f.k ? "0 1px 2px rgba(18,19,42,.10)" : "none" }}>
              {f.l} <span className="tnum">{counts[f.k]}</span>
            </button>
          ))}
        </div>
      </SectionHead>
      {rows.length === 0 ? (
        <div className="rounded-[20px] py-16 text-center" style={{ background: "#fff", border: "1px solid var(--line)" }}>
          <span className="w-12 h-12 rounded-full inline-flex items-center justify-center" style={{ background: "var(--t-mint)", color: "#166534" }}><Icon name="check" className="w-6 h-6" /></span>
          <p className="text-sm mt-3" style={{ color: "var(--ink-2)" }}>No {filter === "all" ? "" : filter} tickets right now.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((t) => (
            <TicketCard key={t.id} t={t} company={cName(t)} canReply={canReply}
              onReply={setReplyTo} onResolve={onResolve} />
          ))}
        </div>
      )}
      {replyTo && <ReplyComposer ticket={replyTo} cName={cName(replyTo)} onClose={() => setReplyTo(null)} onSend={onReply} />}
    </div>
  );
}

// A small modal for composing an email reply to a ticket's requester.
function ReplyComposer({ ticket, cName, onClose, onSend }) {
  const [message, setMessage] = useState("");
  const [resolve, setResolve] = useState(ticket.status !== "resolved");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    if (!message.trim()) { setErr("Write a reply before sending."); return; }
    setBusy(true); setErr("");
    const res = await onSend(ticket, message.trim(), resolve);
    setBusy(false);
    if (res?.ok) onClose();
    else setErr(res?.error || "Could not send the reply. Try again in a moment.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,27,51,0.45)", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div className="adm-pop w-full sm:max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white overflow-hidden"
        style={{ boxShadow: "0 40px 90px -30px rgba(15,27,51,.5)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 sm:px-7 pt-6 pb-5" style={{ background: "linear-gradient(135deg,#5570F5,#0B2AE0)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold adm-display text-white leading-snug">Reply to {ticket.requester}</h2>
              <p className="text-xs mt-1 truncate" style={{ color: "rgba(255,255,255,.75)" }}>{ticket.id} · {cName} · <span className="tnum">{ticket.email}</span></p>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ color: "#fff", background: "rgba(255,255,255,.18)" }}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 text-xs" style={{ color: "rgba(255,255,255,.9)" }}>{ticket.subject}</div>
        </div>
        <div className="px-6 sm:px-7 py-5">
          <textarea
            autoFocus value={message} onChange={(e) => setMessage(e.target.value)}
            rows={6} placeholder="Write your reply. This is emailed to the requester from support@hireaster.com."
            className="w-full rounded-xl px-3.5 py-3 text-sm text-neutral-900 focus:outline-none focus:ring-2"
            style={{ border: "1px solid var(--line)", background: "#fff", "--tw-ring-color": "var(--brand)" }} />
          <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
            Mark this ticket resolved after sending
          </label>
          {err && <div className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{err}</div>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 sm:px-7 py-4" style={{ background: "var(--app-bg)" }}>
          <button onClick={onClose} disabled={busy} className="h-11 px-5 rounded-xl text-sm font-semibold bg-white" style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>Cancel</button>
          <button onClick={send} disabled={busy} className="h-11 px-5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand)" }}>{busy ? "Sending…" : "Send reply"}</button>
        </div>
      </div>
    </div>
  );
}

function Flags({ role, flags, setFlags, audit, onToggle }) {
  const toggle = onToggle || ((f) => { setFlags((fs) => fs.map((x) => x.key === f.key ? { ...x, enabled: !x.enabled } : x)); audit(f.enabled ? "Disabled feature flag" : "Enabled feature flag", `${f.key} (${f.env})`); });
  return (
    <div>
      <div className="grid gap-3">
        {flags.map((f) => (
          <Card key={f.key} pad="p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-neutral-900">{f.label}</p>
                  <Badge tone={f.env === "prod" ? "ok" : "warn"}>{f.env}</Badge>
                  <span className="text-xs tnum" style={{ color: "var(--ink-3)" }}>· {f.rollout}% rollout</span>
                </div>
                <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{f.desc}</p>
                <code className="text-[11px] mt-1.5 inline-block px-1.5 py-0.5 rounded" style={{ background: "#F3F3F7", color: "var(--ink-3)" }}>{f.key}</code>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge tone={f.enabled ? "ok" : "ink"}>{f.enabled ? "On" : "Off"}</Badge>
                <Toggle on={f.enabled} disabled={!can(role, "flag.toggle")} onClick={() => toggle(f)} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Tier 1 platform email templates — Aster → Company system mail. Bodies are raw
// HTML (an admin edits them here); at send time each is wrapped in Aster's
// branded shell (logo header + footer). Companies never see or edit these.
const PLATFORM_EMAIL_TEMPLATE_DEFS = [
  { key: "company_welcome", name: "Welcome (new company)", desc: "Sent when a new company signs up for Aster.",
    tokens: ["recipient_name", "company_name", "cta_link"],
    subject: "Welcome to Aster, {{company_name}}",
    body: "<p>Hi {{recipient_name}},</p>\n<p>Welcome to Aster. Your workspace for {{company_name}} is ready, post your first role and let Aster read every application for you.</p>\n<p><a href=\"{{cta_link}}\">Open your dashboard</a></p>" },
  { key: "teammate_invite", name: "Teammate invite", desc: "Sent when an owner or admin invites someone to their workspace.",
    tokens: ["inviter_name", "company_name", "role", "cta_link"],
    subject: "{{inviter_name}} invited you to {{company_name}} on Aster",
    body: "<p>Hi there,</p>\n<p>{{inviter_name}} has invited you to join <strong>{{company_name}}</strong> on Aster as {{role}}. Aster is where your team reviews applicants, runs interviews, and keeps every hire moving forward, all in one place.</p>\n<p>Accepting takes about a minute. Set your password and you're in.</p>\n<p style=\"margin:22px 0 6px;\"><a href=\"{{cta_link}}\" style=\"display:inline-block;padding:11px 22px;border-radius:10px;background:#0B2AE0;color:#ffffff;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;\">Accept the invite</a></p>\n<p style=\"font-size:13px;color:#8B8699;\">This invite is just for you and expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>" },
  { key: "trial_ending", name: "Trial ending soon", desc: "Sent a few days before a company's free trial ends.",
    tokens: ["recipient_name", "company_name", "trial_end_date", "cta_link"],
    subject: "Your Aster trial ends {{trial_end_date}}",
    body: "<p>Hi {{recipient_name}},</p>\n<p>Your free trial for {{company_name}} ends on {{trial_end_date}}. Add a plan to keep your jobs live and your candidate pipeline intact.</p>\n<p><a href=\"{{cta_link}}\">Choose a plan</a></p>" },
  { key: "payment_failed", name: "Payment failed", desc: "Sent when a subscription payment is declined.",
    tokens: ["recipient_name", "company_name", "amount", "cta_link"],
    subject: "Action needed: payment failed for {{company_name}}",
    body: "<p>Hi {{recipient_name}},</p>\n<p>We couldn't process your {{amount}} payment for {{company_name}}. Please update your billing details to avoid any interruption.</p>\n<p><a href=\"{{cta_link}}\">Update billing</a></p>" },
  { key: "weekly_digest", name: "Weekly applicant digest", desc: "Weekly roll-up of new applicants. Only sent to active accounts that had activity that week.",
    tokens: ["recipient_name", "company_name", "applicant_count", "job_count", "cta_link"],
    subject: "Your week on Aster: {{applicant_count}} new applicants",
    body: "<p>Hi {{recipient_name}},</p>\n<p>This week {{company_name}} received <strong>{{applicant_count}}</strong> new applicants across {{job_count}} roles.</p>\n<p><a href=\"{{cta_link}}\">Review them in your dashboard</a></p>" },
];
const PLATFORM_TOKEN_SAMPLES = {
  recipient_name: "Alex Tan", company_name: "Oryx Studio", inviter_name: "Shah Ramly",
  role: "Admin", cta_link: "https://hireaster.com/app", trial_end_date: "15 Jul 2026",
  amount: "$49", applicant_count: "12", job_count: "3",
};
const fillPlatformTokens = (text) => (text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => PLATFORM_TOKEN_SAMPLES[k] ?? `{{${k}}}`);

// Toolbar for the template editor. Email clients ignore stylesheets, so every
// tag carries inline styles, and the button matches the one already used in the
// teammate invite rather than inventing a second look.
const HTML_TOOLS = [
  { label: "B",       title: "Bold",       before: "<strong>", after: "</strong>" },
  { label: "I",       title: "Italic",     before: "<em>", after: "</em>" },
  { label: "P",       title: "Paragraph",  before: "<p>", after: "</p>" },
  { label: "H",       title: "Heading",    before: '<h2 style="font-size:18px;margin:18px 0 8px;">', after: "</h2>" },
  { label: "Link",    title: "Link",       before: '<a href="https://hireaster.com">', after: "</a>" },
  { label: "Button",  title: "Call to action button",
    before: '<p style="margin:22px 0 6px;"><a href="{{cta_link}}" style="display:inline-block;padding:11px 22px;border-radius:10px;background:#0B2AE0;color:#ffffff;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">',
    after: "</a></p>" },
  { label: "List",    title: "Bulleted list", before: "<ul>\n  <li>", after: "</li>\n</ul>" },
  { label: "Small",   title: "Fine print",  before: '<p style="font-size:13px;color:#8B8699;">', after: "</p>" },
];

// Currency rates: the FX multiplier per currency (USD = 1) that prices credit
// top-ups (USD base × rate × plan discount). Reads currency_rates, writes via the
// admin-only set_currency_rate RPC. Plan prices are set in Stripe, not here.
function CurrencyRates({ role, audit }) {
  const editable = role === "super" || role === "billing";
  const [rates, setRates] = useState({ usd: 1, myr: 4.09, sgd: 1.29 });
  const [draft, setDraft] = useState({ myr: "4.09", sgd: "1.29" });
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;
    supabase.from("currency_rates").select("currency, rate").then(({ data }) => {
      if (!active || !Array.isArray(data)) return;
      const next = { usd: 1, myr: 4.09, sgd: 1.29 };
      for (const r of data) { const c = String(r.currency || "").toLowerCase(); if (next[c] != null) next[c] = Number(r.rate); }
      setRates(next);
      setDraft({ myr: String(next.myr), sgd: String(next.sgd) });
    });
    return () => { active = false; };
  }, []);

  const saveOne = async (cur) => {
    const v = Number(draft[cur]);
    setErr(""); setMsg("");
    if (!Number.isFinite(v) || v <= 0) { setErr("Enter a rate greater than 0."); return; }
    setSaving(cur);
    if (hasSupabase) {
      const { error } = await supabase.rpc("set_currency_rate", { p_currency: cur, p_rate: v });
      if (error) { setSaving(""); setErr(error.message || "Could not save."); return; }
    }
    setSaving("");
    setRates((r) => ({ ...r, [cur]: v }));
    audit("Set currency rate", `${cur.toUpperCase()} = ${v}`);
    setMsg(`${cur.toUpperCase()} rate saved. New credit purchases price at this rate.`);
  };


  return (
    <div>
      <div className="grid gap-3 max-w-lg">
        {[{ c: "usd", label: "US Dollar", fixed: true }, { c: "myr", label: "Malaysian Ringgit" }, { c: "sgd", label: "Singapore Dollar" }].map(({ c, label, fixed }) => (
          <Card key={c} pad="p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-neutral-900">{label} <span className="text-neutral-400 font-normal">({c.toUpperCase()})</span></p>
                <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>1 USD = {fixed ? "1.00" : Number(rates[c]).toFixed(2)} {c.toUpperCase()}</p>
              </div>
              {fixed ? (
                <span className="text-sm text-neutral-400">Base</span>
              ) : (
                <div className="flex items-center gap-2">
                  <input type="number" step="0.01" min="0" value={draft[c]} disabled={!editable}
                    onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
                    className="w-24 rounded-lg border px-2.5 py-1.5 text-sm text-right bg-white disabled:opacity-60" style={{ borderColor: "var(--line-strong)" }} />
                  <button onClick={() => saveOne(c)} disabled={!editable || saving === c || draft[c] === String(rates[c])}
                    className="text-sm font-semibold px-3.5 py-1.5 rounded-lg text-white grad disabled:opacity-40">{saving === c ? "Saving…" : "Save"}</button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {err && <p className="text-sm mt-3" style={{ color: "#B91C1C" }}>{err}</p>}
      {msg && <p className="text-sm mt-3" style={{ color: "#16A34A" }}>{msg}</p>}
    </div>
  );
}

// Admin editor for the Tier 1 (platform) templates above. Reads any saved
// overrides for the platform scope, writes via the admin-only RPC.
function EmailTemplatesAdmin({ role, audit }) {
  const editable = can(role, "template.edit");
  const [templates, setTemplates] = useState(() => Object.fromEntries(PLATFORM_EMAIL_TEMPLATE_DEFS.map((t) => [t.key, { subject: t.subject, body: t.body }])));
  const [selected, setSelected] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const def = PLATFORM_EMAIL_TEMPLATE_DEFS.find((t) => t.key === selected);

  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;
    supabase.from("email_templates").select("key, subject, body").eq("scope", "platform").then(({ data }) => {
      if (!active || !Array.isArray(data) || !data.length) return;
      setTemplates((prev) => {
        const next = { ...prev };
        for (const r of data) if (next[r.key]) next[r.key] = { subject: r.subject, body: r.body };
        return next;
      });
    });
    return () => { active = false; };
  }, []);

  const openTpl = (key) => { const t = templates[key]; setSelected(key); setSubject(t.subject); setBody(t.body); setMsg(""); setErr(""); };

  // Wrap the selection (or drop a snippet at the caret) and keep the caret where
  // the writer expects it, so the toolbar feels like an editor rather than an
  // append-to-the-end button.
  const bodyRef = useRef(null);
  const wrap = (before, after = "") => {
    const el = bodyRef.current;
    if (!el || !editable) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + before + body.slice(start, end) + after + body.slice(end));
    setMsg("");
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = end + before.length;
    });
  };
  const dirty = def && (subject !== templates[selected].subject || body !== templates[selected].body);

  const save = async () => {
    setErr(""); setMsg("");
    if (hasSupabase) {
      setSaving(true);
      const { error } = await supabase.rpc("set_platform_email_template", { p_key: selected, p_subject: subject, p_body: body });
      setSaving(false);
      if (error) { setErr(error.message || "Could not save."); return; }
    }
    setTemplates((prev) => ({ ...prev, [selected]: { subject, body } }));
    audit("Edited platform email template", selected);
    setMsg("Saved. This wording is used the next time the email sends.");
  };

  const previewDoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;color:#2A2740;font-size:14px;line-height:1.6;padding:14px;margin:0}a{color:#973BF7}</style></head><body>${fillPlatformTokens(body)}</body></html>`;

  if (!selected) {
    return (
      <div>
        <div className="grid gap-3">
          {PLATFORM_EMAIL_TEMPLATE_DEFS.map((t) => (
            <Card key={t.key} pad="p-4 sm:p-5">
              <button onClick={() => openTpl(t.key)} className="w-full text-left flex items-center gap-4">
                <span className="flex-1 min-w-0">
                  <p className="font-semibold text-neutral-900">{t.name}</p>
                  <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{t.desc}</p>
                  <code className="text-[11px] mt-1.5 inline-block px-1.5 py-0.5 rounded" style={{ background: "#F3F3F7", color: "var(--ink-3)" }}>{t.key}</code>
                </span>
                <Icon name="chevronRight" className="w-5 h-5 shrink-0" />
              </button>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setSelected(null)} className="text-sm font-semibold mb-4 inline-flex items-center gap-1" style={{ color: "var(--brand)" }}>← All templates</button>
      <SectionHead title={def.name} />
      {msg && <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>{msg}</div>}
      {err && <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{err}</div>}
      <Card>
        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Subject</label>
        <input value={subject} onChange={(e) => { setSubject(e.target.value); setMsg(""); }} disabled={!editable}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 mb-4 disabled:opacity-60"
          style={{ border: "1px solid var(--line)", background: "#fff", "--tw-ring-color": "var(--brand)" }} />

        {/* Editor left, live preview right. Editing raw HTML blind was the old
            failure mode: you saved, sent a test, then found the markup wrong. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink-3)" }}>Body (HTML)</label>
            <div className="flex flex-wrap gap-1 p-1.5 rounded-t-xl" style={{ background: "var(--app-bg)", border: "1px solid var(--line)", borderBottom: "none" }}>
              {HTML_TOOLS.map((t) => (
                <button key={t.label} onClick={() => wrap(t.before, t.after)} disabled={!editable} title={t.title}
                  className="h-8 min-w-8 px-2 rounded-lg text-xs font-semibold bg-white disabled:opacity-40 transition-colors hover:bg-neutral-100"
                  style={{ border: "1px solid var(--line)", color: "var(--ink-2)", fontStyle: t.label === "I" ? "italic" : undefined, fontWeight: t.label === "B" ? 800 : 600 }}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea ref={bodyRef} value={body} onChange={(e) => { setBody(e.target.value); setMsg(""); }} rows={16} disabled={!editable}
              spellCheck={false}
              className="w-full rounded-b-xl px-3.5 py-3 text-[13px] text-neutral-900 focus:outline-none font-mono leading-relaxed resize-y disabled:opacity-60"
              style={{ border: "1px solid var(--line)", background: "#fff" }} />
            <div className="mt-3">
              <p className="text-[11px] mb-1.5" style={{ color: "var(--ink-3)" }}>Placeholders, inserted where the cursor is:</p>
              <div className="flex flex-wrap gap-1.5">
                {(def.tokens || []).map((tok) => (
                  <button key={tok} onClick={() => wrap(`{{${tok}}}`)} disabled={!editable}
                    className="text-[11px] font-mono rounded-full px-2 py-0.5 disabled:opacity-50" style={{ border: "1px solid var(--line-strong)", color: "var(--brand)", background: "var(--brand-soft)" }}>
                    {`{{${tok}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink-3)" }}>Live preview</label>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
              <p className="text-xs px-3 py-2 truncate" style={{ background: "var(--app-bg)", color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>
                Subject: <span className="font-semibold text-neutral-800">{fillPlatformTokens(subject)}</span>
              </p>
              <iframe title="Email preview" sandbox="" srcDoc={previewDoc} className="w-full" style={{ height: 420, border: 0, background: "#fff" }} />
            </div>
            <p className="text-[11px] mt-2" style={{ color: "var(--ink-3)" }}>
              Placeholders show sample values here. Aster's logo header and footer are added around this body when it sends.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button onClick={save} disabled={!editable || !dirty || saving} className="text-sm font-semibold px-4 py-2 rounded-lg text-white grad disabled:opacity-40">{saving ? "Saving…" : "Save template"}</button>
          {dirty && !saving && <button onClick={() => openTpl(selected)} className="text-sm font-semibold px-3.5 py-2 rounded-lg" style={{ border: "1px solid var(--line)", color: "var(--ink-2)", background: "#fff" }}>Reset</button>}
        </div>
        {!editable && <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>Your role can view but not edit these templates.</p>}
      </Card>
    </div>
  );
}

function Audit({ audit }) {
  return (
    <div>
      
      {audit.length === 0 ? (
        <div className="rounded-[20px] py-16 text-center" style={{ background: "#fff", border: "1px solid var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>No admin actions recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(collapseAudit(audit).reduce((groups, a) => {
            const k = dayBucket(a.when);
            (groups[k] = groups[k] || []).push(a);
            return groups;
          }, {})).map(([day, rows]) => (
            <section key={day}>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--ink-3)" }}>{day}</h3>
              <div className="rounded-[20px] overflow-hidden" style={{ background: "#fff", border: "1px solid var(--line)" }}>
                {rows.map((a, i) => (
                  <div key={a.id} className="adm-row flex items-start gap-3 px-4 sm:px-5 py-3.5"
                    style={i ? { borderTop: "1px solid var(--line)" } : undefined}>
                    <span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: auditTone(a.action) }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                        {auditText(a.action)}
                        {a.target && <><span style={{ color: "var(--ink-3)" }}> · </span><span className="font-semibold text-neutral-900">{a.target}</span></>}
                        {a.count > 1 && <span className="tnum text-[11px] font-bold ml-1.5 px-1.5 py-0.5 rounded-full" style={{ background: "var(--app-bg)", color: "var(--ink-3)" }}>×{a.count}</span>}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-3)" }}>
                        {a.actor !== "—" ? a.actor : "System"}
                        {a.role && <> · {ROLE_META[a.role]?.short || a.role}</>}
                      </p>
                    </div>
                    <span className="text-xs tnum shrink-0" style={{ color: "var(--ink-3)" }} title={a.when || ""}>{a.at}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
// Looks up the admin_users row for a signed-in auth user and returns the
// admin object, or null if they are not an active Aster admin.
async function fetchAdmin(userId, fallbackEmail) {
  const { data, error } = await supabase
    .from("admin_users").select("id, full_name, email, role, status").eq("id", userId).maybeSingle();
  if (error || !data || data.status !== "active") return null;
  return { id: data.id, name: data.full_name || fallbackEmail, email: data.email || fallbackEmail, role: data.role };
}

function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setErr("");
    if (!hasSupabase) { onLogin(ADMIN_ACCOUNTS[0]); return; } // mock preview
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setErr(error.message); setBusy(false); return; }
    const admin = await fetchAdmin(data.user.id, data.user.email);
    if (!admin) { await supabase.auth.signOut(); setErr("This account is not an active Aster admin."); setBusy(false); return; }
    onLogin(admin);
  };

  return (
    <div className="adm min-h-screen flex items-center justify-center px-4" style={{ background: "radial-gradient(60% 60% at 50% 0%, #EAEEFE 0%, #FAFAFB 60%)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2 mb-4">
            <img src="/aster-logo.png" alt="Aster" className="h-6 w-auto object-contain" />
            <span className="text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>Admin</span>
          </div>
        </div>
        <div className="rounded-2xl p-6 sm:p-7" style={{ background: "#fff", border: "1px solid var(--line)", boxShadow: "0 30px 80px -30px rgba(0,0,0,0.7)" }}>
          <h1 className="text-xl font-bold adm-display text-neutral-900">Sign in to the admin console</h1>
          <p className="text-sm mt-1 mb-5" style={{ color: "var(--ink-2)" }}>Admin accounts are separate from customer logins.</p>
          <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@hireaster.com" className="w-full px-3.5 py-2.5 rounded-xl text-sm" style={{ border: "1px solid var(--line)" }} />
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="current-password" placeholder="Password" className="w-full px-3.5 py-2.5 rounded-xl text-sm" style={{ border: "1px solid var(--line)" }} />
            {err && <p className="text-sm flex items-center gap-1.5" style={{ color: "var(--danger)" }}><Icon name="warning" className="w-4 h-4" /> {err}</p>}
            <button type="submit" disabled={busy} className="w-full grad text-white font-semibold py-2.5 rounded-xl disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          {!hasSupabase && (
            <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--line)" }}>
              <p className="text-[11px] font-semibold uppercase mb-2.5" style={{ color: "var(--ink-3)", letterSpacing: "0.06em" }}>Demo · sign in as a role</p>
              <div className="grid gap-2">
                {ADMIN_ACCOUNTS.map((a) => (
                  <button key={a.id} onClick={() => onLogin(a)} className="flex items-center gap-3 text-left rounded-xl px-3 py-2.5 transition-colors hover:bg-[color:var(--brand-soft)]" style={{ border: "1px solid var(--line)" }}>
                    <span className="w-8 h-8 rounded-lg grad text-white text-xs font-bold inline-flex items-center justify-center shrink-0">{a.name.split(" ").map((x) => x[0]).join("")}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900">{a.name}</span><span className="block text-xs" style={{ color: "var(--ink-3)" }}>{a.email}</span></span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: TONE[a.role === "super" ? "brand" : a.role === "billing" ? "ok" : "info"].bg, color: TONE[a.role === "super" ? "brand" : a.role === "billing" ? "ok" : "info"].fg }}>{ROLE_META[a.role].label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs mt-5" style={{ color: "var(--adm-ink-2)" }}>Not an Aster employee? <a href="/" className="underline">Go to the main site</a>.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell + root
// ---------------------------------------------------------------------------
// A dropdown that closes on outside click and on Escape. Every popover in the
// top bar uses it, so they all dismiss the same way.
function Popover({ open, onClose, align = "right", width = 300, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`adm-pop absolute z-50 top-[calc(100%+8px)] ${align === "right" ? "right-0" : "left-0"} rounded-2xl overflow-hidden`}
        style={{ width, background: "#fff", border: "1px solid var(--line)", boxShadow: "0 24px 60px -20px rgba(18,19,42,.35)" }}>
        {children}
      </div>
    </>
  );
}
// Bell: the same live signals the dashboard's attention cards use.
function AdminAlerts({ companies, tickets, role, go }) {
  const [open, setOpen] = useState(false);
  const items = [
    ...companies.filter((c) => c.status === "suspended").map((c) => ({ id: "s" + c.id, label: c.name, note: "Workspace suspended", color: "var(--c-risk)", to: "companies" })),
    ...tickets.filter((t) => t.status === "open").map((t) => ({ id: "t" + t.id, label: t.company || t.subject, note: `${t.priority} priority · ${t.subject}`, color: t.priority === "urgent" ? "var(--c-risk)" : "#1D4ED8", to: "support" })),
  ];
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label={`Alerts, ${items.length} open`} aria-expanded={open}
        className="w-11 h-11 rounded-full grid place-items-center">
        {/* Same 34px circle as the avatar beside it, so the two read as a pair. */}
        <span className="w-[34px] h-[34px] rounded-full grid place-items-center relative transition-colors"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          <Icon name="bell" className="w-4 h-4" />
          {items.length > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white inline-flex items-center justify-center tnum" style={{ background: "var(--c-risk)", border: "2px solid #fff" }}>{items.length > 9 ? "9+" : items.length}</span>}
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={320}>
        <p className="text-xs font-bold uppercase tracking-wide px-4 pt-3.5 pb-2" style={{ color: "var(--ink-3)" }}>Alerts</p>
        <div className="max-h-[320px] overflow-y-auto pb-2">
          {items.length === 0
            ? <p className="text-sm px-4 py-3" style={{ color: "var(--ink-3)" }}>Nothing needs attention.</p>
            : items.slice(0, 8).map((i) => (
              <button key={i.id} onClick={() => { setOpen(false); go(i.to); }} disabled={!sectionAllowed(role, i.to)}
                className="adm-row w-full flex items-start gap-2.5 px-4 py-2.5 text-left disabled:opacity-50">
                <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: i.color }} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900 truncate">{i.label}</span>
                  <span className="block text-xs truncate" style={{ color: "var(--ink-3)" }}>{i.note}</span>
                </span>
              </button>
            ))}
        </div>
      </Popover>
    </div>
  );
}


// Settings groups the four configuration screens. Each tab carries the role
// list its own nav entry used to have: moving them must not widen access.
const WORKSPACE_TABS = [
  { key: "companies",     label: "Companies",       roles: ["super", "support", "billing"] },
  { key: "users",         label: "User management", roles: ["super", "support"] },
  { key: "subscriptions", label: "Subscriptions",   roles: ["super", "billing"] },
  { key: "margin",        label: "Margin",          roles: ["super", "billing"] },
];

function Workspaces({ role, children, tab, setTab }) {
  const allowed = WORKSPACE_TABS.filter((t) => t.roles.includes(role));
  return (
    <div>
      <SectionHead title="Workspaces">
        <div className="flex items-center gap-1 p-1 rounded-full overflow-x-auto" style={{ background: "var(--app-bg)" }}>
          {allowed.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className="h-9 px-4 rounded-full text-xs font-semibold whitespace-nowrap"
              style={{ background: tab === t.key ? "#fff" : "transparent", color: tab === t.key ? "var(--brand)" : "var(--ink-2)" }}>{t.label}</button>
          ))}
        </div>
      </SectionHead>
      {allowed.length === 0 ? <NoAccess role={role} /> : children}
    </div>
  );
}


function Settings({ role, children, tab, setTab }) {
  const allowed = SETTINGS_TABS.filter((t) => t.roles.includes(role));
  return (
    <div>
      <SectionHead title="Settings">
        <div className="flex items-center gap-1 p-1 rounded-full overflow-x-auto" style={{ background: "var(--app-bg)" }}>
          {allowed.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className="h-9 px-4 rounded-full text-xs font-semibold whitespace-nowrap"
              style={{ background: tab === t.key ? "#fff" : "transparent", color: tab === t.key ? "var(--brand)" : "var(--ink-2)" }}>{t.label}</button>
          ))}
        </div>
      </SectionHead>
      {allowed.length === 0 ? <NoAccess role={role} /> : children}
    </div>
  );
}

function AdminShell({ admin, section, go, onLogout, companies, tickets, children }) {
  const rm = ROLE_META[admin.role];
  const nav = SECTIONS.filter((s) => s.roles.includes(admin.role));
  // Five tabs read comfortably on a laptop; the rest live behind More, which
  // also carries the active item when it is one of them.
  const primary = nav.slice(0, 5);
  const overflow = nav.slice(5);
  const [moreOpen, setMoreOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const overflowActive = overflow.some((s) => s.key === section);

  const Tab = ({ s }) => {
    const on = s.key === section;
    return (
      <button key={s.key} onClick={() => go(s.key)} aria-current={on ? "page" : undefined}
        className="adm-tab h-11 px-4 rounded-full text-sm font-semibold whitespace-nowrap inline-flex items-center gap-2"
        style={{ background: on ? "var(--brand-soft)" : "transparent", color: on ? "var(--brand)" : "var(--ink-2)" }}>
        <Icon name={s.icon} className="w-4 h-4 sm:hidden" /><span>{s.label}</span>
      </button>
    );
  };

  return (
    <div className="adm adm-page min-h-screen p-0 sm:p-4 lg:p-6">
      <div className="mx-auto w-full max-w-[1480px] rounded-none sm:rounded-[32px] p-3 sm:p-5"
        style={{ background: "#fff", boxShadow: "0 24px 70px -40px rgba(11,42,224,.35)" }}>

        {/* Top bar */}
        <header className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 shrink-0 pl-1 pr-1 sm:pr-3">
            <img src="/aster-logo.png" alt="Aster" className="h-5 sm:h-6 w-auto object-contain" />
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>Admin</span>
          </div>

          {/* The tab strip scrolls, but More sits outside that scroll box so its
              dropdown is not clipped by the overflow. */}
          <nav aria-label="Admin sections" className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
              {primary.map((s) => <Tab key={s.key} s={s} />)}
            </div>
            {overflow.length > 0 && (
              <div className="relative shrink-0">
                <button onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}
                  className="adm-tab h-11 px-4 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  style={{ background: overflowActive ? "var(--brand-soft)" : "transparent", color: overflowActive ? "var(--brand)" : "var(--ink-2)" }}>
                  {overflowActive ? SECTIONS.find((s) => s.key === section)?.label : "More"}
                  <Icon name="chevronDown" className="w-3.5 h-3.5" />
                </button>
                <Popover open={moreOpen} onClose={() => setMoreOpen(false)} align="left" width={230}>
                  {overflow.map((s) => (
                    <button key={s.key} onClick={() => { setMoreOpen(false); go(s.key); }}
                      className="adm-row w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium"
                      style={{ color: s.key === section ? "var(--brand)" : "var(--ink-2)" }}>
                      <Icon name={s.icon} className="w-4 h-4 shrink-0" /> {s.label}
                    </button>
                  ))}
                </Popover>
              </div>
            )}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <AdminAlerts companies={companies} tickets={tickets} role={admin.role} go={go} />
            <div className="relative">
              {/* Avatar only: the name and email live inside the menu, not on screen. */}
              <button onClick={() => setMeOpen((v) => !v)} aria-expanded={meOpen} aria-label="Account menu"
                className="w-11 h-11 rounded-full grid place-items-center transition-colors hover:bg-neutral-100">
                <Monogram label={admin.name} size={34} soft ring={false} />
              </button>
              <Popover open={meOpen} onClose={() => setMeOpen(false)} width={250}>
                <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
                  <p className="text-sm font-bold text-neutral-900 truncate">{admin.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--ink-3)" }}>{admin.email}</p>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-2" style={{ background: "var(--brand-soft)", color: rm.tint }}>
                    <Icon name="shield" className="w-3 h-3" /> {rm.label}
                  </span>
                  <p className="text-[11px] mt-2" style={{ color: "var(--ink-3)" }}>{rm.blurb}</p>
                </div>
                <button onClick={onLogout} className="adm-row w-full flex items-center gap-2.5 px-4 py-3 text-sm font-semibold" style={{ color: "var(--danger)" }}>
                  <Icon name="logout" className="w-4 h-4" /> Sign out
                </button>
              </Popover>
            </div>
          </div>
        </header>

        {/* Content. There is no refresh button: the console polls for itself. */}
        <main className="rounded-[24px] p-3 sm:p-4 mt-4" style={{ background: "var(--app-bg)" }}>{children}</main>
      </div>
    </div>
  );
}

// Turn an ISO timestamp into a compact "12m ago" style string for the table.
function relTime(iso) {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return Math.floor(secs / 60) + "m ago";
  if (secs < 86400) return Math.floor(secs / 3600) + "h ago";
  return Math.floor(secs / 86400) + "d ago";
}

// Map a support_tickets row (with embedded company + requester) to the shape
// the Support table renders. Real rows carry the company name inline.
function mapTicketRow(r) {
  return {
    id: r.id,
    companyId: r.company_id,
    // Public help-center tickets have no company; account tickets carry one.
    company: r.companies?.name || (r.company_id ? "—" : "Public"),
    subject: r.subject,
    // Public tickets carry a free-text name/email; account tickets a profile.
    requester: r.requester_name || r.requester?.full_name || "—",
    email: r.requester_email || null,
    channel: r.channel || "—",
    priority: r.priority,
    status: r.status,
    updated: relTime(r.updated_at || r.created_at),
    note: r.body || "",
  };
}

// DB plan_tier -> the label the admin tables render, and back.
const ADMIN_PLAN_LABEL = { launch: "Launch", scale: "Scale", elite: "Elite", enterprise: "Enterprise" };

// Requested 1:1 calls, grouped by day so the next few days read as a schedule
// rather than a list. Two people asking for the same slot is flagged, because
// nothing stops them both requesting it.
const BOOKING_TONE = { requested: "warn", confirmed: "ok", done: "ink", cancelled: "danger" };

function Bookings({ role, bookings, onStatus, blocked, setBlocked, audit }) {
  const [view, setView] = useState("requests");
  const [show, setShow] = useState("upcoming");
  const [busy, setBusy] = useState(null);
  const allowed = can(role, "booking.manage");
  const todayKey = new Date().toISOString().slice(0, 10);

  const rows = bookings.filter((b) =>
    show === "all" ? true
      : show === "upcoming" ? b.day >= todayKey && b.status !== "cancelled"
        : b.day < todayKey || b.status === "cancelled");

  // Same day + same slot, still live: you cannot be in two calls at once.
  const clashes = new Set();
  const seen = new Map();
  for (const b of bookings.filter((x) => x.status === "requested" || x.status === "confirmed")) {
    const k = `${b.day}|${b.slot}`;
    if (seen.has(k)) { clashes.add(b.id); clashes.add(seen.get(k)); } else seen.set(k, b.id);
  }

  const byDay = rows.reduce((m, b) => { (m[b.day] = m[b.day] || []).push(b); return m; }, {});
  const days = Object.keys(byDay).sort((a, b) => (show === "past" ? b.localeCompare(a) : a.localeCompare(b)));
  const fmtDay = (d) => {
    const dt = new Date(d + "T00:00:00");
    const label = dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return d === todayKey ? `Today, ${label}` : label;
  };

  const move = async (b, status) => {
    setBusy(b.id);
    await onStatus(b, status);
    setBusy(null);
  };

  return (
    <div>
      <SectionHead title="Bookings" left={
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: "var(--app-bg)" }}>
          {[{ k: "requests", l: "Requests" }, { k: "blocked", l: "Blocked dates" }].map((v) => (
            <button key={v.k} onClick={() => setView(v.k)} aria-pressed={view === v.k}
              className="h-9 px-4 rounded-full text-xs font-semibold"
              style={{ background: view === v.k ? "#fff" : "transparent", color: view === v.k ? "var(--brand)" : "var(--ink-2)" }}>{v.l}</button>
          ))}
        </div>
      }>
        <div className={view === "requests" ? "flex items-center gap-1 p-1 rounded-full" : "hidden"} style={{ background: "var(--app-bg)" }}>
          {[{ k: "upcoming", l: "Upcoming" }, { k: "past", l: "Past" }, { k: "all", l: "All" }].map((f) => (
            <button key={f.k} onClick={() => setShow(f.k)} aria-pressed={show === f.k}
              className="h-9 px-4 rounded-full text-xs font-semibold"
              style={{ background: show === f.k ? "#fff" : "transparent", color: show === f.k ? "var(--brand)" : "var(--ink-2)" }}>{f.l}</button>
          ))}
        </div>
      </SectionHead>

      {view === "blocked" ? (
        <BookingDates role={role} blocked={blocked} setBlocked={setBlocked} audit={audit} />
      ) : days.length === 0 ? (
        <div className="rounded-[20px] py-16 text-center" style={{ background: "#fff", border: "1px solid var(--line)" }}>
          <span className="w-12 h-12 rounded-full inline-flex items-center justify-center" style={{ background: "var(--t-blue)", color: "var(--brand)" }}><Icon name="calendar" className="w-6 h-6" /></span>
          <p className="text-sm mt-3" style={{ color: "var(--ink-2)" }}>No {show === "all" ? "" : show} bookings.</p>
          <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Requests from /contact-sales land here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day}>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--ink-3)" }}>
                {fmtDay(day)} <span className="tnum font-semibold" style={{ color: "var(--ink-2)" }}>· {byDay[day].length}</span>
              </h3>
              <div className="grid gap-2">
                {byDay[day].sort((a, b) => a.slot.localeCompare(b.slot)).map((b) => (
                  <div key={b.id} className="rounded-[20px] p-4 sm:p-5" style={{ background: "#fff", border: `1px solid ${clashes.has(b.id) ? "var(--warn)" : "var(--line)"}` }}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="rounded-xl px-3 py-2 text-sm font-bold tnum shrink-0" style={{ background: "var(--app-bg)", color: "var(--ink)" }}>{b.slot}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-neutral-900">{b.name}</p>
                          <Badge tone={BOOKING_TONE[b.status] || "ink"} dot>{b.status}</Badge>
                          {clashes.has(b.id) && <Badge tone="warn">double booked</Badge>}
                        </div>
                        <p className="text-xs mt-0.5 tnum" style={{ color: "var(--ink-3)" }}>
                          {b.email}{b.phone && ` · ${b.phone}`}{b.company && ` · ${b.company}`}
                        </p>
                        {b.message && (
                          <p className="text-sm mt-2 rounded-xl px-3 py-2" style={{ background: "var(--app-bg)", color: "var(--ink-2)" }}>{b.message}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {b.status !== "confirmed" && b.status !== "done" && (
                          <ActionBtn icon="check" disabled={!allowed || busy === b.id} onClick={() => move(b, "confirmed")}>Confirm</ActionBtn>
                        )}
                        {b.status === "confirmed" && (
                          <ActionBtn icon="check" disabled={!allowed || busy === b.id} onClick={() => move(b, "done")}>Mark done</ActionBtn>
                        )}
                        {b.status !== "cancelled" && (
                          <ActionBtn icon="close" tone="danger" disabled={!allowed || busy === b.id} onClick={() => move(b, "cancelled")}>Cancel</ActionBtn>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
// Blocked dates for the public "book a 1:1" calendar (/contact-sales). Admin adds
// a date (holiday, off-site); the marketing page reads booking_blocked_dates and
// greys it out. Writes go through the admin-gated RPCs (migration 0065).
function BookingDates({ role, blocked, setBlocked, audit }) {
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const allowed = can(role, "booking.block");
  const inputCls = "rounded-lg border px-3 py-2 text-sm outline-none";
  const fmt = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };

  const add = async () => {
    if (!day || busy) return;
    setErr(""); setBusy(true);
    if (hasSupabase) {
      const { error } = await supabase.rpc("add_booking_blocked_date", { p_day: day, p_reason: reason || null });
      if (error) { setErr(error.message || "Could not block that date."); setBusy(false); return; }
    }
    setBlocked((b) => [...b.filter((x) => x.day !== day), { day, reason: reason.trim() || null }].sort((a, c) => a.day.localeCompare(c.day)));
    audit("Blocked booking date", reason.trim() ? `${day} (${reason.trim()})` : day);
    setDay(""); setReason(""); setBusy(false);
  };
  const remove = async (d) => {
    if (busy) return;
    setErr(""); setBusy(true);
    if (hasSupabase) {
      const { error } = await supabase.rpc("remove_booking_blocked_date", { p_day: d });
      if (error) { setErr(error.message || "Could not unblock that date."); setBusy(false); return; }
    }
    setBlocked((b) => b.filter((x) => x.day !== d));
    audit("Unblocked booking date", d);
    setBusy(false);
  };

  return (
    <div>
      {allowed && (
        <Card pad="p-4 sm:p-5" className="mb-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div>
              <label htmlFor="date-to-block" className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Date to block</label>
              <DatePicker value={day} onChange={setDay} blockedDays={blocked.map((b) => b.day)} leadDays={3} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Public holiday" className={inputCls + " w-full"} style={{ border: "1px solid var(--line)", color: "var(--ink)" }} />
            </div>
            <ActionBtn icon="ban" onClick={add} disabled={!day || busy}>Block date</ActionBtn>
          </div>
          {err && <p className="text-sm mt-2" style={{ color: "#B42318" }}>{err}</p>}
        </Card>
      )}
      {blocked.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-3)" }}>No dates are blocked. The booking calendar is open, minus weekends and the 3-day lead time.</p>
      ) : (
        <div className="grid gap-2">
          {blocked.map((b) => (
            <Card key={b.day} pad="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <span style={{ color: "var(--brand)" }}><Icon name="calendar" className="w-4 h-4" /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-neutral-900 text-sm">{fmt(b.day)}</p>
                  {b.reason && <p className="text-xs" style={{ color: "var(--ink-3)" }}>{b.reason}</p>}
                </div>
                {allowed && <ActionBtn icon="close" onClick={() => remove(b.day)} disabled={busy}>Unblock</ActionBtn>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminPortal() {
  const [admin, setAdmin] = useState(null);
  const initial = typeof window !== "undefined" ? (window.location.pathname.replace(/^\/admin\/?/, "") || "dashboard") : "dashboard";
  const [section, setSection] = useState(SECTIONS.some((s) => s.key === initial) ? initial : "dashboard");

  // Live, mutable state so actions feel real and feed the audit log.
  const [companies, setCompanies] = useState([]);
  const [subs, setSubs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [flags, setFlags] = useState(INIT_FLAGS);
  const [bookings, setBookings] = useState([]);   // sales_bookings (0160)
  const [blocked, setBlocked] = useState([]); // booking_blocked_dates: [{ day, reason }]
  const [audit, setAudit] = useState([]);
  // AI usage per workspace for the selected month, and the sen-per-action rates
  // it is costed at. Both are admin-only reads.
  const [usage, setUsage] = useState([]);
  const [aiCosts, setAiCosts] = useState(null);
  const [topups, setTopups] = useState([]);   // credit_purchase_log, this month
  const [revTotals, setRevTotals] = useState([]); // Stripe charges, today/month/year
  const [revLoaded, setRevLoaded] = useState(false);
  const [topupTotals, setTopupTotals] = useState([]); // credit_purchase_log, same windows
  const [recentTopups, setRecentTopups] = useState([]); // the purchases behind that total
  const [activity, setActivity] = useState([]);   // last sign-in per workspace (0162)
  const [settingsTab, setSettingsTab] = useState("rates");
  const [wsTab, setWsTab] = useState("companies");
  const [period, setPeriod] = useState(() => recentPeriods(1)[0]);
  const [restoring, setRestoring] = useState(hasSupabase);

  useEffect(() => {
    // Clear index.html's pre-boot splash. It sets data-app-booting when a session
    // token is on disk, and only the customer app removed it, so a logged-in admin
    // hitting /admin sat on the spinner forever. The admin has its own "Loading…"
    // state, so hand off to that.
    try { document.documentElement.removeAttribute("data-app-booting"); } catch { /* noop */ }
    const el = document.createElement("style");
    el.textContent = ADMIN_STYLES;
    document.head.appendChild(el);
    document.title = "Aster Admin: Internal Console";
    return () => el.remove();
  }, []);

  // Restore an existing Supabase session on load (persistent login), and sign
  // the user out locally if the session ends.
  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (active && data.session) {
        const a = await fetchAdmin(data.session.user.id, data.session.user.email);
        if (active && a) setAdmin(a);
      }
      if (active) setRestoring(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { if (!session) setAdmin(null); });
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  // Replace the seed rows with real data once an admin is authenticated. Each
  // RPC is is_admin()-gated server-side, so a non-admin session simply gets
  // nothing back rather than the mock set.
  const [users, setUsers] = useState([]);
  const reloadAdminData = async () => {
    if (!hasSupabase) return;
    const [{ data: co }, { data: us }] = await Promise.all([
      supabase.rpc("admin_company_detail"),
      supabase.rpc("admin_list_users"),
    ]);
    if (Array.isArray(co)) {
      setCompanies(co.map((c) => ({
        id: c.id, name: c.name,
        // Owner name + email, or nothing at all rather than a dangling "Owner:".
        owner: [c.owner_name, c.owner_email].filter(Boolean).join(" · "),
        plan: ADMIN_PLAN_LABEL[c.plan] || c.plan,
        status: c.status, seats: Number(c.user_count) || 0,
        cycle: c.cycle || "monthly",   // drives the monthly share of a yearly plan
        subStatus: c.sub_status || null,   // paying is a subscription fact, not a company one
        activeJobs: Number(c.active_jobs) || 0, candidates: Number(c.candidate_count) || 0,
        compedAt: c.comped_at || null, compedNote: c.comped_note || null,
        interviews: Number(c.interview_count) || 0, hired: Number(c.hired_count) || 0,
        upcoming: Number(c.upcoming_interviews) || 0,
        // The RPC has always returned this; nothing read it until the overview
        // needed to say how many workspaces have stayed a year.
        createdAt: c.created_at || null,
        // From the billing address (0165), not companies.region, which is free
        // text nobody has ever written to.
        country: c.address_country || null,
        // Whether this workspace's open roles go out in the public job-site
        // feed (0172). Opt-in, so a pilot customer can be switched on here
        // without waiting for them to find the setting themselves.
        feedEnabled: !!c.feed_enabled,
        periodEnd: c.current_period_end || null,
      })));
      setSubs(co.map((c) => ({
        companyId: c.id, plan: ADMIN_PLAN_LABEL[c.plan] || c.plan,
        cycle: c.cycle || "monthly", status: c.sub_status || "—", mrr: 0,
        renews: c.current_period_end || "—", method: "Stripe",
      })));
    }
    if (Array.isArray(us)) {
      setUsers(us.map((u) => ({
        id: u.id, name: u.full_name || "—", email: u.email || "",
        companyId: u.company_id, role: (u.role || "").replace(/^./, (m) => m.toUpperCase()),
        status: u.status,
        // Nobody has been active until they next sign in, so fall back to when
        // the account was created rather than showing a bare dash.
        lastActive: u.last_active_at ? relTime(u.last_active_at) : null,
        joined: u.created_at ? relTime(u.created_at) : null,
      })));
    }
  };
  useEffect(() => { if (admin) reloadAdminData(); /* eslint-disable-line */ }, [admin]);

  // AI usage for the selected month. Reloads when the month changes, and rides
  // along with the polling below so the current month stays live.
  const reloadUsage = async (forPeriod = period) => {
    if (!hasSupabase || !admin) return;
    const { data, error } = await supabase.rpc("admin_usage_detail", { p_period: forPeriod });
    if (error || !Array.isArray(data)) return;
    setUsage(data.map((u) => ({
      companyId: u.company_id, name: u.company_name,
      plan: ADMIN_PLAN_LABEL[u.plan] || u.plan, status: u.status,
      resume_screen: Number(u.resume_screen) || 0,
      applicant_screen: Number(u.applicant_screen) || 0,
      ai_rank: Number(u.ai_rank) || 0,
      ai_insight: Number(u.ai_insight) || 0,
      interview_questions: Number(u.interview_questions) || 0,
      total: Number(u.total_actions) || 0,
      monthlyPool: Number(u.monthly_pool) || 0,
      purchasedPool: Number(u.purchased_pool) || 0,
    })));
  };
  useEffect(() => { if (admin) reloadUsage(period); /* eslint-disable-line */ }, [admin, period]);

  // Requested 1:1 calls. Admin-only read, newest day first.
  const reloadBookings = async () => {
    if (!hasSupabase || !admin) return;
    const { data, error } = await supabase.from("sales_bookings")
      .select("id, day, slot, name, email, phone, company, message, status, ticket_id")
      .order("day", { ascending: true });
    if (!error && Array.isArray(data)) setBookings(data);
  };
  useEffect(() => { if (admin) reloadBookings(); /* eslint-disable-line */ }, [admin]);

  const setBookingStatus = async (b, status) => {
    setBookings((bs) => bs.map((x) => x.id === b.id ? { ...x, status } : x));   // optimistic
    const err = await runAdminAction("set_booking_status", { p_booking: b.id, p_status: status },
      "Set booking to " + status, b.name + " · " + b.day + " " + b.slot);
    if (err) setBookings((bs) => bs.map((x) => x.id === b.id ? { ...x, status: b.status } : x));
    else reloadBookings();
  };

  // Credit top-ups bought this month. Real revenue the subscription figure
  // never counted. Returned per currency, not converted.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.rpc("admin_credit_revenue", { p_period: period }).then(({ data, error }) => {
      if (active && !error && Array.isArray(data)) setTopups(data);
    });
    return () => { active = false; };
  }, [admin, period]);

  // Total revenue for the overview: today, this month, this year. Read from
  // Stripe, which is the only place that holds subscriptions AND top-ups. Not
  // tied to the month picker, which drives the tables further down.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.functions.invoke("admin-revenue").then(({ data, error }) => {
      if (!active) return;
      if (!error && Array.isArray(data?.rows)) setRevTotals(data.rows);
      // A support admin is refused by the function, which is not a failure worth
      // showing: the tile is hidden for that role anyway.
      setRevLoaded(true);
    });
    // Top-ups come from our own log, not from Stripe. Splitting them back out of
    // the charge list would mean guessing from metadata, since a top-up raises an
    // invoice like a subscription does.
    supabase.rpc("admin_topup_revenue_totals").then(({ data, error }) => {
      if (active && !error && Array.isArray(data)) setTopupTotals(data);
    });
    // The purchases behind that number. A total nobody can attribute is a total
    // nobody trusts, and the first question anyone asks it is "whose?".
    supabase.rpc("admin_recent_topups", { p_limit: 50 }).then(({ data, error }) => {
      if (active && !error && Array.isArray(data)) setRecentTopups(data);
    });
    return () => { active = false; };
  }, [admin]);

  // When each workspace was last touched. Thin until 0157 has seen sign-ins.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.rpc("admin_workspace_activity").then(({ data, error }) => {
      if (active && !error && Array.isArray(data)) setActivity(data);
    });
    return () => { active = false; };
  }, [admin]);

  // Sen-per-action rates. Cost figures read as a dash until these are set.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.from("ai_unit_costs").select("kind, cost_sen").then(({ data }) => {
      if (!active || !Array.isArray(data)) return;
      setAiCosts(Object.fromEntries(data.map((r) => [r.kind, Number(r.cost_sen) || 0])));
    });
    return () => { active = false; };
  }, [admin]);

  // One place that runs an admin RPC (or the reset-password edge function),
  // records the audit on success, and hands back an error string so the caller
  // can undo its optimistic update. Every RPC re-checks the admin role
  // server-side, so this is convenience, not the security boundary.
  const runAdminAction = async (rpc, args, action, target) => {
    if (!hasSupabase) { logAudit(action, target); return null; }   // demo
    try {
      const { error } = rpc === "__reset_password__"
        ? await supabase.functions.invoke("admin-reset-password", { body: args })
        : await supabase.rpc(rpc, args);
      if (error) {
        console.error(rpc, error.message || error);
        return /forbidden|42501/i.test(error.message || "") ? "You don't have permission for that." : (error.message || "Action failed.");
      }
      logAudit(action, target);
      return null;
    } catch (e) { console.error(rpc, e); return "Action failed."; }
  };

  // The real record lives in public.audit_log, written by the database itself.
  // This reads it back; it is never the source of truth.
  const reloadAudit = async () => {
    if (!hasSupabase || !admin) return;
    if (!["super", "billing"].includes(admin.role)) return;   // RLS: super and billing only
    const { data, error } = await supabase
      .from("audit_log")
      .select("id, actor_name, actor_role, action, target, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) return;
    setAudit(data.map((r) => ({
      id: r.id,
      actor: r.actor_name || "—",
      role: r.actor_role,
      action: r.action,
      target: r.target || "",
      at: relTime(r.created_at),
      when: r.created_at ? new Date(r.created_at).toLocaleString() : "",
    })));
  };
  useEffect(() => { if (admin) reloadAudit(); /* eslint-disable-line */ }, [admin]);

  // An immediate echo so an action is visibly recorded, replaced by the server's
  // own row on the next read. Actions the database audits for itself (suspend,
  // deactivate, plan change) will match; the rest are local until 0158 lands.
  const logAudit = (action, target) => {
    if (!admin) return;
    setAudit((a) => [{
      id: `local-${a.length}-${action}`, actor: admin.name, role: admin.role,
      action, target, at: "just now", when: "",
    }, ...a]);
    reloadAudit();
  };

  // Toggle a feature flag: optimistic UI, persist to platform_flags when live
  // (reverting on error), and record the change in the audit log. Flags backed
  // by platform_flags (sso_login, white_label, ...) take effect in the customer
  // app immediately, since it reads that table at load.
  const toggleFlag = async (f) => {
    const next = !f.enabled;
    setFlags((fs) => fs.map((x) => x.key === f.key ? { ...x, enabled: next } : x));
    logAudit(next ? "Enabled feature flag" : "Disabled feature flag", `${f.key} (${f.env})`);
    if (hasSupabase) {
      const { error } = await supabase.rpc("set_platform_flag", { p_key: f.key, p_enabled: next });
      if (error) setFlags((fs) => fs.map((x) => x.key === f.key ? { ...x, enabled: f.enabled } : x));
    }
  };

  // Load real support tickets for an admin who can see them. Company name +
  // requester are embedded via foreign keys; RLS returns every company's
  // tickets for super/support (billing has no support policy).
  const reloadTickets = async () => {
    if (!hasSupabase || !admin || !["super", "support"].includes(admin.role)) return;
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, subject, channel, priority, status, body, company_id, requester_name, requester_email, created_at, updated_at, companies(name), requester:profiles(full_name)")
      .order("updated_at", { ascending: false });
    if (!error && data) setTickets(data.map(mapTicketRow));
  };
  useEffect(() => { if (admin) reloadTickets(); /* eslint-disable-line */ }, [admin]);

  // Keep the console live. The admin tables (companies, profiles, subscriptions,
  // support_tickets) are not in the Realtime publication, so this polls instead:
  // every 20s while the tab is visible, and immediately when it regains focus.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      reloadAdminData();
      reloadTickets();
      reloadUsage();
      reloadAudit();
      reloadBookings();
    };
    const id = setInterval(pull, 20000);
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", pull);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", pull);
    };
    /* eslint-disable-line */
  }, [admin]);

  // Real Stripe plan prices (same source as the public pricing page), used to
  // total recurring revenue in ringgit rather than from a hardcoded list price.
  const [planPrices, setPlanPrices] = useState(null);
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.functions.invoke("get-plan-prices").then(({ data, error }) => {
      if (active && !error && data?.prices) setPlanPrices(data.prices);
    });
    return () => { active = false; };
  }, [admin]);

  // Merge live platform flags over the mock list so the /admin toggles reflect
  // and control the real, app-facing flag state (sso_login, white_label, ...).
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.from("platform_flags").select("key, enabled").then(({ data }) => {
      if (active && Array.isArray(data) && data.length) {
        setFlags((fs) => fs.map((f) => { const row = data.find((d) => d.key === f.key); return row ? { ...f, enabled: row.enabled } : f; }));
      }
    });
    return () => { active = false; };
  }, [admin]);

  // Load blocked booking dates (public read) so the admin can manage them.
  useEffect(() => {
    if (!hasSupabase || !admin) return;
    let active = true;
    supabase.from("booking_blocked_dates").select("day, reason").order("day").then(({ data }) => {
      if (active && Array.isArray(data)) setBlocked(data.map((r) => ({ day: r.day, reason: r.reason })));
    });
    return () => { active = false; };
  }, [admin]);

  // Resolve persists to the DB (when live) before updating the table + audit log.
  const resolveTicket = async (t) => {
    if (hasSupabase) {
      const { error } = await supabase.from("support_tickets").update({ status: "resolved" }).eq("id", t.id);
      if (error) return;
    }
    setTickets((ts) => ts.map((x) => x.id === t.id ? { ...x, status: "resolved", updated: "just now" } : x));
    const name = t.company || companies.find((c) => c.id === t.companyId)?.name || t.companyId;
    logAudit("Resolved support ticket", `${t.id} (${name})`);
  };

  // Email the requester a reply (via the support-reply edge function, which
  // sends through Resend and, when `resolve` is set, marks the ticket resolved).
  // Returns { ok } so the composer can show an error without a full reload.
  const replyToTicket = async (t, message, resolve) => {
    const name = t.company || companies.find((c) => c.id === t.companyId)?.name || t.companyId;
    if (hasSupabase) {
      const { data, error } = await supabase.functions.invoke("support-reply", {
        body: { ticket_id: t.id, message, resolve },
      });
      if (error || data?.error) {
        return { ok: false, error: data?.error || error?.message || "Could not send the reply." };
      }
      if (resolve && data?.resolved) {
        setTickets((ts) => ts.map((x) => x.id === t.id ? { ...x, status: "resolved", updated: "just now" } : x));
      }
    } else if (resolve) {
      // Mock preview: no backend, just reflect the resolve locally.
      setTickets((ts) => ts.map((x) => x.id === t.id ? { ...x, status: "resolved", updated: "just now" } : x));
    }
    logAudit(resolve ? "Replied and resolved support ticket" : "Replied to support ticket", `${t.id} (${name})`);
    return { ok: true };
  };

  const go = (key) => {
    setSection(key);
    if (typeof window !== "undefined") window.history.pushState({ admin: true }, "", "/admin/" + key);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => setSection(window.location.pathname.replace(/^\/admin\/?/, "") || "dashboard");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (restoring) return <div className="adm min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}><span className="text-sm" style={{ color: "var(--adm-ink)" }}>Loading…</span></div>;
  if (!admin) return <AdminLogin onLogin={(a) => { setAdmin(a); go(section || "dashboard"); }} />;

  const role = admin.role;
  let screen;
  if (!sectionAllowed(role, section)) {
    screen = <NoAccess role={role} />;
    // record the blocked attempt once per mount of a disallowed section
  } else {
    switch (section) {
      case "workspaces": {
        const allowed = WORKSPACE_TABS.filter((t) => t.roles.includes(role));
        const active = allowed.some((t) => t.key === wsTab) ? wsTab : allowed[0]?.key;
        screen = (
          <Workspaces role={role} tab={active} setTab={setWsTab}>
            {active === "companies" && <Companies role={role} companies={companies} setCompanies={setCompanies} users={users} subs={subs} usage={usage} aiCosts={aiCosts} planPrices={planPrices} activity={activity} audit={logAudit} onAction={runAdminAction} go={go} />}
            {active === "users" && <Users role={role} companies={companies} users={users} setUsers={setUsers} audit={logAudit} onAction={runAdminAction} />}
            {active === "margin" && <MarginPanel companies={companies} usage={usage} aiCosts={aiCosts} planPrices={planPrices} />}
            {active === "margin" && <MarginPanel companies={companies} usage={usage} aiCosts={aiCosts} planPrices={planPrices} />}
            {active === "subscriptions" && <Subscriptions role={role} companies={companies} subs={subs} setSubs={setSubs} planPrices={planPrices} topups={topups} audit={logAudit} onAction={runAdminAction} />}
          </Workspaces>
        );
        break;
      }
      case "support":       screen = <Support role={role} companies={companies} tickets={tickets} onResolve={resolveTicket} onReply={replyToTicket} />; break;
      case "bookings":      screen = <Bookings role={role} bookings={bookings} onStatus={setBookingStatus} blocked={blocked} setBlocked={setBlocked} audit={logAudit} />; break;
      case "revenue":
        screen = <Revenue revTotals={revTotals} revLoaded={revLoaded} topupTotals={topupTotals} topupRows={recentTopups} go={go} />;
        break;
      case "settings": {
        const allowed = SETTINGS_TABS.filter((t) => t.roles.includes(role));
        const active = allowed.some((t) => t.key === settingsTab) ? settingsTab : allowed[0]?.key;
        screen = (
          <Settings role={role} tab={active} setTab={setSettingsTab}>
            {active === "rates" && <CurrencyRates role={role} audit={logAudit} />}
            {active === "credit_prices" && <CreditPricing role={role} audit={logAudit} />}
            {active === "promos" && <Promos role={role} companies={companies} audit={logAudit} />}
            {active === "ai_costs" && <AiCosts role={role} rates={aiCosts} setRates={setAiCosts} usage={usage} audit={logAudit} />}
            {active === "flags" && <Flags role={role} flags={flags} setFlags={setFlags} audit={logAudit} onToggle={toggleFlag} />}
            {active === "email_templates" && <EmailTemplatesAdmin role={role} audit={logAudit} />}
            {active === "usage" && <Usage role={role} usage={usage} aiCosts={aiCosts} period={period} periods={recentPeriods()} onPeriod={setPeriod} />}
            {active === "audit" && <Audit audit={audit} />}
          </Settings>
        );
        break;
      }
      default:              screen = <Dashboard role={role} companies={companies} users={users} tickets={tickets} audit={audit} planPrices={planPrices} revTotals={revTotals} revLoaded={revLoaded} topupTotals={topupTotals} recentTopups={recentTopups} go={go} />;
    }
  }

  const onLogout = async () => { if (hasSupabase) await supabase.auth.signOut(); setAdmin(null); };
  return (
    <AdminShell admin={admin} section={section} go={go} onLogout={onLogout}
      companies={companies} tickets={tickets}>{screen}</AdminShell>
  );
}
