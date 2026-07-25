# Aster — End-to-end test plan (web + mobile)

The master script for verifying Aster before a release. Every feature area lists
**Positive**, **Negative**, and **Regression** cases, which surface implements
each (**Web** Playwright / **Mobile** Maestro / **Unit** Vitest / **Manual**),
and the automated file that runs it.

- **Web** is Playwright, `npm run e2e`, specs in `tests/e2e/`. Safety gates and
  setup: `tests/e2e/README.md`. Nothing destructive runs unless a gate is on.
- **Mobile** is Maestro, `maestro test mobile/.maestro`, flows in
  `mobile/.maestro/`. See `mobile/.maestro/README.md`.
- **Unit** is Vitest, `npm test`, specs next to the code.

Gate legend (web): **C** creds only · **W** `E2E_ALLOW_WRITES` · **AI**
`E2E_ALLOW_AI` (spends credits) · **E** `E2E_ALLOW_EMAIL` (sends email).

---

## 0. How to run the whole thing

```bash
# Unit (fast, no network)
npm test

# Web e2e — cold/safe: only public + read-only specs run, rest skip with a reason
npm run e2e
# Web e2e — full, against a THROWAWAY workspace (see tests/e2e/README.md):
E2E_TENANT_EMAIL=owner@test E2E_TENANT_PASSWORD=… \
E2E_INTERVIEWER_EMAIL=iv@test E2E_INTERVIEWER_PASSWORD=… \
E2E_APPLY_JOB_ID=<open job> E2E_DRAFT_JOB_ID=<draft job> \
E2E_ALLOW_WRITES=1 E2E_ALLOW_AI=1 E2E_ALLOW_EMAIL=1 \
npm run e2e

# Mobile e2e — booted simulator/device with the app installed:
maestro test -e ASTER_PASSWORD='…' mobile/.maestro
```

---

## 1. Authentication & session

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 1.1 | Login form shows Email, Password, Sign in, Forgot password | Positive | Web | `auth.spec.js` |
| 1.2 | Wrong password → human error, stays on `/login` | Negative | Web | `auth.spec.js` |
| 1.3 | Password reveal toggles input type | Positive | Web | `auth.spec.js` |
| 1.4 | Tenant signs in and reaches `/dashboard` | Positive · C | Web | `auth.spec.js` |
| 1.5 | Clearing the session bounces a protected route to `/login` | Regression · C | Web | `auth.spec.js` |
| 1.6 | Sign in with valid creds reaches the app | Positive | Mobile | `00-sign-in.yaml` |
| 1.7 | Sign in button disabled until both fields; bad password refused | Negative | Mobile | `01-sign-in-negative.yaml` |
| 1.8 | Mobile has **no** in-app reset (web-only note shown) | Regression | Mobile | `00-sign-in.yaml` |

## 2. Sign up / workspace creation

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 2.1 | Form renders all fields + `.hireaster.com` URL suffix | Positive | Web | `signup.spec.js` |
| 2.2 | Personal email (gmail) rejected → "Use your work email" | Negative | Web | `signup.spec.js` |
| 2.3 | Mismatched passwords flagged before submit | Negative | Web | `signup.spec.js` |
| 2.4 | Matching passwords report positively | Positive | Web | `signup.spec.js` |
| 2.5 | Full submit creates a workspace + confirmation email | Manual | Web | (excluded from CI — real signup) |

## 3. Forgot / reset password

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 3.1 | Login links to the reset flow | Positive | Web | `forgot-password.spec.js` |
| 3.2 | Request form renders (email + Send + Back to sign in) | Positive | Web | `forgot-password.spec.js` |
| 3.3 | Malformed email refused; nothing sent | Negative | Web | `forgot-password.spec.js` |
| 3.4 | `/reset-password` always shows a known recovery heading (no blank) | Regression | Web | `forgot-password.spec.js` |
| 3.5 | Valid email → neutral "check your email" (anti-enumeration) | Positive · E | Web | `forgot-password.spec.js` |
| 3.6 | Reset link with a valid token → set-new-password → sign in | Manual | Web | (needs a live email token) |

## 4. Job posting

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 4.1 | Jobs screen: heading, open-role meter, Post a job | Positive · C | Web | `jobs.spec.js` |
| 4.2 | New role saved as draft, then shown as Draft | Positive · W | Web | `jobs.spec.js` |
| 4.3 | Work mode defaults to On-site | Regression · W | Web | `jobs.spec.js` |
| 4.4 | Apply link can be tagged with `?source=` | Positive · W | Web | `jobs.spec.js` |
| 4.5 | Publish past the open-role limit is refused with a reason | Negative · W | Web | `jobs.spec.js` |
| 4.6 | Publish disabled until title **and** description present | Negative | Web | (NewJobForm `canPublish`; covered via 4.5 path) |
| 4.7 | Manager reviews roles: Positions → role card → detail | Positive | Mobile | `02-review-candidate.yaml` |

