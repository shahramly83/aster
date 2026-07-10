# Aster — Remaining Work

**Only unresolved items.** Updated 2026-07-10.

**Verdict: every Critical/High finding that could take money, lose data, or cross a
tenant boundary is fixed and applied to production (migrations through 0049).**
What remains needs a browser, a test database, or your Stripe/Supabase dashboards
— none of it is code I can write and verify from here.

## ✅ Done this audit (all applied + deployed)
Password reset & change (were no-ops) · rejection-email-on-"reject-without-email" ·
notification badge (was hardcoded "2") · remove-teammate (revoked nothing) ·
profile/settings persistence · fake Calendar/WhatsApp "Connect" buttons ·
"Run AI matching" charging for a no-op · credit-zeroing IDOR (0041) ·
admin→owner self-escalation (0041) · draft-job leak (0041) · churn now revokes
access (0045) · dropped-Stripe-payment on failed write · AI Rank/Insight + resume
+ job-post limits all enforced server-side (0046/0047) · webhook replay window +
dedupe + constant-time compare (0048) · admin portal's four actions made real,
role-gated (0049) · first automated tests (18, signature + fail-closed limits) ·
W4 unauthenticated-workspace redirect to /login · Playwright browser suite (45
E2E: public/responsive audit on 3 viewports + auth-guard on 5 routes).

## 🔴 NEW CRITICAL — auth email delivery (found in live testing)
Email confirmation is required but no custom SMTP was configured, so Supabase used its
built-in emailer (testing-only, ~2-4/hour, unreliable). That meant new customers could not
complete signup, and the password reset fixed in code today would not deliver. Fix: point
Supabase Auth SMTP at Resend (smtp.resend.com:465, user `resend`, pass = RESEND_API_KEY,
verified sender). Status: user configuring.

## 🙋 Only you can do these (dashboards)
1. **Stripe events** — add `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed` to the webhook endpoint. Churn and past-due are inert
   without them (your cancellation test proved it).
2. **B4 — activate the Stripe Customer Portal** (Settings → Billing → Customer
   portal). "Manage billing" 502s until you do.
3. **Verify grants** — run the `0046`/`0041` proacl query; confirm `refund_*_for`
   and `bump_resume_parse_for` show `service_role` only, no `authenticated`.
4. **Verify the admin portal** — log in as super-admin, click each of the four
   actions once. They are cross-tenant writes I could not test.

## 🖥️ Need a browser (Phases 6 & 7)
- ✅ **Public/responsive audit at 320–1440px — done** via Playwright (`npm run e2e`,
  `tests/e2e/public-audit.spec.js`). All public routes clean across three viewports.
- ✅ **Auth-guard (W4) fixed and covered** (`tests/e2e/auth-guard.spec.js`).
- ⏳ Workspace-screen responsive audit + empty-database regression + every-button
  click-through: still blocked on a confirmed test login (email-confirmation / SMTP).
  Harness is in place; add a seeded account and extend the specs.

## 🧪 Need a local Postgres (deeper tests)
- Metering atomicity, RLS cross-company isolation, the trigger in 0047, the admin
  role gates in 0049 — all need pgTAP or an integration DB, not Node/Vitest.

---

## 🔴 Production blockers

| # | Item | Why it blocks |
|---|---|---|
| ~~B1~~ | ~~Migrations unapplied; `stripe-webhook` not deployed~~ | ✅ **RESOLVED.** All migrations through `0044` applied and recorded; `stripe-webhook` deployed. Also fixed a worse latent bug found on the way: the webhook discarded both `update()` errors and returned 200 regardless, so Stripe never retried — a failed write silently dropped a real payment. It now returns 500 and Stripe retries for up to 3 days. |
| ~~B2~~ | ~~Cancelling a subscription revokes nothing~~ | ✅ **RESOLVED (D1).** `0045` applied + webhook deployed. Churn now stamps `deleted_at` + `purge_after` (30-day window), landing the customer on the existing paywall with a way back. `restore_workspace()` refuses `churned` as well as `suspended` — without that, the fix would have handed a cancelled customer a one-click "Restore workspace" button. The cancel UPDATE is guarded with `.is("deleted_at", null)` so a replayed event can't slide the purge date. |
| **B3** | Zero automated tests | No `test` script, no vitest/jest/playwright config, no `*.test.*` files. Every billing, credit and permission rule is unverified. On a codebase taking card payments. |
| **B4** | Stripe Customer Portal not activated | `create-portal-session` is deployed but returns 502 until you activate the portal in Stripe → Settings → Billing → Customer portal. "Manage billing" is dead until then. |
| **B5** | `stripe-webhook` has no replay window and no event dedupe | `t` is parsed from the signature and never compared to `now()`; the HMAC compare is not constant-time. A captured `(body, signature)` pair verifies forever, and can re-flip `status='active'` / clear `deleted_at`. See D3. |

