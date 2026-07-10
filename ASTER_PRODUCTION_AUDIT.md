# Aster — Production Readiness Audit

**Started:** 2026-07-10
**Auditor:** Claude (Senior QA / PM / Security / Full-Stack)
**Verdict so far:** 🔴 **NOT production-ready.** Blockers listed in `ASTER_REMAINING_WORK.md`.

---

## 0. Method, and what "tested" honestly means here

This audit is run from a terminal with repo access, a Supabase anon key, and the
Supabase CLI. There is **no browser automation and no seeded test account**, so I
cannot literally click every button.

Every finding is therefore tagged:

| Tag | Meaning |
|---|---|
| **VERIFIED** | I executed something that proves it (build, lint, live HTTP call, SQL read). |
| **CODE-REVIEW** | I read the code and am confident, but did not execute the path. |
| **NEEDS-BROWSER** | Requires a running app + real accounts. Repro steps given; not claimed as tested. |

Nothing below is marked VERIFIED unless a command in this session produced the evidence.

---

## 1. Application map

### 1.1 Screens (29 rendered by the router)

Router is a hand-rolled `screen === "x"` switch in `src/resume-ai-preview.jsx`,
with `PATH_TO_SCREEN` (line ~16630) mapping URLs to screens.

**Public / marketing (prerendered, 77 routes):**
`landing`, `product`, `solutions`, `blog`, `glossary`, `compare`, `trust`, `legal`, `gettingStarted`

**Auth:** `login`, `signup`, `forgotPassword`, `acceptInvite`

**Public token-gated (no login):** `apply`, `bookInterview`, `schedulePicker`, `publicOffer`

**Workspace (should require auth):** `dashboard`, `upload`, `jobs`, `applicants`, `candidates`,
`candidateProfile`, `search`, `interviews`, `interviewers`, `billing`, `profile`,
`settings`, `emailTemplates`

**Sidebar nav exposes only 5 of the 13 workspace screens** (`NAV_ITEMS`, line 7116):
dashboard, upload, jobs, search, interviewers. The rest are reached from the icon
rail footer (profile, billing, settings) or contextually. `emailTemplates`,
`applicants`, `interviews`, `candidates`, `candidateProfile` have no primary nav entry.

### 1.2 Backend surface

- **40 migrations** (`supabase/migrations/`), **21 edge functions**
- Single React file: **18,258 lines** (`src/resume-ai-preview.jsx`)
- Storage buckets: `resumes` (private), `logos` (public read)

### 1.3 Edge function auth posture — **VERIFIED** (static analysis of all 21)

| Gate | Functions |
|---|---|
| Authenticated user (`auth.getUser`) | create-checkout-session, create-portal-session, parse-resume, rank-candidates, analyze-experience, delete-account, send-interview-invite, send-offer, send-stage-email, send-teammate-invite, send-welcome, support-reply |
| Token / signature gated | stripe-webhook (HMAC), purge-workspaces (`x-purge-key`), confirm-booking, respond-offer, parse-application, marketing-chat, scheduled-emails |
| **No caller check** | `get-plan-prices` (intentional — public list prices), `support-intake` (public form) |

