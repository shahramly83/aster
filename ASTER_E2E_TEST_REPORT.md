# Aster — End-to-End Test Report

**Date:** 2026-07-11 · **Method:** structure discovery (4 parallel code audits of the customer app,
edge functions, database/RLS, and admin/help/marketing surfaces) + live browser driving of the
running app with the provided test account (`test@onlazy.com`).

**Nothing in the product source was changed.** This is a findings-only report, as requested.
Live tests were kept non-destructive: no emails were sent, no cards charged, no data deleted.

Legend for how each finding was established:
- **[LIVE]** — reproduced by driving the running app in a browser.
- **[CODE]** — established by reading the source; high confidence, not exercised live (usually because
  doing so would create data, send email, or needs a second account/role).

---

## 1. Executive summary

The app is in good shape on the fundamentals that usually break: **session handling, routing, RLS
tenant isolation, webhook hardening, and responsive layout are solid.** All 11 authenticated screens
render cleanly on desktop and mobile with no layout overflow and no console errors; an invalid or
corrupted session recovers gracefully to `/login`; refresh and back-button both behave.

The material problems are in **plan/credit enforcement and usage display**, plus a set of
**public unmetered endpoints** and **missing double-submit guards**. The single most important finding:

> **A "Full Scale access" trial is enforced at Launch limits by the server.** The dashboard advertises
> Scale (50 parses, 30 AI ranks, 5 jobs), but the server hands the trial account Launch caps
> (10 parses, 5 ranks, 1 job). Confirmed live against the real backend.

Counts: **2 High, 8 Medium, 10 Low** (plus confirmed-sound areas in §5 and open items carried from
`ASTER_REMAINING_WORK.md`).

---

## 1b. LIVE SESSION UPDATE (2026-07-11) — critical infra findings + fixes

Driving the app end-to-end against the live backend with real accounts surfaced things
static review could not, plus two fixes applied this session:

**🔴 C1 — 8 lifecycle edge functions were NOT deployed. [LIVE] — FIXED this session.**
The whole hiring-communication layer was missing from the live project:
`send-teammate-invite`, `send-welcome`, `send-interview-invite`, `confirm-booking`,
`send-offer`, `respond-offer`, `send-stage-email`, `scheduled-emails` all returned 404.
So teammate invites, interview/booking links, offer send+response, hired/rejected emails,
and the digest/trial-ending cron were all inert while billing and AI functions worked.
**Deployed during this session** (user ran `supabase functions deploy …`); all 8 respond now.

**🔴 C2 — Auth email delivery is broken (no email is delivered). [LIVE]**
Confirmation is required (`signup` → `confirmation_required=true`, `confirmation_sent_at`
set) but the email never arrives, and login then fails `email_not_confirmed`. The teammate
invite email also never arrived. Proven via two independent emails (Supabase confirmation +
Resend invite). **Impact:** no new customer and no invited teammate can complete onboarding.
This is the pending "auth SMTP" item, now confirmed as actively blocking. **Fix:** point
Supabase Auth SMTP at Resend (verified sender + domain DNS).