## 5. Hiring pipeline (candidate → hire/reject)

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 5.1 | Candidates split into Strong / Non-Match / Hired | Positive · C | Web | `applicants.spec.js` |
| 5.2 | Non-Match shows the free "Why:" fit reason | Positive · C | Web | `applicants.spec.js` |
| 5.3 | Shortlist star toggles; Shortlisted filter narrows list | Positive · W | Web | `applicants.spec.js` |
| 5.4 | Shortlist survives reload (saved per user) | Regression · W | Web | `applicants.spec.js` |
| 5.5 | Candidate opens with Profile + Interview tabs | Positive · C | Web | `hiring-pipeline.spec.js` |
| 5.6 | Scorecard: Submit locked until all four areas rated | Negative · C | Web | `hiring-pipeline.spec.js` |
| 5.7 | Fully rated scorecard submits | Positive · W | Web | `hiring-pipeline.spec.js` |
| 5.8 | Reject flow opens a modal; Cancel sends nothing | Negative · C | Web | `hiring-pipeline.spec.js` |
| 5.9 | Star auto-advances applied → shortlisted; unstar reverts | Regression · W | Web | (applicants.spec.js + pipeline) |
| 5.10 | Manager reviews a candidate: role → candidate → tabs | Positive | Mobile | `02-review-candidate.yaml` |
| 5.11 | Scorecard: Submit disabled until 4 rated, then enabled | Pos+Neg | Mobile | `03-scorecard.yaml` |
| 5.12 | Panel discussion: open thread, post a message | Positive | Mobile | `05-discussion.yaml` |

## 6. Interviews & scheduling

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 6.1 | Scheduled state shows confirmed time + asks for meeting link | Positive · C | Web | `interviews.spec.js` |
| 6.2 | Share refused until the link is a real URL | Negative · C | Web | `interviews.spec.js` |
| 6.3 | Sharing emails the candidate + panel | Positive · W+E | Web | `interviews.spec.js` |
| 6.4 | Swapping a panel member also grants job access | Regression · W | Web | `interviews.spec.js` |
| 6.5 | Interviews/Today segmented tabs render and switch | Positive | Mobile | `09-today-interviews.yaml` |
| 6.6 | Propose times: needs ≥2 slots for the candidate | Negative | Mobile | (ProposeTimesSheet; manual until seeded poll) |

## 7. Offers (Aster Sign)

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 7.1 | Make an offer opens modal with Compose + Upload modes | Positive · C | Web | `hiring-pipeline.spec.js` |
| 7.2 | Composing with empty terms is refused (field errors) | Negative · C | Web | `hiring-pipeline.spec.js` |
| 7.3 | Send offer emails the candidate / submits for approval | Positive · W+E | Web | (manual: real offer email) |
| 7.4 | Public offer page: adopt signature → Finish accepts | Positive | Web | (manual: needs a live `/offer/<token>`) |
| 7.5 | Decline offer records a reason | Negative | Web | (manual) |
| 7.6 | Acceptance requires a real signature (no signature = no accept) | Regression | Web | (manual; see commit 08f9879) |
| 7.7 | Offer sheet: Compose/Upload; upload is web-only; empty refused | Neg | Mobile | `04-offer-sheet.yaml` |

## 8. Credit gating & top-up

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 8.1 | Dashboard plan-usage panel shows metered pools + ratios | Positive · C | Web | `credits-topup.spec.js` |
| 8.2 | Buy credits opens the top-up modal (Pay + Stripe note) | Positive · C | Web | `credits-topup.spec.js` |
| 8.3 | AI Rank asks before spending; Cancel spends nothing | Negative · C | Web | `credits-topup.spec.js` |
| 8.4 | Out of credits → "Out of credits" dead-end, not a silent spend | Negative · C | Web | `credits-topup.spec.js` |
| 8.5 | AI Rank writes scores + a free "Why" per candidate | Positive · AI | Web | `applicants.spec.js` |
| 8.6 | Bulk upload out-of-credits card → Buy credits | Negative · C | Web | `bulk-upload.spec.js` |
| 8.7 | Spend order: monthly pool first, then purchased top-up | Regression | Unit | (extend `plan.test.js`) |
| 8.8 | Unknown plan tier fails **closed** to Launch (not Elite) | Regression | Unit | `plan.test.js` |
| 8.9 | Mobile shows balances; "managed on web" (never sells) | Positive | Mobile | `07-credits-modal.yaml` |

## 9. Bulk upload (resume screening)

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 9.1 | Screen renders: dropzone, tabs, accepts PDF/Word/ZIP | Positive · C | Web | `bulk-upload.spec.js` |
| 9.2 | Choosing files shows a ready batch + run button (no spend) | Positive · C | Web | `bulk-upload.spec.js` |
| 9.3 | Out of `resume_screen` credits blocks upload | Negative · C | Web | `bulk-upload.spec.js` |
| 9.4 | More files than credits → "Upload blocked" + partial option | Negative · C | Web | `bulk-upload.spec.js` (over-limit banner) |
| 9.5 | Real screen builds candidates from a resume | Positive · AI | Web | `bulk-upload.spec.js` |

