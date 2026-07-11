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
// All data below is mock data for the preview.
// ============================================================================
import { useState, useEffect, useMemo } from "react";
import { supabase, hasSupabase } from "./lib/supabase";
import { ASTER_MARK_PATH } from "./lib/logo";

const ADMIN_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
:root{
--bg:#FAFAFB;--card:#FFFFFF;--line:#ECECEF;--line-strong:#DEDEE3;
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
.adm-row:hover{background:#F7F9FC;}
.adm-nav-item:hover{background:#F7F9FC;}
.adm ::-webkit-scrollbar{width:10px;height:10px}.adm ::-webkit-scrollbar-thumb{background:#d9d9e3;border-radius:8px;border:2px solid transparent;background-clip:content-box}
.adm-side ::-webkit-scrollbar-thumb{background:#d9d9e3}
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
  ban: "M5.6 5.6l12.8 12.8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v4h-4",
  dot: "M12 12h.01",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 2 8 2 8H4s2-1 2-8M10.3 21a2 2 0 0 0 3.4 0",
  spark: "M12 3l1.9 5.6L20 10l-6.1 1.4L12 17l-1.9-5.6L4 10l6.1-1.4L12 3Z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};
// The real Aster app-icon mark (blue rounded square + white burst), used in the
// admin header/login in place of the old "A" letter badge. The SVG rounds its
// own corners, so no extra background/radius is needed on the container.
function AsterMark({ className = "w-10 h-10" }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
      <rect width="128" height="128" rx="28" fill="#0B2AE0" />
      <g transform="translate(64 64) scale(0.92) translate(-250.9 -296.1)" fill="#FFFFFF">
        <path d={ASTER_MARK_PATH} />
      </g>
    </svg>
  );
}
function Icon({ name, className = "w-5 h-5" }) {
  const filled = name === "dot";
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {filled ? <circle cx="12" cy="12" r="4" /> : <path d={PATHS[name] || PATHS.dot} />}
    </svg>
  );
}

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
  { key: "companies",     label: "Companies",        icon: "building",  roles: ["super", "support", "billing"] },
  { key: "users",         label: "User management",  icon: "users",     roles: ["super", "support"] },
  { key: "subscriptions", label: "Subscriptions",    icon: "card",      roles: ["super", "billing"] },
  { key: "usage",         label: "Usage monitoring", icon: "chart",     roles: ["super", "support", "billing"] },
  { key: "support",       label: "Support logs",     icon: "headset",   roles: ["super", "support"] },
  { key: "flags",         label: "Feature flags",    icon: "flag",      roles: ["super"] },
  { key: "email_templates", label: "Email templates", icon: "mail",     roles: ["super", "support"] },
  { key: "audit",         label: "Audit logs",       icon: "audit",     roles: ["super", "billing"] },
];

// Fine-grained actions -> roles allowed.
const PERMS = {
  "company.suspend":     ["super"],
  "company.restore":     ["super"],
  "user.reset":          ["super", "support"],
  "user.deactivate":     ["super"],
  "subscription.change": ["super", "billing"],
  "flag.toggle":         ["super"],
  "support.resolve":     ["super", "support"],
  "template.edit":       ["super", "support"],
};
const can = (role, action) => (PERMS[action] || []).includes(role);
const sectionAllowed = (role, key) => (SECTIONS.find((s) => s.key === key)?.roles || []).includes(role);

// ---------------------------------------------------------------------------
// Helpers: masking, formatting
// ---------------------------------------------------------------------------
// Candidate PII is masked wherever it could surface. Company (customer) users
// are account holders and shown normally; candidates are applicants and are not.
const maskName = (n) => (n || "").split(" ").map((p) => (p.length <= 1 ? p : p[0] + "•".repeat(Math.max(1, p.length - 1)))).join(" ");
const maskEmail = (e) => {
  const [u, d] = (e || "").split("@");
  if (!d) return "•••";
  return `${(u || "")[0] || "•"}•••@${d[0]}•••${d.slice(d.lastIndexOf("."))}`;
};
const money = (n) => "$" + n.toLocaleString("en-US");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const ADMIN_ACCOUNTS = [
  { id: "a1", name: "Priya Nair",   email: "priya@hireaster.com",  role: "super",   title: "Platform Lead" },
  { id: "a2", name: "Marcus Lee",   email: "marcus@hireaster.com", role: "support", title: "Support Engineer" },
  { id: "a3", name: "Dana Osei",    email: "dana@hireaster.com",   role: "billing", title: "Finance Ops" },
];

const INIT_COMPANIES = [
  { id: "c1", name: "Oryx Studio",       plan: "Pro",        status: "active",    seats: 12, activeJobs: 5,  candidates: 1240, region: "MY", owner: "Shah Ramly",    mrr: 149, created: "2025-11-02" },
  { id: "c2", name: "Grabtech",          plan: "Enterprise", status: "active",    seats: 60, activeJobs: 22, candidates: 8420, region: "SG", owner: "Jia Wei Tan",   mrr: 1200, created: "2025-04-18" },
  { id: "c3", name: "Fave",              plan: "Pro",        status: "trial",     seats: 8,  activeJobs: 3,  candidates: 410,  region: "MY", owner: "Nadia Aziz",    mrr: 0, created: "2026-06-21" },
  { id: "c4", name: "Studio Kite",       plan: "Starter",    status: "active",    seats: 4,  activeJobs: 2,  candidates: 220,  region: "MY", owner: "Ivan Lim",      mrr: 49, created: "2026-01-09" },
  { id: "c5", name: "MDEC",              plan: "Enterprise", status: "active",    seats: 40, activeJobs: 14, candidates: 5100, region: "MY", owner: "Farah Idris",   mrr: 900, created: "2025-08-30" },
  { id: "c6", name: "Wellfound Asia",    plan: "Pro",        status: "suspended", seats: 10, activeJobs: 0,  candidates: 980,  region: "SG", owner: "Kenji Sato",    mrr: 149, created: "2025-12-14" },
  { id: "c7", name: "Homebase HR",       plan: "Starter",    status: "trial",     seats: 3,  activeJobs: 1,  candidates: 60,   region: "PH", owner: "Rina Cruz",     mrr: 0, created: "2026-06-28" },
  { id: "c8", name: "Peoplebox",         plan: "Pro",        status: "active",    seats: 16, activeJobs: 7,  candidates: 2010, region: "IN", owner: "Arjun Mehta",   mrr: 149, created: "2025-10-05" },
  { id: "c9", name: "Motion Recruit",    plan: "Starter",    status: "churned",   seats: 0,  activeJobs: 0,  candidates: 340,  region: "SG", owner: "Wei Ling Ong",  mrr: 0, created: "2025-05-22" },
  { id: "c10", name: "Ceipal Labs",      plan: "Enterprise", status: "active",    seats: 28, activeJobs: 11, candidates: 3600, region: "IN", owner: "Sana Kapoor",   mrr: 780, created: "2025-09-12" },
];

const COMPANY_USERS = [
  { id: "u1",  companyId: "c1", name: "Shah Ramly",      email: "shah@oryx.studio",     role: "Owner",       status: "active",   lastActive: "2h ago" },
  { id: "u2",  companyId: "c1", name: "Amira Hassan",    email: "amira@oryx.studio",    role: "Recruiter",   status: "active",   lastActive: "1d ago" },
  { id: "u3",  companyId: "c1", name: "Daniel Teoh",     email: "daniel@oryx.studio",   role: "Interviewer", status: "invited",  lastActive: "—" },
  { id: "u4",  companyId: "c2", name: "Jia Wei Tan",     email: "jiawei@grabtech.com",  role: "Owner",       status: "active",   lastActive: "20m ago" },
  { id: "u5",  companyId: "c2", name: "Lena Koh",        email: "lena@grabtech.com",    role: "Admin",       status: "active",   lastActive: "5h ago" },
  { id: "u6",  companyId: "c2", name: "Ravi Nair",       email: "ravi@grabtech.com",    role: "Recruiter",   status: "suspended", lastActive: "3d ago" },
  { id: "u7",  companyId: "c5", name: "Farah Idris",     email: "farah@mdec.my",        role: "Owner",       status: "active",   lastActive: "1h ago" },
  { id: "u8",  companyId: "c5", name: "Hakim Yusof",     email: "hakim@mdec.my",        role: "Recruiter",   status: "active",   lastActive: "6h ago" },
  { id: "u9",  companyId: "c8", name: "Arjun Mehta",     email: "arjun@peoplebox.ai",   role: "Owner",       status: "active",   lastActive: "4h ago" },
  { id: "u10", companyId: "c8", name: "Divya Rao",       email: "divya@peoplebox.ai",   role: "Admin",       status: "invited",  lastActive: "—" },
  { id: "u11", companyId: "c4", name: "Ivan Lim",        email: "ivan@studiokite.co",   role: "Owner",       status: "active",   lastActive: "2d ago" },
  { id: "u12", companyId: "c10", name: "Sana Kapoor",    email: "sana@ceipallabs.com",  role: "Owner",       status: "active",   lastActive: "30m ago" },
  { id: "u13", companyId: "c10", name: "Rohit Verma",    email: "rohit@ceipallabs.com", role: "Interviewer", status: "active",   lastActive: "1d ago" },
];

const INIT_SUBSCRIPTIONS = INIT_COMPANIES.map((c) => ({
  companyId: c.id,
  plan: c.plan,
  cycle: c.plan === "Enterprise" ? "annual" : "monthly",
  status: c.status === "trial" ? "trialing" : c.status === "churned" ? "canceled" : c.status === "suspended" ? "past_due" : "active",
  mrr: c.mrr,
  seats: c.seats,
  renews: c.status === "churned" ? "—" : "2026-08-01",
}));

const INIT_USAGE = INIT_COMPANIES.map((c) => ({
  companyId: c.id,
  resumeParsing: [Math.min(c.candidates % 100, 100), 100],
  aiRuns: [Math.min((c.activeJobs * 3) % 30, 30), 30],
  activeJobs: [c.activeJobs, c.plan === "Enterprise" ? 50 : c.plan === "Pro" ? 10 : 3],
  apiCalls: c.candidates * 7,
}));

// Support tickets. Any candidate reference is masked before it reaches the UI.
const INIT_TICKETS = [
  { id: "T-1042", companyId: "c1", subject: "Scheduling link not sending Meet invite", requester: "Amira Hassan", channel: "Email",  priority: "high",   status: "open",     updated: "12m ago", note: "Candidate " + maskName("Nurul Huda") + " did not receive the invite." },
  { id: "T-1041", companyId: "c2", subject: "SSO login loop for new admins",           requester: "Lena Koh",     channel: "Chat",   priority: "urgent", status: "open",     updated: "40m ago", note: "Affects 3 users on the workspace." },
  { id: "T-1040", companyId: "c5", subject: "Export of ranked shortlist to CSV fails",  requester: "Hakim Yusof",  channel: "Email",  priority: "normal", status: "pending",  updated: "3h ago",  note: "Reproduced on Chrome; investigating." },
  { id: "T-1039", companyId: "c8", subject: "Billing invoice address update",           requester: "Arjun Mehta",  channel: "Email",  priority: "low",    status: "pending",  updated: "5h ago",  note: "Routed to billing." },
  { id: "T-1038", companyId: "c6", subject: "Reactivate suspended workspace",           requester: "Kenji Sato",   channel: "Phone",  priority: "high",   status: "open",     updated: "1d ago",  note: "Payment recovered; awaiting review." },
  { id: "T-1037", companyId: "c10", subject: "Bulk upload rejects ZIP over 50MB",       requester: "Rohit Verma",  channel: "Chat",   priority: "normal", status: "resolved", updated: "1d ago",  note: "Advised splitting the archive." },
  { id: "T-1036", companyId: "c4", subject: "Add interviewer seat mid-cycle",           requester: "Ivan Lim",     channel: "Email",  priority: "low",    status: "resolved", updated: "2d ago",  note: "Seat added; prorated." },
  { id: "T-1035", companyId: "c3", subject: "Trial extension request",                  requester: "Nadia Aziz",   channel: "Email",  priority: "normal", status: "open",     updated: "2d ago",  note: "Evaluating; 7 days remaining." },
];

const INIT_FLAGS = [
  { key: "ai_dedup_v2",         label: "AI dedup v2",              desc: "Second-gen deduplication across old and new CVs.", enabled: true,  rollout: 100, env: "prod" },
  { key: "voice_screening",     label: "Voice screening (beta)",   desc: "AI voice interview for phone-screen replacement.", enabled: false, rollout: 15,  env: "prod" },
  { key: "career_site_builder", label: "Career site builder",      desc: "Hosted branded careers page and job board.",      enabled: true,  rollout: 100, env: "prod" },
  { key: "whatsapp_scheduling", label: "WhatsApp scheduling",      desc: "Candidate self-booking over WhatsApp.",           enabled: true,  rollout: 60,  env: "prod" },
  { key: "advanced_analytics",  label: "Advanced analytics",       desc: "Custom funnel reports and cohort breakdowns.",    enabled: false, rollout: 30,  env: "prod" },
  { key: "sso_login",           label: "SSO (Google / Microsoft)", desc: "Customer sign-in via Google/Microsoft SSO. Off by default across all plans; enable per the pricing matrix (Enterprise).", enabled: false, rollout: 0,   env: "prod" },
  { key: "white_label",         label: "White-label branding",     desc: "Custom branding / white-label for Enterprise workspaces. Off by default across all plans.", enabled: false, rollout: 0,   env: "prod" },
  { key: "sso_scim",            label: "SSO + SCIM provisioning",  desc: "Enterprise SSO directory sync (SCIM). Off by default.", enabled: false, rollout: 0,   env: "prod" },
  { key: "new_billing_ui",      label: "New billing UI",           desc: "Redesigned in-app billing and invoices.",         enabled: false, rollout: 0,   env: "staging" },
  { key: "ranked_reasons_v3",   label: "Ranked reasons v3",        desc: "Richer explanations on every match score.",       enabled: false, rollout: 5,   env: "prod" },
];

const INIT_AUDIT = [
  { id: 1, actor: "Priya Nair",  role: "super",   action: "Enabled feature flag",      target: "ai_dedup_v2 (prod)",        at: "Jul 6, 2026 · 09:14", ip: "10.2.4.11" },
  { id: 2, actor: "Dana Osei",   role: "billing", action: "Changed subscription plan", target: "Studio Kite → Pro",         at: "Jul 6, 2026 · 08:52", ip: "10.2.4.31" },
  { id: 3, actor: "Marcus Lee",  role: "support", action: "Reset user password",       target: "lena@grabtech.com",         at: "Jul 5, 2026 · 17:20", ip: "10.2.4.22" },
  { id: 4, actor: "Priya Nair",  role: "super",   action: "Suspended company",         target: "Wellfound Asia",            at: "Jul 5, 2026 · 15:03", ip: "10.2.4.11" },
  { id: 5, actor: "Marcus Lee",  role: "support", action: "Resolved support ticket",   target: "T-1037 (Ceipal Labs)",      at: "Jul 5, 2026 · 11:40", ip: "10.2.4.22" },
  { id: 6, actor: "Dana Osei",   role: "billing", action: "Viewed subscription",       target: "Grabtech",                  at: "Jul 5, 2026 · 10:12", ip: "10.2.4.31" },
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
function StatCard({ icon, label, value, sub, tone = "brand" }) {
  const t = TONE[tone] || TONE.brand;
  return (
    <Card pad="p-5">
      <div className="flex items-start justify-between">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: t.bg, color: t.fg }}><Icon name={icon} className="w-5 h-5" /></span>
      </div>
      <p className="mt-4 text-2xl font-bold adm-display tnum text-neutral-900">{value}</p>
      <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>{label}</p>
      {sub && <p className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>{sub}</p>}
    </Card>
  );
}
function SectionHead({ title, desc, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold adm-display text-neutral-900">{title}</h1>
        {desc && <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{desc}</p>}
      </div>
      {children}
    </div>
  );
}
function PrivacyNote({ children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-5 text-sm" style={{ background: "var(--brand-soft)", border: "1px solid #CBD8F5", color: "var(--ink-2)" }}>
      <span style={{ color: "var(--brand)" }} className="shrink-0 mt-0.5"><Icon name="shield" className="w-4 h-4" /></span>
      <span>{children}</span>
    </div>
  );
}
function TableShell({ head, children }) {
  return (
    <Card pad="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              {head.map((h, i) => (
                <th key={i} className="text-left font-semibold px-4 sm:px-5 py-3.5 whitespace-nowrap" style={{ color: "var(--ink-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
              ))}
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
function Bar({ value, max, tone = "brand" }) {
  const p = Math.min(100, pct(value, max));
  const over = p >= 90;
  const t = TONE[over ? "warn" : tone];
  return (
    <div className="flex items-center gap-2.5 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: p + "%", background: t.fg }} />
      </div>
      <span className="text-xs tnum shrink-0" style={{ color: "var(--ink-3)" }}>{value}/{max}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function Dashboard({ role, companies, tickets, audit, go }) {
  const active = companies.filter((c) => c.status === "active").length;
  const trials = companies.filter((c) => c.status === "trial").length;
  const mrr = companies.reduce((s, c) => s + c.mrr, 0);
  const openTix = tickets.filter((t) => t.status === "open").length;
  return (
    <div>
      <SectionHead title="Overview" desc="Platform health across all customer workspaces." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="building" label="Companies" value={companies.length} sub={`${active} active · ${trials} on trial`} tone="brand" />
        {can(role, "subscription.change") || role === "billing" || role === "super"
          ? <StatCard icon="card" label="Monthly recurring revenue" value={money(mrr)} sub="Across active subscriptions" tone="ok" />
          : <StatCard icon="chart" label="Active jobs" value={companies.reduce((s, c) => s + c.activeJobs, 0)} sub="Across all workspaces" tone="info" />}
        <StatCard icon="headset" label="Open support tickets" value={openTix} sub={`${tickets.length} total this week`} tone="warn" />
        <StatCard icon="users" label="Workspace seats" value={companies.reduce((s, c) => s + c.seats, 0)} sub="Provisioned across companies" tone="info" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold adm-display text-neutral-900">Recent admin activity</h3>
              {sectionAllowed(role, "audit") && <button onClick={() => go("audit")} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: "var(--brand)" }}>Audit log <Icon name="arrowUpRight" className="w-3.5 h-3.5" /></button>}
            </div>
            <ul className="space-y-3">
              {audit.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white grad text-[11px] font-bold">{a.actor.split(" ").map((x) => x[0]).join("")}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-900"><span className="font-medium">{a.actor}</span> · {a.action} <span style={{ color: "var(--ink-2)" }}>{a.target}</span></p>
                    <p className="text-xs" style={{ color: "var(--ink-3)" }}>{a.at}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card>
          <h3 className="font-semibold adm-display text-neutral-900 mb-4">Attention</h3>
          <ul className="space-y-3 text-sm">
            {companies.filter((c) => c.status === "suspended").map((c) => (
              <li key={c.id} className="flex items-center gap-2.5"><span style={{ color: "var(--danger)" }}><Icon name="warning" className="w-4 h-4" /></span><span className="text-neutral-900">{c.name}</span><Badge tone="danger">suspended</Badge></li>
            ))}
            {companies.filter((c) => c.status === "trial").map((c) => (
              <li key={c.id} className="flex items-center gap-2.5"><span style={{ color: "var(--warn)" }}><Icon name="dot" className="w-4 h-4" /></span><span className="text-neutral-900">{c.name}</span><Badge tone="info">trial</Badge></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Companies({ role, companies, setCompanies, audit, onAction }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const rows = companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const setStatus = async (c, status, action) => {
    setBusy(c.id);
    setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, status } : x));   // optimistic
    const err = await onAction("admin_set_company_status", { p_company: c.id, p_suspend: status === "suspended" }, action, c.name);
    if (err) setCompanies((cs) => cs.map((x) => x.id === c.id ? { ...x, status: c.status } : x));   // rollback
    setBusy(null);
  };
  return (
    <div>
      <SectionHead title="Companies" desc="Every customer workspace on the platform.">
        <label className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }}><Icon name="search" className="w-4 h-4" /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="pl-9 pr-3 py-2 rounded-xl text-sm w-56" style={{ border: "1px solid var(--line)", background: "#fff" }} />
        </label>
      </SectionHead>
      <PrivacyNote>Candidate records are counted here but their resumes and personal data are <strong>not accessible</strong> from the admin portal.</PrivacyNote>
      <TableShell head={["Company", "Plan", "Status", "Seats", "Active jobs", "Candidates", "Region", "Actions"]}>
        {rows.map((c) => (
          <tr key={c.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td><div className="font-semibold text-neutral-900">{c.name}</div><div className="text-xs" style={{ color: "var(--ink-3)" }}>Owner: {c.owner}</div></Td>
            <Td><Badge tone={c.plan === "Enterprise" ? "brand" : "ink"}>{c.plan}</Badge></Td>
            <Td><StatusBadge value={c.status} /></Td>
            <Td className="tnum">{c.seats}</Td>
            <Td className="tnum">{c.activeJobs}</Td>
            <Td><span className="inline-flex items-center gap-1.5 tnum"><span style={{ color: "var(--ink-3)" }}><Icon name="lock" className="w-3.5 h-3.5" /></span>{c.candidates.toLocaleString()}</span></Td>
            <Td style={{ color: "var(--ink-2)" }}>{c.region}</Td>
            <Td>
              {c.status === "suspended"
                ? <ActionBtn icon="refresh" disabled={!can(role, "company.restore")} onClick={() => setStatus(c, "active", "Restored company")}>Restore</ActionBtn>
                : <ActionBtn icon="ban" tone="danger" disabled={!can(role, "company.suspend")} onClick={() => setStatus(c, "suspended", "Suspended company")}>Suspend</ActionBtn>}
            </Td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

function Users({ role, companies, users, setUsers, audit, onAction }) {
  const cName = (id) => companies.find((c) => c.id === id)?.name || "—";
  const setStatus = async (u, status, action) => {
    setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status } : x));       // optimistic
    const err = await onAction("admin_set_user_status", { p_profile: u.id, p_active: status === "active" }, action, u.email);
    if (err) setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status: u.status } : x));   // rollback
  };
  const resetPassword = async (u) => {
    await onAction("__reset_password__", { email: u.email }, "Reset user password", u.email);
  };
  return (
    <div>
      <SectionHead title="User management" desc="Company user accounts (recruiters, admins, interviewers). These are customer team members, not candidates." />
      <PrivacyNote>These are <strong>company users</strong>, separate from admin accounts and from candidates. Candidate/applicant records are never listed here.</PrivacyNote>
      <TableShell head={["User", "Company", "Role", "Status", "Last active", "Actions"]}>
        {users.map((u) => (
          <tr key={u.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td><div className="font-semibold text-neutral-900">{u.name}</div><div className="text-xs" style={{ color: "var(--ink-3)" }}>{u.email}</div></Td>
            <Td style={{ color: "var(--ink-2)" }}>{cName(u.companyId)}</Td>
            <Td><Badge tone={u.role === "Owner" ? "brand" : "ink"}>{u.role}</Badge></Td>
            <Td><StatusBadge value={u.status} /></Td>
            <Td style={{ color: "var(--ink-2)" }}>{u.lastActive}</Td>
            <Td>
              <div className="flex gap-2">
                <ActionBtn icon="key" disabled={!can(role, "user.reset")} onClick={() => resetPassword(u)}>Reset password</ActionBtn>
                {u.status === "suspended"
                  ? <ActionBtn icon="refresh" disabled={!can(role, "user.deactivate")} onClick={() => setStatus(u, "active", "Reactivated user")}>Reactivate</ActionBtn>
                  : <ActionBtn icon="ban" tone="danger" disabled={!can(role, "user.deactivate")} onClick={() => setStatus(u, "suspended", "Deactivated user")}>Deactivate</ActionBtn>}
              </div>
            </Td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

function Subscriptions({ role, companies, subs, setSubs, audit, onAction }) {
  const cName = (id) => companies.find((c) => c.id === id)?.name || "—";
  const total = subs.filter((s) => s.status === "active").reduce((a, s) => a + s.mrr, 0);
  const change = async (sub, plan) => {
    setSubs((ss) => ss.map((x) => x.companyId === sub.companyId ? { ...x, plan } : x));   // optimistic
    const err = await onAction("admin_change_plan", { p_company: sub.companyId, p_plan: ADMIN_PLAN_KEY[plan] || plan.toLowerCase() }, "Changed subscription plan", plan);
    if (err) setSubs((ss) => ss.map((x) => x.companyId === sub.companyId ? { ...x, plan: sub.plan } : x));   // rollback
  };
  return (
    <div>
      <SectionHead title="Subscriptions" desc="Plans, billing status and revenue by workspace.">
        <div className="text-right"><p className="text-xs" style={{ color: "var(--ink-3)" }}>Active MRR</p><p className="text-lg font-bold adm-display tnum" style={{ color: "var(--ok)" }}>{money(total)}</p></div>
      </SectionHead>
      <PrivacyNote>Aster does <strong>not store or display card details</strong>. Payment methods are held by the payment processor; only plan and status are shown here.</PrivacyNote>
      <TableShell head={["Company", "Plan", "Cycle", "Status", "MRR", "Renews", "Payment method", "Actions"]}>
        {subs.map((s) => (
          <tr key={s.companyId} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td className="font-semibold text-neutral-900">{cName(s.companyId)}</Td>
            <Td><Badge tone={s.plan === "Enterprise" ? "brand" : "ink"}>{s.plan}</Badge></Td>
            <Td style={{ color: "var(--ink-2)" }}>{s.cycle}</Td>
            <Td><StatusBadge value={s.status} /></Td>
            <Td className="tnum">{money(s.mrr)}</Td>
            <Td style={{ color: "var(--ink-2)" }}>{s.renews}</Td>
            <Td><span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}><Icon name="lock" className="w-3.5 h-3.5" /> On file (processor)</span></Td>
            <Td>
              {s.plan !== "Enterprise"
                ? <ActionBtn icon="arrowUpRight" disabled={!can(role, "subscription.change")} onClick={() => change(s, "Enterprise")}>Upgrade</ActionBtn>
                : <ActionBtn disabled={!can(role, "subscription.change")} icon="refresh" onClick={() => change(s, "Scale")}>Change plan</ActionBtn>}
            </Td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

function Usage({ role, companies, usage }) {
  const cName = (id) => companies.find((c) => c.id === id)?.name || "—";
  return (
    <div>
      <SectionHead title="Usage monitoring" desc="Aggregate consumption against plan limits. No candidate content is shown." />
      <PrivacyNote>Usage is <strong>aggregate only</strong>. Individual candidate data and resumes are never exposed through monitoring.</PrivacyNote>
      <TableShell head={["Company", "Resume parsing", "AI match runs", "Active jobs", "API calls (30d)"]}>
        {usage.map((u) => (
          <tr key={u.companyId} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td className="font-semibold text-neutral-900">{cName(u.companyId)}</Td>
            <Td><Bar value={u.resumeParsing[0]} max={u.resumeParsing[1]} /></Td>
            <Td><Bar value={u.aiRuns[0]} max={u.aiRuns[1]} tone="info" /></Td>
            <Td><Bar value={u.activeJobs[0]} max={u.activeJobs[1]} tone="ok" /></Td>
            <Td className="tnum" style={{ color: "var(--ink-2)" }}>{u.apiCalls.toLocaleString()}</Td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

function Support({ role, companies, tickets, onResolve, onReply }) {
  // Real (DB) tickets carry the company name inline; mock rows reference a
  // mock company id, so fall back to a lookup.
  const cName = (t) => t.company || companies.find((c) => c.id === t.companyId)?.name || "—";
  const [replyTo, setReplyTo] = useState(null); // ticket currently being replied to
  const canReply = can(role, "support.resolve");
  return (
    <div>
      <SectionHead title="Support logs" desc="Customer support tickets and interactions." />
      <PrivacyNote>Where a ticket mentions a candidate, their name is <strong>masked</strong> (e.g. {maskName("Nurul Huda")}). Resumes are never attached or viewable.</PrivacyNote>
      <TableShell head={["Ticket", "Company", "Subject", "Requester", "Channel", "Priority", "Status", "Actions"]}>
        {tickets.map((t) => (
          <tr key={t.id} className="adm-row align-top" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td className="font-semibold text-neutral-900 tnum">{t.id}<div className="text-xs font-normal mt-0.5" style={{ color: "var(--ink-3)" }}>{t.updated}</div></Td>
            <Td style={{ color: "var(--ink-2)" }}>{cName(t)}</Td>
            <Td><div className="text-neutral-900">{t.subject}</div><div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{t.note}</div></Td>
            <Td style={{ color: "var(--ink-2)" }}>{t.requester}{t.email && <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{t.email}</div>}</Td>
            <Td style={{ color: "var(--ink-2)" }}>{t.channel}</Td>
            <Td><Badge tone={STATUS_TONE[t.priority]}>{t.priority}</Badge></Td>
            <Td><StatusBadge value={t.status} /></Td>
            <Td>
              <div className="flex items-center gap-1.5">
                {/* Reply emails the requester; only offered when we have their email. */}
                {t.email && <ActionBtn icon="mail" disabled={!canReply} onClick={() => setReplyTo(t)}>Reply</ActionBtn>}
                {t.status !== "resolved" && <ActionBtn icon="check" disabled={!canReply} onClick={() => onResolve(t)}>Resolve</ActionBtn>}
              </div>
            </Td>
          </tr>
        ))}
      </TableShell>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(11,13,26,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white" style={{ border: "1px solid var(--line)", boxShadow: "0 30px 80px -30px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-neutral-900">Reply to {ticket.requester}</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{ticket.id} · {cName} · <span className="tnum">{ticket.email}</span></p>
            </div>
            <button onClick={onClose} className="text-sm" style={{ color: "var(--ink-3)" }} aria-label="Close">✕</button>
          </div>
          <div className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>{ticket.subject}</div>
        </div>
        <div className="px-6 py-4">
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
        <div className="px-6 pb-5 pt-1 flex items-center justify-end gap-2.5">
          <button onClick={onClose} disabled={busy} className="text-sm font-semibold px-3.5 py-2 rounded-lg" style={{ border: "1px solid var(--line)", color: "var(--ink-2)", background: "#fff" }}>Cancel</button>
          <button onClick={send} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg text-white grad disabled:opacity-50">{busy ? "Sending…" : "Send reply"}</button>
        </div>
      </div>
    </div>
  );
}

function Flags({ role, flags, setFlags, audit, onToggle }) {
  const toggle = onToggle || ((f) => { setFlags((fs) => fs.map((x) => x.key === f.key ? { ...x, enabled: !x.enabled } : x)); audit(f.enabled ? "Disabled feature flag" : "Enabled feature flag", `${f.key} (${f.env})`); });
  return (
    <div>
      <SectionHead title="Feature flags" desc="Roll capabilities out or back across environments. Changes are audited." />
      <PrivacyNote>Only <strong>Super Admins</strong> can toggle flags. Every change is written to the audit log with actor and time.</PrivacyNote>
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
    tokens: ["recipient_name", "inviter_name", "company_name", "role", "cta_link"],
    subject: "{{inviter_name}} invited you to {{company_name}} on Aster",
    body: "<p>Hi {{recipient_name}},</p>\n<p>{{inviter_name}} has invited you to join <strong>{{company_name}}</strong> on Aster as a {{role}}.</p>\n<p><a href=\"{{cta_link}}\">Accept the invite</a></p>" },
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

// Admin editor for the Tier 1 (platform) templates above. Reads any saved
// overrides for the platform scope, writes via the admin-only RPC.
function EmailTemplatesAdmin({ role, audit }) {
  const editable = can(role, "template.edit");
  const [templates, setTemplates] = useState(() => Object.fromEntries(PLATFORM_EMAIL_TEMPLATE_DEFS.map((t) => [t.key, { subject: t.subject, body: t.body }])));
  const [selected, setSelected] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
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

  const openTpl = (key) => { const t = templates[key]; setSelected(key); setSubject(t.subject); setBody(t.body); setMsg(""); setErr(""); setShowPreview(false); };
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
        <SectionHead title="Email templates" desc="System emails Aster sends to companies. Edited here, invisible to customers." />
        <PrivacyNote>These are <strong>platform</strong> emails (Aster → company). Companies cannot see or edit them. Aster's logo header and footer are added automatically, so edit only the HTML body.</PrivacyNote>
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
      <SectionHead title={def.name} desc={def.desc} />
      {msg && <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>{msg}</div>}
      {err && <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{err}</div>}
      <Card>
        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--ink-3)" }}>Subject</label>
        <input value={subject} onChange={(e) => { setSubject(e.target.value); setMsg(""); }} disabled={!editable}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 mb-4 disabled:opacity-60"
          style={{ border: "1px solid var(--line)", background: "#fff", "--tw-ring-color": "var(--brand)" }} />

        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold" style={{ color: "var(--ink-3)" }}>Body (HTML)</label>
          <button onClick={() => setShowPreview((s) => !s)} className="text-xs font-semibold" style={{ color: "var(--brand)" }}>{showPreview ? "Edit HTML" : "Preview"}</button>
        </div>

        {showPreview ? (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
            <p className="text-xs px-3 py-2" style={{ background: "#F7F7FB", color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>Subject: <span className="font-semibold text-neutral-800">{fillPlatformTokens(subject)}</span></p>
            <iframe title="Email preview" sandbox="" srcDoc={previewDoc} className="w-full" style={{ height: 240, border: 0, background: "#fff" }} />
            <p className="text-[11px] px-3 py-2" style={{ color: "var(--ink-3)" }}>Aster's logo header and footer are added automatically around this body.</p>
          </div>
        ) : (
          <>
            <textarea value={body} onChange={(e) => { setBody(e.target.value); setMsg(""); }} rows={12} disabled={!editable}
              className="w-full rounded-xl px-3.5 py-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 font-mono leading-relaxed resize-y disabled:opacity-60"
              style={{ border: "1px solid var(--line)", background: "#fff", "--tw-ring-color": "var(--brand)" }} />
            <div className="mt-3">
              <p className="text-[11px] mb-1.5" style={{ color: "var(--ink-3)" }}>Placeholders (filled when the email sends):</p>
              <div className="flex flex-wrap gap-1.5">
                {(def.tokens || []).map((tok) => (
                  <button key={tok} onClick={() => { if (editable) setBody((b) => `${b}{{${tok}}}`); }} disabled={!editable}
                    className="text-[11px] font-mono rounded-full px-2 py-0.5 disabled:opacity-50" style={{ border: "1px solid var(--line-strong)", color: "var(--brand)", background: "var(--brand-soft)" }}>
                    {`{{${tok}}}`}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

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
      <SectionHead title="Audit logs" desc="An immutable record of every administrative action." />
      <PrivacyNote>The audit log is <strong>append-only</strong>. It records who did what, when, and from where, including blocked attempts.</PrivacyNote>
      <TableShell head={["Actor", "Role", "Action", "Target", "When", "IP"]}>
        {audit.map((a) => (
          <tr key={a.id} className="adm-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <Td className="font-semibold text-neutral-900">{a.actor}</Td>
            <Td><Badge tone={a.role === "super" ? "brand" : a.role === "billing" ? "ok" : "info"}>{ROLE_META[a.role]?.short || a.role}</Badge></Td>
            <Td style={{ color: "var(--ink-2)" }}>{a.action}</Td>
            <Td className="text-neutral-900">{a.target}</Td>
            <Td className="tnum" style={{ color: "var(--ink-2)" }}>{a.at}</Td>
            <Td className="tnum" style={{ color: "var(--ink-3)" }}>{a.ip}</Td>
          </tr>
        ))}
      </TableShell>
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
          <div className="inline-flex items-center gap-2.5 mb-4">
            <AsterMark className="w-10 h-10" />
            <span className="adm-display font-bold text-lg text-neutral-900">Aster <span className="txt-grad">Admin</span></span>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid rgba(220,38,38,0.3)" }}>
            <Icon name="lock" className="w-3.5 h-3.5" /> Internal team access only
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
function AdminShell({ admin, section, go, onLogout, children }) {
  const rm = ROLE_META[admin.role];
  const nav = SECTIONS.filter((s) => s.roles.includes(admin.role));
  const [mobileNav, setMobileNav] = useState(false);
  return (
    <div className="adm min-h-screen flex" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside className={`adm-side fixed lg:static z-40 top-0 bottom-0 left-0 w-64 shrink-0 flex flex-col transition-transform ${mobileNav ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`} style={{ background: "var(--adm)", borderRight: "1px solid var(--adm-line)" }}>
        <div className="h-16 flex items-center gap-2.5 px-5 shrink-0" style={{ borderBottom: "1px solid var(--adm-line)" }}>
          <AsterMark className="w-8 h-8" />
          <span className="adm-display font-bold text-neutral-900">Aster <span className="txt-grad">Admin</span></span>
        </div>
        <div className="px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md tracking-wider" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icon name="shield" className="w-3 h-3" /> INTERNAL · PRODUCTION</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
          {nav.map((s) => {
            const on = s.key === section;
            return (
              <button key={s.key} onClick={() => { go(s.key); setMobileNav(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${on ? "" : "adm-nav-item"}`}
                style={{ background: on ? "var(--brand-soft)" : "transparent", color: on ? "var(--brand)" : "var(--ink-2)" }}>
                <Icon name={s.icon} className="w-[18px] h-[18px]" /> <span className="font-medium">{s.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3" style={{ borderTop: "1px solid var(--adm-line)" }}>
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl" style={{ background: "var(--adm-2)" }}>
            <span className="w-8 h-8 rounded-lg grad text-white text-xs font-bold inline-flex items-center justify-center shrink-0">{admin.name.split(" ").map((x) => x[0]).join("")}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-neutral-900 font-medium truncate">{admin.name}</p>
              <p className="text-[11px] truncate" style={{ color: rm.tint }}>{rm.label}</p>
            </div>
            <button onClick={onLogout} title="Sign out" className="p-1.5 rounded-lg" style={{ color: "var(--adm-ink)" }}><Icon name="logout" className="w-4 h-4" /></button>
          </div>
        </div>
      </aside>
      {mobileNav && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 flex items-center justify-between gap-3 px-4 sm:px-8 sticky top-0 z-20" style={{ background: "rgba(250,250,251,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNav(true)} className="lg:hidden p-2 rounded-lg" style={{ border: "1px solid var(--line)" }} aria-label="Open menu"><Icon name="dashboard" className="w-4 h-4" /></button>
            <div className="hidden sm:flex items-center gap-2 text-sm" style={{ color: "var(--ink-3)" }}>
              <span className="font-medium" style={{ color: "var(--ink-2)" }}>Admin</span><Icon name="chevronRight" className="w-3.5 h-3.5" /><span className="text-neutral-900 font-semibold capitalize">{SECTIONS.find((s) => s.key === section)?.label || section}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: TONE[admin.role === "super" ? "brand" : admin.role === "billing" ? "ok" : "info"].bg, color: TONE[admin.role === "super" ? "brand" : admin.role === "billing" ? "ok" : "info"].fg }}>
              <Icon name="shield" className="w-3.5 h-3.5" /> {rm.label}
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-[1200px] w-full mx-auto">{children}</main>
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
const ADMIN_PLAN_KEY = { Launch: "launch", Scale: "scale", Elite: "elite", Enterprise: "enterprise" };

export default function AdminPortal() {
  const [admin, setAdmin] = useState(null);
  const initial = typeof window !== "undefined" ? (window.location.pathname.replace(/^\/admin\/?/, "") || "dashboard") : "dashboard";
  const [section, setSection] = useState(SECTIONS.some((s) => s.key === initial) ? initial : "dashboard");

  // Live, mutable state so actions feel real and feed the audit log.
  const [companies, setCompanies] = useState(INIT_COMPANIES);
  const [subs, setSubs] = useState(INIT_SUBSCRIPTIONS);
  const [tickets, setTickets] = useState(INIT_TICKETS);
  const [flags, setFlags] = useState(INIT_FLAGS);
  const [audit, setAudit] = useState(INIT_AUDIT);
  const usage = INIT_USAGE;
  const [restoring, setRestoring] = useState(hasSupabase);

  useEffect(() => {
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
  const [users, setUsers] = useState(COMPANY_USERS);
  const reloadAdminData = async () => {
    if (!hasSupabase) return;
    const [{ data: co }, { data: us }] = await Promise.all([
      supabase.rpc("admin_company_detail"),
      supabase.rpc("admin_list_users"),
    ]);
    if (Array.isArray(co)) {
      setCompanies(co.map((c) => ({
        id: c.id, name: c.name, owner: "", region: c.region || "—",
        plan: ADMIN_PLAN_LABEL[c.plan] || c.plan,
        status: c.status, seats: Number(c.user_count) || 0,
        activeJobs: Number(c.active_jobs) || 0, candidates: Number(c.candidate_count) || 0,
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
        status: u.status, lastActive: u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : "—",
      })));
    }
  };
  useEffect(() => { if (admin) reloadAdminData(); /* eslint-disable-line */ }, [admin]);

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

  const logAudit = (action, target) => {
    if (!admin) return;
    setAudit((a) => [{ id: (a[0]?.id || 0) + 1, actor: admin.name, role: admin.role, action, target, at: "just now", ip: "10.2.4." + (admin.id === "a1" ? "11" : admin.id === "a2" ? "22" : "31") }, ...a]);
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

  // Load real support tickets once an admin who can see them is signed in.
  // Company name + requester are embedded via foreign keys; RLS returns every
  // company's tickets for super/support (billing has no support policy).
  useEffect(() => {
    if (!hasSupabase || !admin || !["super", "support"].includes(admin.role)) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, subject, channel, priority, status, body, company_id, requester_name, requester_email, created_at, updated_at, companies(name), requester:profiles(full_name)")
        .order("updated_at", { ascending: false });
      if (active && !error && data) setTickets(data.map(mapTicketRow));
    })();
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
      case "companies":     screen = <Companies role={role} companies={companies} setCompanies={setCompanies} audit={logAudit} onAction={runAdminAction} />; break;
      case "users":         screen = <Users role={role} companies={companies} users={users} setUsers={setUsers} audit={logAudit} onAction={runAdminAction} />; break;
      case "subscriptions": screen = <Subscriptions role={role} companies={companies} subs={subs} setSubs={setSubs} audit={logAudit} onAction={runAdminAction} />; break;
      case "usage":         screen = <Usage role={role} companies={companies} usage={usage} />; break;
      case "support":       screen = <Support role={role} companies={companies} tickets={tickets} onResolve={resolveTicket} onReply={replyToTicket} />; break;
      case "flags":         screen = <Flags role={role} flags={flags} setFlags={setFlags} audit={logAudit} onToggle={toggleFlag} />; break;
      case "email_templates": screen = <EmailTemplatesAdmin role={role} audit={logAudit} />; break;
      case "audit":         screen = <Audit audit={audit} />; break;
      default:              screen = <Dashboard role={role} companies={companies} tickets={tickets} audit={audit} go={go} />;
    }
  }

  const onLogout = async () => { if (hasSupabase) await supabase.auth.signOut(); setAdmin(null); };
  return <AdminShell admin={admin} section={section} go={go} onLogout={onLogout}>{screen}</AdminShell>;
}