**🔴 H1 (upgraded) — "Full Scale access" trial was provisioned/enforced as Launch.
[LIVE] — FIXED this session (migration `0050`).** The test account was
`companies.plan=launch`, `subscriptions.plan=launch, seats=1`, while the client renders
Scale. Every server limit was Launch — including `seats=1`, which made `invite_teammate`
reject the first teammate ("seat limit reached") though the UI shows "1 / 100". Root cause:
`create_company_and_owner` inserted the trial on the base tier
([0040:114](supabase/migrations/0040_rename_plan_tiers.sql#L114)); the "trial ⇒ Scale" logic
existed only client-side. **Fix applied:**
[0050_scale_trial_provisioning.sql](supabase/migrations/0050_scale_trial_provisioning.sql)
provisions granted trials on Scale (`seats=3`, 14 days) and backfills in-flight trials.
Verified live: the account is now `scale / seats=3` and invites succeed.

**🟠 C3 — `send-teammate-invite` reports success even when the email fails. [LIVE]**
Returned `{ok:true}` with no email delivered (best-effort Resend send swallows failures).
With C2 in play, the owner sees "Invite sent" while the invitee gets nothing. **Fix:** don't
report success on a failed/skipped send; add a "resend invite" affordance.

**🟡 C4 — Emailed invite link — likely NOT a bug (retracted).** A headless open of
`/?invite=<token>` sat on landing, but a real click of the invite email's "Accept the invite"
button (user-tested) opened the accept screen correctly. Downgraded to a test-harness timing
artifact.

**🟠 C5 — Supabase auth emails are unbranded + wrong sender name. [LIVE]** The confirmation /
reset / magic-link emails use Supabase's *default* templates (no Aster logo, generic copy), and
the SMTP **Sender name** shows "Aste" (typo/truncation). Transactional emails (via Resend's
`_shared/email.ts`) are branded; the auth emails were never customized. **Fix:** set Sender name
to `Aster`; customize the auth email templates (Confirm signup / Invite / Reset / Magic link /
Change email) with Aster HTML.

**🟠 C6 — Auth redirect URL misconfigured to `localhost:3000`. [LIVE]** Clicking a confirmation
link lands on `localhost:3000` (`ERR_CONNECTION_REFUSED`) — the account is still confirmed (the
`#access_token` is issued first), but the user hits a dead page. **Fix:** Authentication → URL
Configuration → **Site URL** = `https://hireaster.com`, and add it to Redirect URLs.

**🟠 M7 (interviewer RBAC) — characterized LIVE: UI over-exposure, not escalation.**
Logged in as a real interviewer (`interview@onlazy.com`, invited + accepted): the sidebar shows
**every** owner item including **Billing** and **Settings**, and both screens fully render. BUT
the server rejects every privileged action — `invite_teammate`/`remove_teammate` → 403 forbidden,
`end_trial_now` → 403 "owner only", `create-checkout-session` → 403 "only an admin can subscribe",
`create-portal-session` → 403 "only an admin can manage billing" — and candidate/job reads return
`[]` (RLS scopes interviewers to assigned jobs). So the boundary holds; the gap is **least-privilege
UI + minor info disclosure** (an interviewer can read the subscription plan/seats and see the
billing/settings chrome).
**✅ FIXED this session (confirmed matrix: interviewers get assigned work + own profile only):**
- Client gating in `resume-ai-preview.jsx`: interviewer sidebar shows only **Interviews** + **Profile**;
  a screen guard bounces any other workspace screen (deep-link/back/stale nav) to their Interviews
  home; interviewer landing = Interviews. Owner/admin unchanged.
- Migration [0051_restrict_subscription_read.sql](supabase/migrations/0051_restrict_subscription_read.sql)
  tightens `subscriptions` SELECT to owner/admin. Verified live: interviewer read now `[]`, owner
  still sees the plan.
- Verified live as the interviewer: nav hidden, all of `/billing /settings /jobs /search /candidates
  /interviewers` render the Interviews home; owner regression-checked (full nav intact).
- Minor follow-up: the Interviews screen still shows "← Dashboard" / "Manage interviewers" header links
  that bounce for interviewers (cosmetic).

**✅ Confirmed sound / positive (LIVE):**
- **H1 fix verified end-to-end** — after migration 0050 the owner's usage RPCs return Scale limits
  (AI Rank **30**, parse **50**, insight **100**, job post **5**); server now matches the advertised
  trial. Teammate invites succeed (`seats=3`).
- **All migrations 0001–0049 applied** to remote (`supabase migration list`) — prior security
  fixes (0041, 0045–0049) are genuinely live.
- **Job-post limit enforced in the DB** — direct PostgREST `jobs` insert rejected by the
  `charge_job_post` trigger (`P0001 "job post limit reached"`). W1 holds bypassing the UI.
- **`support-intake` works** — `submit_support_ticket` returns honeypot `"T-0"`. The earlier
  "broken RPC" flag was an empty-body-probe artifact — **retracted**.
- **Interviewer privilege boundary holds** — all privileged writes rejected server-side (see M7).

**⏳ Remaining live item:** interviewer-vs-interviewer isolation (needs `interview2@` confirmed +
both assigned to different jobs to be meaningful). Ready to run.

---

## 2. Issue register (by severity)

### 🔴 HIGH

**H1 — Trial is advertised as Scale but enforced as Launch server-side. [LIVE]**
The test account is a Scale trial (billing page: "Scale (trial)", dashboard banner: "Full Scale
access"). The client cosmetically upgrades a trial via `effectivePlan = trialActive && plan==="launch"
? "scale" : plan` ([resume-ai-preview.jsx:17249](src/resume-ai-preview.jsx#L17249)), so the UI shows
Scale everywhere. But the server metering RPCs read `companies.plan` directly (which is `launch` for
the trial) and never account for trial status. Captured live from the running app:

| Meter | Server returns (`monthly_limit`) | Client/UI shows | Scale should be |
|---|---|---|---|
| `get_resume_parse_usage` | **10** | "50 Parsing / month" | 50 |
| `get_ai_rank_usage` | **5** | "AI Rank credits … / 30" | 30 |
| `get_ai_insight_usage` | **5** | "… / 100" | 100 |
| `get_job_post_usage` | **1** | plan card "5 active jobs" | 5 |

Root cause: `_resume_parse_limit`, `_ai_rank_limit`, `_ai_insight_limit`, `_job_post_limit` all take
`companies.plan` ([0040_rename_plan_tiers.sql:37-74](supabase/migrations/0040_rename_plan_tiers.sql#L37)),
and `get_*_usage` pass `(select plan from companies …)` with no trial branch
([0034_resume_parse_metering.sql:37](supabase/migrations/0034_resume_parse_metering.sql#L37),
[0008_ai_rank_cycle.sql:40](supabase/migrations/0008_ai_rank_cycle.sql#L40)). A trial user who uploads
an 11th CV, runs a 6th AI rank, or posts a 2nd job is blocked despite the advertised allowance —
and the job-post *trigger* (`charge_job_post`) will hard-reject the 2nd job at the database.
**Impact:** the trial does not deliver what is sold; conversions happen on a throttled experience;
the "Full Scale access" copy is inaccurate.
**Suggested fix:** decide the intended trial tier and make one side match the other. Cleanest is to
teach the server what the client already does — resolve the *effective* tier (trial ⇒ Scale) inside the
limit lookup, e.g. a `_effective_plan(company)` helper that returns `scale` while
`status='trial' AND current_period_end > now()`, and call it from every `_*_limit`/`get_*_usage`/
`charge_job_post` path. Alternatively, provision trials with `companies.plan='scale'` and flip to the
purchased tier on checkout. Either way, add a test asserting client `planLimits(effectivePlan)` equals
the server `get_*_usage.monthly_limit` for a trial.

**H2 — `parse-application` is public, unmetered, and unthrottled. [CODE]**
The public apply endpoint runs a Claude Sonnet call *with web_search (max_uses:6)* plus a Haiku vision
call on every submission, authorized only by a public job UUID, with **no rate limit, no dedupe, and no
usage metering** ([supabase/functions/parse-application/index.ts](supabase/functions/parse-application/index.ts);
its own README flags "add rate limiting before a public launch"). Anyone holding a public apply link can
loop it to burn your Anthropic bill and flood a tenant with candidate rows. Contrast `parse-resume`,
which meters. **Impact:** direct cost-abuse / DoS-on-spend; candidate-table spam.
**Suggested fix:** add an IP + job throttle (reuse the `chat_rate_hit` pattern), a short-window dedupe
on `(job_id, email, file hash)`, and count applicant parses against `_applicant_parse_limit` so a job's
company can't be pushed past its plan. Consider a lightweight challenge (Turnstile) on the apply form.

### 🟠 MEDIUM

**M1 — Dashboard "Plan usage" meters are internally inconsistent and partly fictional. [LIVE + CODE]**
In `DashboardScreen` ([resume-ai-preview.jsx:8452-8457](src/resume-ai-preview.jsx#L8452)) only
*AI Parsing* reads the real server counter (`parseUsage`, =10). The other four rows use **client-side
Scale limits** and **client-derived "used" values that are not the real usage counters**:
- AI Rank: `used: stats.matches`, `limit: L.aiRunsPerMonth` (30) — server actually enforces 5.
- AI Insights: `used: stats.inInterview` (candidates in the interview stage — unrelated to insight calls).
- Interview questions: `used: stats.interviewsScheduled`.
- See-why: `used: stats.matches`.

So the meters both contradict the server (limits) and invent the numerators. **Impact:** users are told
they have credits they don't, and "used" figures are meaningless; combined with H1 they'll be cut off
well before the bar looks full.
**Suggested fix:** drive all five meters from the real `get_*_usage` RPCs (used + `monthly_limit`),
the same way AI Parsing already is; remove the `stats.*` stand-ins.

**M2 — `set_platform_flag` authorization is weaker on the server than in the UI. [CODE]**
The admin UI restricts platform-flag toggles to `super`
([admin-portal.jsx:637](src/admin-portal.jsx#L637)), but the server RPC only checks `is_admin()`, not
`role='super'` ([0025_platform_flags.sql:34-45](supabase/migrations/0025_platform_flags.sql#L34)). A
`support` or `billing` admin who calls the RPC directly can flip **platform-wide** flags (`sso_login`,
`white_label`, …) that take effect for every tenant. **Impact:** privilege escalation across the whole
platform by a lower-tier admin. **Suggested fix:** add `if current_admin_role() <> 'super' then raise
exception … end if;` to `set_platform_flag`, mirroring the 0049 action RPCs.

**M3 — No double-submit guard on New Job create/publish. [CODE]**
`NewJobForm` create/publish is async with no in-flight `busy` state and the Publish button is not
disabled during the await ([resume-ai-preview.jsx:9805](src/resume-ai-preview.jsx#L9805)). A fast
double-click can fire two inserts; the second races the `charge_job_post` trigger and, on a plan with
room, double-charges a job-post credit. **Impact:** duplicate jobs, mischarged credits.
**Suggested fix:** add a `submitting` state that disables both buttons for the duration (the pattern
already used by Login/Upload/Invite).

**M4 — No in-flight guard on Billing "Subscribe" / checkout. [CODE]**
`startCheckout` has no disable-while-pending ([resume-ai-preview.jsx:13361](src/resume-ai-preview.jsx#L13361)),
so a double-click opens multiple `create-checkout-session` calls / redirects. **Impact:** confusing
multi-tab checkout, possible duplicate Stripe sessions. **Suggested fix:** disable the plan buttons once
a checkout call is in flight (mirror the existing `portalBusy` guard).

**M5 — `support-intake` is public with no rate limit. [CODE]**
Public ticket creation + Resend email with only the RPC honeypot in front
([supabase/functions/support-intake/index.ts](supabase/functions/support-intake/index.ts)). **Impact:**
spam tickets and email-quota burn. **Suggested fix:** per-IP throttle (reuse `chat_rate_hit`) and/or
Turnstile on the help + chat-lead forms.

**M6 — `marketing-chat` rate limiter fails open. [CODE]**
If the `chat_rate_hit` RPC errors or the DB is unreachable, the limiter returns "allow"
([supabase/functions/marketing-chat/index.ts:33-43](supabase/functions/marketing-chat/index.ts#L33)),
leaving a public Anthropic endpoint unthrottled. IP is taken from a spoofable `x-forwarded-for`.
**Impact:** cost-abuse whenever the throttle backend hiccups. **Suggested fix:** fail closed (deny on
limiter error) on this public, paid endpoint.

**M7 — RBAC is not enforced in the UI. [CODE]** (carried from `ASTER_REMAINING_WORK.md` W5/D2)
Every sidebar item (Jobs, Billing, Settings, Candidate Search) is visible regardless of role; role is
display-only in the client ([resume-ai-preview.jsx:14498](src/resume-ai-preview.jsx#L14498)). RLS scopes
an interviewer's *candidate* data, but Billing/Settings actions rely entirely on the server rejecting
them. **Impact:** interviewers see billing/settings surfaces they shouldn't; poor least-privilege.
*Not fully live-verifiable with a single owner account — needs a second (interviewer) login.*
**Suggested fix:** confirm the intended role matrix, then gate nav + screens by role (still backed by
RLS).

**M8 — Public token-gated endpoints have no rate limit. [CODE]**
`confirm-booking` and `respond-offer` are public, guarded only by an unguessable token, with no throttle
([supabase/functions/confirm-booking/index.ts](supabase/functions/confirm-booking/index.ts),
[respond-offer/index.ts](supabase/functions/respond-offer/index.ts)). Low risk given UUID tokens, but
worth a basic per-IP limit. **Suggested fix:** add a light IP throttle; keep the idempotency guards
they already have.

### 🟡 LOW

**L1 — `parse-resume` metering fails open on the counter bump. [CODE]** The `bump_resume_parse_for`
call is best-effort (catch swallows) and the RPC lacks `FOR UPDATE`, so a counter hiccup lets a parse
through un-charged and concurrent uploads at `limit-1` can overshoot slightly (service-gated). (W3.)
Fix: make the bump atomic + fail closed, or accept as documented.

**L2 — Signup: Terms and Privacy links are dead buttons. [CODE]** No `onClick`
([resume-ai-preview.jsx:6967-6968](src/resume-ai-preview.jsx#L6967)); the legal links a user must
"agree" to go nowhere. Fix: link to `/legal/terms` and `/legal/privacy`.

**L3 — Settings "Connect calendar" and "Connect WhatsApp" are no-ops. [CODE]** Advertised features
(WhatsApp is on the Elite plan) render connect UI that does nothing; the calendar "connected" state is
marked dirty but never persisted ([resume-ai-preview.jsx:14677](src/resume-ai-preview.jsx#L14677),
[:14697](src/resume-ai-preview.jsx#L14697)). Fix: hide until built, or wire the integration.

**L4 — SchedulePicker uses a hardcoded placeholder meeting link. [CODE]**
`meet.google.com/abc-defg-hij` ([resume-ai-preview.jsx:12762](src/resume-ai-preview.jsx#L12762)). Fix:
generate/store a real link or omit.

**L5 — Several client "send" flows are simulated. [CODE]** ScheduleInterviewPanel, InterviewQuestions,
OfferModal, RejectionModal use `setTimeout` fakery; slot-finding is fake and gated on
`calendarConnected` which defaults false ([resume-ai-preview.jsx:17229](src/resume-ai-preview.jsx#L17229)).
Real persistence/email happens in parent handlers for offers/rejections, but the interview-scheduling UX
is not backed by a real availability lookup. Fix: label as preview or implement.

**L6 — Weak / inconsistent input validation. [CODE]**
- Signup `canSubmit` gates only company+first+email; password and last name are not gated
  ([resume-ai-preview.jsx:6680](src/resume-ai-preview.jsx#L6680)), so the button enables early.
- Signup does not enforce the "Work email" label (`isBusinessEmail` unused on the form).
- Interviewer invite email field has no email validation
  ([resume-ai-preview.jsx:12137](src/resume-ai-preview.jsx#L12137)).
- Help-portal uses `email.includes("@")` vs the stricter `EMAIL_RE` used in chat lead capture.
- NewJob: salary min ≤ max not checked; a past close-date warns but still submits.
Fix: unify on `isValidEmail`/`passwordProblem`, add the min/max check.

**L7 — Empty-form login submit does not disable the button. [LIVE]** The Sign-in button is not
`disabled` on empty fields; submit is blocked by client validation instead (stays on `/login`, no error
shown for empty). Minor UX nit. Fix: disable until `isValidEmail(email) && password`.

**L8 — Scorecard submit and Offer/Rejection "without email" buttons lack busy guards. [CODE]**
([resume-ai-preview.jsx:15269](src/resume-ai-preview.jsx#L15269),
[:16097](src/resume-ai-preview.jsx#L16097)) Double-submit risk. Fix: add `saving` guards.

**L9 — `feature_flags` / `platform_flags` are world-readable. [CODE]** Anon `SELECT using(true)`
([0025_platform_flags.sql:23](supabase/migrations/0025_platform_flags.sql#L23)) leaks the rollout map.
Low sensitivity, by design. Fix (optional): restrict to authenticated, or accept.

**L10 — Consumer-email trial farming. [CODE]** (S9) gmail/outlook users aren't domain-blocked and
purged workspaces don't record an email hash, so the same address can re-trial after purge. Accepted
risk per prior audit. Fix: hash-ledger consumer emails too, or accept.

---

## 3. What was verified working (so it isn't re-flagged later)

- **[LIVE] Auth errors:** wrong password → stays on `/login` with "Email or password is incorrect."
- **[LIVE] Invalid/corrupted session:** tampered token on `/dashboard` → clean redirect to `/login`,
  no page errors, no white screen.
- **[LIVE] Refresh persistence:** reload on `/dashboard` keeps the session and the screen.
- **[LIVE] Back button:** dashboard → billing → Back lands correctly on `/dashboard`, fully rendered.
- **[LIVE] W4 guard:** unauthenticated deep-links to workspace routes redirect to `/login`
  (5 routes × 3 viewports, `tests/e2e/auth-guard.spec.js`).
- **[LIVE] Responsive/render:** all 11 workspace screens + all 10 public routes render with no
  horizontal overflow and no console errors on desktop (1440), tablet (WebKit), and mobile (WebKit).
- **[CODE] Tenant isolation:** RLS on every table keys off `current_company_id()`; no policy grants
  cross-company read/write; `usage_counters` has no customer write policy; bump RPCs are `FOR UPDATE`.
- **[CODE] Admin cross-tenant actions** (suspend/deactivate/plan-change/reset) are server-role-gated and
  audit-logged; the four match the client permission matrix.
- **[CODE] Stripe webhook:** constant-time signature verify, 300s replay window, event-id dedupe, and
  fail-closed 500s so Stripe retries instead of dropping a payment.

---

## 4. Test-scenario matrix

For each feature area, the standard variations were considered:
happy · wrong input · empty state · failed API · refresh · back · double-click · mobile · expired
session · no permission · mock/dummy data. Status: ✅ executed live · 🔎 code-reviewed · ⏳ needs a
second account / network fault injection to execute.

| Feature area | Happy | Wrong input | Empty | Failed API | Refresh | Back | Double-click | Mobile | Expired sess. | No perm | Notes / findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Login / MFA | ✅ | ✅ (wrong pw, empty) | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | n/a | L7 empty-submit; MFA path code-only |
| Signup / onboarding | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | n/a | n/a | L2 dead legal links, L6 validation gaps. Not run live (writes + email confirm) |
| Forgot / reset password | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | n/a | n/a | Error swallowed for privacy (good) |
| Dashboard | ✅ | n/a | 🔎 | 🔎 | ✅ | ✅ | n/a | ✅ | ✅ | ⏳ | **M1 meters wrong**, **H1 trial limits** |
| Jobs / New Job | 🔎 | 🔎 (salary, date) | 🔎 | 🔎 | ✅ | ✅ | 🔎 **M3** | ✅ | ✅ | ⏳ | double-create risk; not created live (limit 1/1) |
| Bulk Upload (parse-resume) | 🔎 | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | metered; **H1** caps at 10 on trial; L1 fail-open |
| Public Apply (parse-application) | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | n/a | 🔎 | 🔎 | n/a | n/a | **H2 unmetered/unthrottled**; PDF fixture ready |
| Candidate search / rank | 🔎 | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | server rank metered fail-closed (good); **H1** caps at 5 |
| Candidate profile / insights | 🔎 | n/a | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | analyze-experience metered fail-closed |
| Interviews / scheduling | 🔎 | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 **L8** | ✅ | ✅ | ⏳ | **L5 simulated** slot-finder |
| Offers → hire | 🔎 | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 **L8** | ✅ | ✅ | ⏳ | public offer page token-gated; **M8** no throttle |
| Billing / checkout / portal | ✅ (render) | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 **M4** | ✅ | ✅ | ⏳ | portal needs Stripe activation (B4); no checkout run live |
| Profile / Settings | ✅ (render) | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | **L3 no-op integrations** |
| Email templates | ✅ (render) | 🔎 | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | server RLS owner/admin (good) |
| Teammate invite / remove | 🔎 | 🔎 (no email val) | 🔎 | 🔎 | ✅ | ✅ | 🔎 | ✅ | ✅ | ⏳ | seat-limit + role gate server-side (good) |
| Account delete / restore | 🔎 | n/a | n/a | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | ✅ | ⏳ | destructive — not run live |
| Marketing site + chat | ✅ | 🔎 | 🔎 | 🔎 | ✅ | ✅ | n/a | ✅ | n/a | n/a | **M6 chat fails open**; input clamped (good) |
| Help portal (support intake) | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | n/a | n/a | **M5 no rate limit**; honeypot present |
| Admin portal | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 | 🔎 **M2** | needs an admin login to run live |

**To fully execute the ⏳ / 🔎 rows I need:** (a) a second workspace login with an **interviewer** role
(for the no-permission column and M7), (b) an **admin** login for the admin portal (M2), and (c) approval
to do **write/destructive** flows on the test account (create jobs, upload CVs, send an invite) and/or
**network fault injection** (to exercise the failed-API column per feature). All are ready to run on the
existing Playwright harness once you approve.

---

## 5. Open items carried from `ASTER_REMAINING_WORK.md` (still true)

- **B4** — Stripe Customer Portal not activated → "Manage billing" 502s.
- **Stripe dashboard events** — `customer.subscription.deleted` / `invoice.paid` /
  `invoice.payment_failed` must be added to the endpoint for churn/past-due to fire.
- **M1–M5 (features)** — credit top-ups, in-app invoices, promo-code validation, WhatsApp, calendar:
  not built / delegated to Stripe. (L3/L5 above are the UI symptoms.)

---

## 6. How this was tested (repro)

- Playwright suite (committed): `npm run e2e` — public responsive audit + auth-guard.
- Live exploration scripts under `_live/` (gitignored) drove the authenticated app with a captured
  session: workspace render sweep, usage-RPC capture, and the auth/nav edge-case probes above.
- Synthetic resume fixture for the apply flow: `npm run fixtures` (pdfkit, real text layer).

**Next step:** on your approval I'll turn the confirmed findings into fixes (starting with H1 and the
meter wiring in M1), and extend the live suite to cover the ⏳ rows once I have interviewer + admin
logins.