## 10. Billing

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 10.1 | Plan grid: Launch/Scale/Elite/Enterprise + Most popular | Positive · C | Web | `billing.spec.js` |
| 10.2 | Active plan marked "Current plan" (disabled) | Positive · C | Web | `billing.spec.js` |
| 10.3 | Manage billing (portal) + invoice history present | Positive · C | Web | `billing.spec.js` |
| 10.4 | Monthly/Yearly cycle toggle present | Positive · C | Web | `billing.spec.js` |
| 10.5 | Interviewer is kept out of billing (restricted/bounced) | Negative · C | Web | `billing.spec.js` |
| 10.6 | Plan change / checkout / portal complete on Stripe | Manual | Web | (never automated — real money) |
| 10.7 | `?plan=changed` / `?plan=scheduled` banners on return | Regression | Web | (manual) |
| 10.8 | End trial → suspend confirm dialog | Negative | Web | (manual: state-dependent) |

## 11. Settings

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 11.1 | Settings sections render (templates/signature/notifications/security) | Positive · C | Web | `settings.spec.js` |
| 11.2 | Security section exposes the two-factor card | Positive · C | Web | `settings.spec.js` |
| 11.3 | Flipping a notification toggle → unsaved-changes bar | Positive · C | Web | `settings.spec.js` |
| 11.4 | Enable two-factor emails a 6-digit code | Positive · E | Web | `settings.spec.js` |
| 11.5 | Interviewer cannot reach `/settings` | Negative · C | Web | `settings.spec.js` |
| 11.6 | WhatsApp section locked below Elite | Regression | Web | (LockBadge; manual by plan) |
| 11.7 | 2FA toggle state syncs to profile | Regression | Web | (see commit e69c0eb) |
| 11.8 | Mobile Settings: preferences + sign out returns to auth | Positive | Mobile | `08-settings-signout.yaml` |

## 12. Profile completeness

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 12.1 | Completeness meter shows a percentage | Positive · C | Web | `profile.spec.js` |
| 12.2 | Lists outstanding items, or "complete" — never a bare meter | Positive · C | Web | `profile.spec.js` |
| 12.3 | Password-change card + reset link present | Positive · C | Web | `profile.spec.js` |
| 12.4 | Mismatched new password refused | Negative · C | Web | `profile.spec.js` |
| 12.5 | First job blocked until profile 100% ("Complete your profile first") | Regression · C | Web | `profile.spec.js` |

## 13. Team & roles (RBAC)

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 13.1 | Team list marks the tenant; Invite teammate present | Positive · C | Web | `team-and-roles.spec.js` |
| 13.2 | Inviting a teammate sends a real invite | Positive · W+E | Web | `team-and-roles.spec.js` |
| 13.3 | Add-interviewer list excludes yourself | Negative · W | Web | `team-and-roles.spec.js` |
| 13.4 | Interviewer only sees roles they're **assigned** to | Regression · C | Web | `team-and-roles.spec.js` |
| 13.5 | Interviewer blocked from manager screens (jobs/billing/team) | Negative · C | Web | `team-and-roles.spec.js` |
| 13.6 | Interviewer can request a new role → pending approval | Positive · W | Web | `team-and-roles.spec.js` |

## 14. Public apply page

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 14.1 | Renders role, upload box (PDF+Word), Aster credit | Positive | Web | `apply-public.spec.js` |
| 14.2 | Submit disabled until a file is chosen | Negative | Web | `apply-public.spec.js` |
| 14.3 | Non-resume file type rejected | Negative | Web | `apply-public.spec.js` |
| 14.4 | `?source=` tag carried on the link | Regression | Web | `apply-public.spec.js` |
| 14.5 | Submitting a PDF files an application | Positive · AI | Web | `apply-public.spec.js` |
| 14.6 | A draft job's public link takes no applications | Negative | Web | `apply-public.spec.js` |

## 15. Marketing / public & auth guards

| # | Case | Type | Surface | Where |
|---|---|---|---|---|
| 15.1 | Marketing routes render without overflow/console errors | Positive | Web | `public-audit.spec.js` |
| 15.2 | Signed-out visitor to a workspace route lands on `/login` | Negative | Web | `auth-guard.spec.js` |
| 15.3 | Notifications open + clear the unread badge | Positive | Mobile | `06-notifications.yaml` |

---

## Coverage gaps deliberately left manual

These touch real money, real email tokens, or state that can't be seeded from the
UI, so they're **checklist** items, not automated:

- Completing a Stripe checkout / plan change / billing-portal action (10.6–10.8).
- The public offer signature acceptance and decline round-trip (7.3–7.6).
- The password-reset token round-trip from a real email (3.6).
- WhatsApp connect + send, and email-template edits that send live mail (11.6).

Run these by hand against a staging workspace before a release, ticking each row.

## Adding coverage

- Web: add a `*.spec.js` under `tests/e2e/`, reuse `helpers/env.js` gates and
  `helpers/auth.js`, and select by accessible name (see the README's rule).
- Mobile: add a `NN-name.yaml` under `mobile/.maestro/`, tag it `suite`, and lean
  on `runFlow: when:` guards so it no-ops when the demo data isn't in state.
- Prefer pulling pure logic into `src/lib/*` with a Vitest spec (like
  `plan.js` / `plan.test.js`) — it's the fastest, most reliable layer.
