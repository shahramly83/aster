# Aster — Remaining Work

**Only unresolved items.** Updated 2026-07-10. Full evidence in `ASTER_PRODUCTION_AUDIT.md`.

**Current verdict: 🔴 do not take real payments yet.**
Two findings mean a customer can pay and get nothing (B1), or cancel and keep everything (B2).

---

## 🔴 Production blockers

| # | Item | Why it blocks |
|---|---|---|
| **B1** | Migrations `0033`–`0037`, `0039`, `0040` unapplied; `stripe-webhook` not deployed | The live client sends `plan: "launch"`; the deployed webhook doesn't recognise it, so `companies.plan` is never updated. **Checkout takes money and never upgrades the plan.** Run the migrations, then deploy the webhook. |
| **B2** | Cancelling a subscription revokes nothing | `stripe-webhook` sets `companies.status='churned'`. **No policy anywhere reads `companies.status`.** `current_company_id()` gates only on `deleted_at`. A cancelled customer keeps full access indefinitely. See `0041` §4 — **needs your decision**. |
| **B3** | Zero automated tests | No `test` script, no vitest/jest/playwright config, no `*.test.*` files. Every billing, credit and permission rule is unverified. On a codebase taking card payments. |
| **B4** | Stripe Customer Portal not activated | `create-portal-session` is deployed but returns 502 until you activate the portal in Stripe → Settings → Billing → Customer portal. "Manage billing" is dead until then. |

---

## 🔒 Security risks

| # | Sev | Item | Fix |
|---|---|---|---|
| **S1** | High | `bump_resume_parse_for(uuid)` and `resume_parse_usage_for(uuid)` are `SECURITY DEFINER`, take an arbitrary company id, check no ownership, and `0034` never revoked the default `EXECUTE TO PUBLIC`. **Anyone can burn any company's parse credits to zero, or read their usage and plan.** | `0041` §1 — written, not applied |
| **S2** | Medium | A company **admin can promote themselves to `owner`**. `profiles_company_manage`'s `WITH CHECK` re-verifies `company_id` but never constrains the new `role`. (Recruiters/interviewers *are* correctly blocked by `USING`.) | `0041` §3 — written, not applied |
| **S3** | Medium | `get_public_job(uuid)` returns any job's details — **including drafts and closed roles** — with no status filter. | `0041` §2 — written, not applied |
| **S4** | Medium | `stripe-webhook` verifies the HMAC but **never checks the timestamp**. `t` is parsed and discarded. A captured `(body, signature)` pair verifies forever. No event-id dedupe table either. Comparison is not constant-time. | Needs decision — see D3 |
| **S5** | Medium | `parse-application` is public, **unmetered and unthrottled**. Anyone with a public apply-page UUID can submit unlimited resumes, each firing several paid Claude calls. Its own README says "add rate limiting before a public launch." | Reuse the `chat_rate_hit` throttle |
| **S6** | Medium | `support-intake` is public with **no rate limit**, and sends email via Resend. Spam/quota-burn vector. | Rate limit + turnstile |
| **S7** | Low | `_free_trial_used(text)` is PUBLIC-callable — lets anyone probe whether an email or domain has used its trial. | `0041` §1 |
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
| **W4** | Medium | Unauthenticated `/dashboard` renders the app shell instead of redirecting to `/login`. No data leaks (RLS denies), but it's broken. |
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

Not yet audited. Phase 6 pending. Requires a browser.

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