**Note:** Supabase's gateway accepts the **anon key as a valid JWT**. "No caller check"
therefore means *anyone on the internet* can invoke it. Both cases above are
intentionally public, but `support-intake` has no rate limiting (see #9).

---

## 2. Findings

Severity: **Critical** (money/data loss/cross-tenant) · **High** (broken core workflow or
security weakness) · **Medium** · **Low**.

---

### #1 — Production is in a broken intermediate state
- **Area:** Deployment / billing
- **Severity:** 🔴 **Critical**
- **Status:** Found — **needs your action**
- **Evidence:** **VERIFIED.** `git log` shows `6fbf132` pushed. Migrations `0033`–`0037`,
  `0039`, `0040` exist as files but have never been applied. `stripe-webhook` was
  deliberately not deployed.
- **Problem:** The shipped client sends `plan: "launch"`. The deployed `stripe-webhook`
  still maps `free/growth/pro` and does not recognise `"launch"`, so `planEnum` resolves
  to `null` and `companies.plan` is never updated.
- **Impact:** **A customer completing checkout right now is charged and never upgraded.**
  Money taken, no product delivered.
- **Fix:** Run `0039` then `0040` in the SQL editor, then deploy `stripe-webhook`.
  `0040` *must* recreate the eight `_*_limit()` functions — a bare `ALTER TYPE ... RENAME
  VALUE` leaves their bodies referencing dead literals, and they then return `null`,
  which `planLimits()` reads as **unlimited**.
- **Files:** `supabase/migrations/0040_rename_plan_tiers.sql`, `supabase/functions/stripe-webhook/index.ts`
- **DB impact:** `plan_tier` enum rename; 9 functions recreated.
- **Security impact:** None directly, but see #2.

---

### #2 — `planLimits()` failed open: unknown plan granted Elite limits
- **Area:** Plan enforcement
- **Severity:** 🔴 **Critical**
- **Status:** **Fixed** (uncommitted)
- **Evidence:** **VERIFIED** by reading `src/resume-ai-preview.jsx:8088` before the fix:
  ```js
  const planLimits = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.professional;
  ```
- **Problem:** Any unrecognised plan string — a typo, a stale enum, a partially-applied
  migration, a `null` — silently received the **most generous** tier's limits: unlimited
  seats, 1,000 parses/mo, WhatsApp, priority support.
- **Root cause:** Fallback chose the top tier instead of the bottom one. After the
  `professional → elite` rename the key vanished, turning a silent privilege grant into a
  loud `TypeError` (`Cannot read properties of undefined (reading 'resumeUploads')`),
  which is how it was found.
- **Fix applied:** Fall back to `PLAN_LIMITS.launch` (most restrictive). Added
  `PLAN_TIER_ALIASES` so the client tolerates a pre-`0040` database.
- **Files:** `src/resume-ai-preview.jsx` (lines ~22, ~52, ~8096)
- **Test result:** `npx vite build` passes. **NEEDS-BROWSER** to confirm the dashboard renders.

---

### #3 — No role-based access control in the client
- **Area:** Permissions
- **Severity:** 🟠 **High** (pending RLS confirmation — see #4)
- **Status:** Found
- **Evidence:** **VERIFIED.** Grepping the entire 18k-line app for
  `role === "owner" | "admin" | "recruiter" | "interviewer"`, `isOwner`, `isAdmin`,
  `canManage` returns **one** hit (`line 6330`) — and it is a display label on the
  invite screen, not a gate.
- **Problem:** `profile_role` exists in the database (owner/admin/recruiter/interviewer),
  but the UI renders identically for every role. An interviewer signing in sees the full
  recruiter workspace: Jobs, Billing, Settings, Candidate Search, Resume Upload.
- **Impact:** Whether this is a *vulnerability* or only a *UX defect* depends entirely on
  whether RLS restricts these tables per-role. If RLS only scopes by company (likely),
  then **an interviewer can read every candidate in the company and open Billing.**
- **Fix (proposed, needs decision):** This is an architecture change — see §4.
- **Files:** `src/resume-ai-preview.jsx`, all workspace screens

---

### #4 — Unauthenticated visit to `/dashboard` renders the app shell
- **Area:** Auth / routing
- **Severity:** 🟡 **Medium** (not a data leak; RLS returns no rows)
- **Status:** Found
- **Evidence:** **CODE-REVIEW.** `applySession()` (line ~17475) does
  `if (!session) { setRestoring(false); return; }` and never navigates. No guard runs
  before the workspace render. There is no `navigate("login")` on the unauthenticated path.
- **Problem:** Typing `/dashboard` while signed out shows the sidebar, headers and empty
  panels rather than redirecting to `/login`.
- **Impact:** No cross-tenant data exposure (RLS denies every read without a JWT), but it
  looks broken and leaks the app's internal structure.
- **Fix:** Bounce to `/login` when `!session` and the target screen is a workspace screen.
- **Files:** `src/resume-ai-preview.jsx` (~17475, and the render guard near `if (restoring)`)

---

### #5 — Zero automated tests
- **Area:** Technical quality
- **Severity:** 🟠 **High**
- **Status:** Found
- **Evidence:** **VERIFIED.** `package.json` has no `test` script. No `vitest.config`,
  `jest.config`, or `playwright.config`. `find` for `*.test.*` / `*.spec.*` / `__tests__`
  returns nothing.
- **Problem:** The task asked to "run all available tests". **There are none.** Every
  billing, credit-metering and permission rule in this codebase is unverified by any
  automated check, on a codebase that handles real card payments.
- **Fix:** Add Vitest + a Playwright smoke suite. Highest-value first: webhook idempotency,
  credit metering, cross-company RLS, checkout→activate.

---

### #6 — 117 ESLint errors, 9 warnings
- **Area:** Technical quality
- **Severity:** 🟡 **Medium** (individually), 🟠 **High** in aggregate
- **Status:** Found
- **Evidence:** **VERIFIED.** `npx eslint .` → `126 problems (117 errors, 9 warnings)`

| Rule | Count | Risk |
|---|---:|---|
| `no-unused-vars` | 62 | Dead code; some are abandoned handlers |
| `no-use-before-define` | 24 | Includes `hydrateWorkspace` used before defined (17360) |
| `react-hooks/set-state-in-effect` | 16 | Cascading renders; possible duplicate fetches |
| `react-hooks/exhaustive-deps` | 8 | Stale closures — a real source of "didn't save" bugs |
| `react-hooks/static-components` | 6 | Remounts subtree each render (state loss) |
| `react-hooks/immutability` | 4 | Direct state mutation |
| `react-hooks/purity` | 2 | Render-phase side effects |
- **Note:** `_drop` (17739) and `_applyLimits` (18008) are assigned and never used —
  candidates for abandoned features. To be inspected in Phase 5.

---

### #7 — Secrets hygiene: clean
- **Area:** Security
- **Severity:** ✅ **Pass**
- **Evidence:** **VERIFIED.** `grep` over `dist/assets/*.js` for
  `service_role|sk_live_|sk_test_|whsec_|ANTHROPIC|RESEND_API|SUPABASE_SERVICE` →
  only the string `"Anthropic"` (a UI label). `.env` and `.env.*` are git-ignored;
  `git ls-files` shows only `.env.example` tracked. Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` reach the browser, both public by design.
- **Caveat:** A **live Stripe secret key was pasted into a chat transcript** earlier in
  this project's history and has since been **rotated**. Confirmed rotated.

---

### #8 — Storage is correctly locked down
- **Area:** Security / storage
- **Severity:** ✅ **Pass**
- **Evidence:** **VERIFIED** by reading `0002_storage_and_seed.sql` and `0022_company_billing_details.sql`.
  - `resumes` bucket: `public = false`, four policies scoping every operation to
    `(storage.foldername(name))[1] = current_company_id()::text`.
  - Client reads via `createSignedUrl` (`resume-ai-preview.jsx:230`), never `getPublicUrl`.
  - `logos` bucket is `public = true` with public read — appropriate; writes are still
    company-scoped.
- **Note:** `0002_storage_and_seed.sql` seeds only `feature_flags`. **No demo rows.**
  The `supabase/seed/*.sql` files are manual-run only; nothing in `package.json` or
  `.github/workflows/` invokes them. **Seed data cannot reach production accidentally.**

---

### #9 — `support-intake` is unauthenticated and unthrottled
- **Area:** Abuse
- **Severity:** 🟡 **Medium**
- **Status:** Found
- **Evidence:** **VERIFIED** (static). It is one of only two functions with no caller
  check, and it sends email via Resend.
- **Problem:** Anyone can POST to it in a loop, burning your Resend quota and
  potentially using you as a spam relay if any field reaches the recipient unescaped.
- **Fix:** Add a rate limit (per-IP or per-email) and a CAPTCHA/turnstile on the form.

---

## 3. In progress

Four parallel deep-dive agents are auditing:

1. **RLS + Supabase security** — per-table policy coverage, SECURITY DEFINER validation,
   IDOR, role escalation via `profiles.role`
2. **Mock data + fake handlers** — exhaustive sweep for placeholder behaviour
3. **Roles, permissions, workflow completeness** — client vs server gate parity, seat/plan
   limit enforcement
4. **Billing + credits** — webhook idempotency/replay, credit manipulation, metering
   correctness, trial abuse, promo codes

Their findings will be appended as #10 onward.

---

## 4. Decisions needed from you (per instruction §10, no blind changes)

### D1 — Role-based access control
Roles exist in the schema but are unenforced in the UI, and possibly unenforced in RLS.
Implementing RBAC touches every workspace screen plus RLS policies on `candidates`,
`jobs`, `bookings`, `subscriptions`.
**Recommendation:** first confirm what RLS already blocks (agent running), then gate the
UI to match. Do not weaken any policy to make a screen work.

### D2 — Credit top-ups, one-time packages, invoices
The brief asks me to test these. **Preliminary read: they do not exist.** There is no
top-up table, no credit-purchase flow, no invoice generation (invoices now come from
Stripe's hosted portal). Confirm whether these are (a) out of scope, or (b) unbuilt
features that must be listed as missing.

### D3 — Webhook idempotency
`stripe-webhook` has no processed-event table. Stripe retries on any non-2xx. Adding
idempotency is a schema change (`stripe_events` table) plus a webhook rewrite.
**Recommendation:** do it before taking real payments.

---

## 5. Test log

| # | Check | Command | Result |
|---|---|---|---|
| T1 | Production build | `npx vite build` | ✅ Pass |
| T2 | Prerender (77 routes) | `node scripts/prerender.mjs` | ✅ 77/77 |
| T3 | Lint | `npx eslint .` | ❌ 117 errors, 9 warnings |
| T4 | Type check | — | N/A (no TypeScript in `src/`) |
| T5 | Unit tests | — | ❌ None exist |
| T6 | E2E tests | — | ❌ None exist |
| T7 | Secrets in bundle | `grep dist/assets/*.js` | ✅ Clean |
| T8 | Live prices match Stripe | `curl get-plan-prices` | ✅ 3 plans × 2 cycles, 20% yearly |
| T9 | Edge fn auth posture | static scan, 21 fns | ⚠️ 2 public (both intentional) |

---

# Phase 2–5 findings (all four agents complete)

I independently re-verified every Critical claim against the source before recording it.
Items I could not personally confirm are marked CODE-REVIEW.

---

### #10 — 🔴 CRITICAL — Password reset does not exist. Users are permanently locked out.
- **Status:** ✅ **FIXED**
- **Evidence: VERIFIED.** `grep -rn "resetPasswordForEmail" src/` → **zero matches.**
  `sendLink` was `setTimeout(() => setStep("sent"), 900)`. A button labelled **"Open reset link"**
  called `setStep("reset")`, faking the emailed link. `submitNewPassword` was another `setTimeout`.
  The comment read `// Stand-in for POST /auth/reset-password`.
- **Impact:** Anyone who forgets their password sees "Check your email", receives nothing, and can
  never recover the account. There is no support path.
- **Fix applied:** `resetPasswordForEmail(email, { redirectTo })`, with the error deliberately
  swallowed so the response cannot be used to enumerate accounts. A `PASSWORD_RECOVERY` listener
  (plus a `type=recovery` hash check for cold loads) advances to the reset step.
  `submitNewPassword` now calls `updateUser({ password })` and reports expired links honestly.
  The fake "Open reset link" button is deleted.
- **Files:** `src/resume-ai-preview.jsx` (~1038–1160)
- **Retest:** NEEDS-BROWSER — request a reset, click the emailed link, set a password, sign in.

### #11 — 🔴 CRITICAL — "Update password" changed nothing
- **Status:** ✅ **FIXED**
- **Evidence: VERIFIED.** `handleChangePassword` validated the three fields, then ran
  `setPwMsg({ type: "ok", text: "Password updated." })`. **No Supabase call of any kind.**
- **Impact:** A user rotating a compromised password did not rotate it. Worse than useless — it
  actively creates false confidence.
- **Fix applied:** Re-authenticate with `signInWithPassword` (because `updateUser` does **not**
  verify the current password — without this an unattended session could be taken over), then
  `updateUser({ password })`. The button disables while in flight.
- **Files:** `src/resume-ai-preview.jsx` (~14248, 14469)

### #12 — 🔴 CRITICAL — "Reject without email" sent the rejection email anyway
- **Status:** ✅ **FIXED**
- **Evidence: VERIFIED.** `setStage(candidateId, stage, emailSent)` stored `emailSent` in a local
  badge, then called `onStageChange(candidateId, stage)` — **dropping the third argument.**
  `setCandidateStage(candidateId, stage, { notify = true } = {})` therefore defaulted to
  `notify = true` and fired `send-stage-email`.
- **Impact:** The recruiter explicitly chose "Reject without email". The candidate received a
  rejection email. The badge read "No email sent." Unrecoverable, and a plausible PDPA/GDPR complaint.
- **Fix applied:** Forward the choice as `{ notify: emailSent !== false }`.
- **Subtlety worth recording:** the third parameter is an **options object**. My first patch passed
  the bare boolean `false`, which destructures to `notify = true` — silently recreating the exact
  bug. Caught before commit.
- **Files:** `src/resume-ai-preview.jsx` (~16215)

### #13 — 🟠 HIGH — `bump_resume_parse_for` / `resume_parse_usage_for` callable by anyone, on any company
- **Status:** Fix written (`0041` §1), **not applied**
- **Evidence: VERIFIED.** Both are `SECURITY DEFINER` (so they bypass RLS), take `p_company uuid`
  as a parameter, and never check `auth.uid()`. `0034_resume_parse_metering.sql` contains exactly
  **one** grant line — and it is for a different function. Postgres defaults `EXECUTE` to `PUBLIC`.
- **Exploit:** `rpc('bump_resume_parse_for', { p_company: '<victim uuid>' })` in a loop zeroes a
  competitor's monthly parse allowance. `resume_parse_usage_for` discloses any company's usage and
  plan tier. Company UUIDs are semi-public — they appear in apply-page URLs and logo paths.

### #14 — 🔴 CRITICAL — Cancelling a subscription revokes nothing
- **Status:** **Needs decision (D1)**
- **Evidence: VERIFIED.** `stripe-webhook` sets `companies.status = 'churned'` and nothing else.
  `companies.status` is referenced by **zero policies** across all 40 migrations.
  `current_company_id()` gates on `p.status = 'active' and c.deleted_at is null` only.
- **Impact:** Cancel your plan and keep full access to the workspace forever, for free.
  A lapsed *trial* is locked out (`suspend_expired_trials` sets `deleted_at`); a lapsed
  *paying customer* is not.

### #15 — 🟠 HIGH — Plan limits and AI credits are cosmetic
- **Status:** Needs decision (D4)
- **Evidence: VERIFIED.** For `rank-candidates` and `analyze-experience`,
  `grep -cE "bump_|_usage|_limit|rpc\("` returns **0**. Both verify the JWT, then call Anthropic.
  The counter is bumped **by the browser**. `jobs_admin` RLS is
  `for all using (company_id = current_company_id() and is_company_admin())` with no count check,
  and there is no job-count trigger. `bump_job_post` is a client-called RPC.
- **Impact:** `supabase.from('jobs').insert(...)` creates unlimited open roles. Invoking
  `rank-candidates` directly gives unlimited AI ranking and uncapped Anthropic spend.
  Only `parse-resume` meters server-side.

### #16 — 🟠 HIGH — "Run AI matching" charges a credit and runs no AI
- **Status:** Found, not yet fixed
- **Evidence: VERIFIED.** `ApplicantsScreen.runMatching` (~16195) is a 1.4s `setTimeout` that reads
  `MOCK_MATCHES[activeJobId]`, then calls `supabase.rpc("bump_ai_rank")`. `MOCK_MATCHES` is only
  populated from `applications.match_score`, and `grep -rln "match_score" supabase/functions/`
  returns **nothing** — no edge function ever writes it. So in a real workspace the list is always
  empty.
- **Impact:** The user clicks "Run AI matching", watches a spinner, **spends a metered monthly
  credit**, and receives nothing. `SearchScreen.runRoleMatch` does it correctly via `rank-candidates`.

### #17 — 🟠 HIGH — Fake success on real actions (silent data loss) — CODE-REVIEW

| Action | What actually happens |
|---|---|
| Remove teammate / interviewer | `setInterviewers(filter)` only. No DB write, **no access revoked.** Returns on reload. |
| Profile name / phone / avatar | Local state only. No `profiles` update; no avatar upload helper exists. |
| Settings save (calendar, notifications) | `setTimeout` → local state. Nothing persisted. `calendarConnected` even defaults to `true`. |
| Calendar "Connect" / WhatsApp "Connect" | `setTimeout` → sets a flag. No OAuth, no token, no integration. |
| "AI Auto Schedule" slots | `generateMockSlots()` — five invented weekday slots. No free/busy query. Can collide with real events. |
| Admin portal: suspend company, reset password, deactivate user, change plan | No Supabase branch at all. React state only; the audit log is client-side. |
| Notification read-state | Local only. There is **no notifications table** — `buildActivities()` synthesises items with hardcoded "1h ago" timestamps. |

### #18 — 🟡 MEDIUM — Interview scheduling oversells what exists
Reschedule and cancel: **no handler exists.** Timezone hardcoded `Asia/Kuala_Lumpur`.
No calendar event, no `.ics`, no Meet link (`meeting_link: ""`). Reminders are UI toggles;
the cron sends only `weekly_digest` and `trial_ending`.

### #19 — 🟡 MEDIUM — Dashboard numbers are partly fabricated
KPI "% change" badges compare against a hardcoded baseline
`prevPeriod = { totalCandidates: 6, openJobs: 2, … }`. Five of six sparklines use a flat
placeholder series. The plan-usage meter reads **pipeline stats** for 4 of 5 credit rows
(AI Rank shows `stats.matches`; AI Insights shows `stats.inInterview`). `aiInsightsUsed` and
`seeWhyUsed` are never hydrated on load, so those caps reset to 0 on every refresh — and
**no `bump_ai_insight` RPC exists at all**, so AI Insight spend is entirely uncapped.

### #20 — 🟡 MEDIUM — Admin portal renders seed data in production
`INIT_COMPANIES`, `COMPANY_USERS`, `INIT_SUBSCRIPTIONS`, `INIT_USAGE`, `INIT_AUDIT` are never
loaded from the database. MRR, revenue, usage and company tables show fabricated numbers **in
production**. Only tickets and platform flags are real.

### #21 — ✅ Confirmed sound (no action needed)
- Every `public` table has RLS enabled; **no policy permits cross-company read or write.**
- Interviewers are correctly scoped to assigned jobs via `assigned_job_ids()`.
- Non-admins **cannot** escalate their own role (no self-update policy exists). Admins can — `0041` §3.
- Billing edge functions correctly reject non-owner/admin with 403.
- `subscriptions` and `usage_counters` have no customer UPDATE policy.
- `bump_ai_rank` / `bump_see_why` / `bump_job_post` take **no company parameter** and are atomic
  under `SELECT … FOR UPDATE`. They cannot target another tenant, and only consume, never grant.
- Job CRUD, public application, pipeline persistence, offer send, teammate invite/accept,
  bulk-parse metering, and Stripe checkout/portal/prices are all **genuinely real**.
- Usage is a rolling 30-day cycle keyed on `companies.created_at`. **No plan-cycling credit farm.**
- Resume storage: private bucket, folder-scoped RLS, signed URLs. No secrets in the shipped bundle.

---

## Test log (continued)

| # | Check | Result |
|---|---|---|
| T10 | `grep resetPasswordForEmail src/` | 0 matches → #10 |
| T11 | `grep match_score supabase/functions/` | 0 matches → #16 |
| T12 | `grep companies.status` in policies | 0 matches → #14 |
| T13 | `grep -cE "bump_\|_usage\|_limit" rank-candidates` | 0 → #15 |
| T14 | grant/revoke lines in `0034` | 1 line, wrong function → #13 |
| T15 | Build after #10/#11/#12 | ✅ Pass |