---

## 🔒 Security risks

| # | Sev | Item | Fix |
|---|---|---|---|
| ~~S1~~ | High | ~~`bump_resume_parse_for` / `resume_parse_usage_for` callable by anyone, on any company.~~ | ✅ **FIXED** — `0041` §1 applied. Verify: `proacl` should show `service_role` only. |
| ~~S2~~ | Medium | ~~A company admin can promote themselves to `owner`.~~ | ✅ **FIXED** — `0041` §3 applied. |
| ~~S3~~ | Medium | ~~`get_public_job` serves unpublished drafts, and jobs in soft-deleted workspaces.~~ | ✅ **FIXED** — `0041` §2 applied. Closed/expired roles still resolve, so the apply page can still say "this role has closed". |
| **S4** | Medium | `stripe-webhook` verifies the HMAC but **never checks the timestamp**. `t` is parsed and discarded. A captured `(body, signature)` pair verifies forever. No event-id dedupe table either. Comparison is not constant-time. | Needs decision — see D3 |
| **S5** | Medium | `parse-application` is public, **unmetered and unthrottled**. Anyone with a public apply-page UUID can submit unlimited resumes, each firing several paid Claude calls. Its own README says "add rate limiting before a public launch." | Reuse the `chat_rate_hit` throttle |
| **S6** | Medium | `support-intake` is public with **no rate limit**, and sends email via Resend. Spam/quota-burn vector. | Rate limit + turnstile |
| ~~S7~~ | Low | ~~`_free_trial_used(text)` is PUBLIC-callable.~~ | ✅ **FIXED** — `0041` §1 applied. |
| **S8** | Low | `marketing-chat`'s rate limiter **fails open**: if the DB is unreachable, throttling silently disables on a public Anthropic endpoint. | Fail closed |
| **S9** | Low | Consumer-email trial farming: business domains are recorded in `domain_grants`, but gmail/outlook users are never domain-blocked. A fresh gmail = a fresh 14-day Scale trial, unlimited. Purged workspaces never record their email hash, so the same address can trial again after purge. | Accepted risk? |

**Confirmed sound** (no action): every `public` table has RLS enabled; no policy permits cross-company read/write; `resumes` bucket is private, folder-scoped, served by signed URL; no secrets in the shipped bundle; `usage_counters` has no customer UPDATE policy; the `bump_ai_rank`/`bump_see_why`/`bump_job_post` RPCs take no company parameter and are atomic under `FOR UPDATE`.

---

## ⚙️ Broken workflows

| # | Sev | Item |
|---|---|---|
| **W1** | High | **Plan limits are cosmetic.** `maxJobs` is enforced only by the client calling `bump_job_post`. RLS `jobs_admin` permits any insert by a company admin, and no trigger counts jobs. `supabase.from('jobs').insert(...)` creates unlimited open roles. |
| **W2** | High | **AI credits are cosmetic.** `rank-candidates` and `analyze-experience` verify the JWT and then call Anthropic. Neither checks or bumps a counter — the browser does it. Call the function directly for unlimited AI ranking and uncapped Anthropic spend. Only `parse-resume` meters server-side. |
| **W3** | Medium | **`parse-resume` metering is TOCTOU.** `resume_parse_usage_for()` then `bump_resume_parse_for()` are two round-trips in two transactions, and the bump re-checks nothing. N concurrent uploads at `limit-1` all pass and all bump. The other bumps are atomic; this one isn't. |
| ~~W4~~ | Medium | ✅ **FIXED.** Unauthenticated deep-links to workspace-only screens (`/dashboard`, `/candidates`, `/jobs`, `/billing`, `/settings`, …) now redirect to `/login` instead of rendering the app shell over demo data. Guard lives in the session-restore no-session branch, backed by a render-time fallback (`WORKSPACE_SCREENS`). Reproduced and locked in by `tests/e2e/auth-guard.spec.js` (5 routes × 3 viewports). |
| **W5** | Medium | **No role-based access control in the UI.** One `role ===` check exists in 18k lines, and it's a label. An interviewer sees Jobs, Billing, Settings, Candidate Search. RLS does scope interviewers to assigned jobs for candidates — but Billing and Settings are wide open. |

