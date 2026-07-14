// E2E environment + safety gates.
// ---------------------------------------------------------------------------
// The dev server runs against whatever is in .env.local, which for this project
// is the LIVE Supabase project. That means an authenticated e2e run can create
// real jobs and candidates, spend real AI credits, and send real emails.
//
// So nothing destructive runs unless you explicitly turn it on. Three separate
// gates, from least to most expensive:
//
//   E2E_ALLOW_WRITES=1   create/edit/delete tenant rows (jobs, shortlists, stages)
//   E2E_ALLOW_AI=1       spend AI credits (apply-page parse, AI Rank, AI Insights)
//   E2E_ALLOW_EMAIL=1    send real email (invites, interview links, offers)
//
// Each gate also needs the matching sign-in credentials below. With no env set,
// only the public / read-only specs run and everything else is skipped with a
// reason, so `npm run e2e` is always safe to run cold.
//
// Point these at a THROWAWAY workspace (ideally a separate Supabase project),
// never at a customer tenant.

const bool = (v) => v === "1" || String(v).toLowerCase() === "true";

export const env = {
  baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",

  // Sign-in credentials, one per role. Omit a role to skip its specs.
  tenant: {
    email: process.env.E2E_TENANT_EMAIL || "",
    password: process.env.E2E_TENANT_PASSWORD || "",
  },
  manager: {
    email: process.env.E2E_HM_EMAIL || "",
    password: process.env.E2E_HM_PASSWORD || "",
  },
  interviewer: {
    email: process.env.E2E_INTERVIEWER_EMAIL || "",
    password: process.env.E2E_INTERVIEWER_PASSWORD || "",
  },

  // An OPEN job in the test workspace, used by the public apply-page specs.
  // Find it in the URL of its apply link: /apply/<jobId>.
  applyJobId: process.env.E2E_APPLY_JOB_ID || "",
  // A DRAFT job, for the draft apply-page preview spec (optional).
  draftJobId: process.env.E2E_DRAFT_JOB_ID || "",

  // Safety gates.
  allowWrites: bool(process.env.E2E_ALLOW_WRITES),
  allowAI: bool(process.env.E2E_ALLOW_AI),
  allowEmail: bool(process.env.E2E_ALLOW_EMAIL),
};

export const hasCreds = (role) => Boolean(env[role]?.email && env[role]?.password);

// Reasons, so a skipped test tells you exactly which knob to turn.
export const needCreds = (role) =>
  `Set E2E_${role === "manager" ? "HM" : role.toUpperCase()}_EMAIL / _PASSWORD to run this.`;
export const NEED_WRITES = "Set E2E_ALLOW_WRITES=1 (creates/edits real rows in the target workspace).";
export const NEED_AI = "Set E2E_ALLOW_AI=1 (spends real AI credits).";
export const NEED_EMAIL = "Set E2E_ALLOW_EMAIL=1 (sends real email).";

// Unique, obviously-test-owned names so a failed run is easy to find and purge.
export const tag = () => `e2e-${Date.now().toString(36)}`;
export const testName = (what) => `E2E ${what} ${tag()}`;