---

## 🔌 Missing integrations / features

| # | Item | Status |
|---|---|---|
| **M1** | Credit top-ups / one-time credit packages | **Do not exist.** `create-checkout-session` is hardcoded `mode: "subscription"`. No top-up table, no purchase flow, no RPC that adds credits. |
| **M2** | In-app invoice generation | **Does not exist by design** — delegated to Stripe's hosted portal (blocked by B4). |
| **M3** | Promo codes | `allow_promotion_codes: true` is passed to Stripe. **The app validates nothing.** Reuse limits, expiry and stacking live entirely in Stripe's coupon config. Cannot be verified from this codebase. |
| **M4** | WhatsApp reminders | Advertised on the Elite plan. **Not audited yet** — no integration found in `supabase/functions/`. Needs confirmation. |
| **M5** | Calendar integration | `confirm-booking` exists; Google/Microsoft OAuth and event creation not yet traced. |

---

## 💳 Billing & credits

| # | Item |
|---|---|
| **C1** | Webhook replay: no timestamp tolerance, no event-id dedupe (S4). Nothing *increments*, so replay can't double-credit — but it **can re-flip `status='active'` and clear `deleted_at`**, resurrecting a suspended workspace. |
| **C2** | Churn does not reclaim over-limit resources (jobs above the new cap stay open). |
| **C3** | Monthly reset is a **rolling 30-day cycle from `companies.created_at`**, not a calendar month. Upgrading mid-cycle preserves usage rather than resetting it. No plan-cycling credit farm exists. ✅ Verified sound. |

---

## 📱 UI & mobile

**Phase 6 started — public surfaces pass.** A Playwright browser suite now audits
every public route (`/`, `/product`, `/solutions`, `/blog`, `/compare`, `/trust`,
`/getting-started`, `/login`, `/signup`, `/forgot-password`) across desktop
(1440px), tablet (iPad Mini / WebKit) and mobile (iPhone SE / WebKit): all render
real content, with **no horizontal overflow and no console errors** on any
viewport. See `tests/e2e/public-audit.spec.js`. Run with `npm run e2e`.

**Still needs a browser + a signed-in session:** the authenticated workspace
screens (dashboard, candidates, jobs, billing, settings, interviews) at 320–1440px.
Automating these is blocked by email-confirmation on signup (the NEW CRITICAL SMTP
item) — there is no confirmed test account to log in with, and signing up writes to
prod. Once a seeded test account exists, the same harness extends to cover them.

---

## 🧹 Low priority

- **117 ESLint errors / 9 warnings.** 62 unused vars, 24 use-before-define (incl. `hydrateWorkspace`), 16 `set-state-in-effect`, 8 `exhaustive-deps` (a real "didn't save" bug source), 6 `static-components` (remounts subtree, loses state).
- `_drop` (17739) and `_applyLimits` (18008) assigned and never used — likely abandoned features.
- `0037_razorpay_subscription.sql` adds now-dead `razorpay_*` columns.
- `feature_flags` / `platform_flags` are world-readable, leaking the feature/rollout map.
- `18,258 lines in one file` — every screen, all logic. Not a defect, but it is why bugs like `PLAN_LIMITS.professional` survive.

---

## ❓ Decisions needed (no blind changes — audit §10)

**D1 — Churn behaviour (B2).** Immediate hard lockout, or reuse the trial-lapse path (`deleted_at` + `purge_after` + existing suspended paywall + 30 days to resubscribe)? **I recommend the latter**: it reuses working code, gives the customer a route back, and schedules the data for purge. Affects `stripe-webhook`, `companies`.

**D2 — RBAC (W5).** Roles exist in the schema and are partly enforced in RLS but not at all in the UI. Gating the UI touches every workspace screen. Confirm intended matrix (can a recruiter open Billing? can an interviewer see Candidate Search?) before I build it.

**D3 — Webhook idempotency (S4).** Adding a `stripe_events` table + timestamp tolerance is a schema change plus a webhook rewrite. Do it before real payments?

**D4 — Server-side limit enforcement (W1, W2).** The correct fix is to meter inside `rank-candidates` / `analyze-experience` and gate job creation with a `BEFORE INSERT` trigger or a definer RPC. This will start rejecting actions that currently succeed. Confirm you want limits actually enforced.

**D5 — M1/M2/M3.** Are top-ups, in-app invoices and promo-code validation in scope for this release, or explicitly deferred?
