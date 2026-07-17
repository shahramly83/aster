# Aster Mobile (interviewer app)

A React Native + Expo companion app for **interviewers and hiring managers**. It
reuses the exact same Supabase backend as the web app (`../`) — same project,
same anon key, same tables (RLS-scoped), same edge functions. There is **no new
API layer**: web and mobile read one source of truth, so they stay in sync
automatically.

Scope is deliberately the least-privilege interviewer surface (mirrors
`INTERVIEWER_ALLOWED` in the web app):

- **Today** — interviews assigned to me, with reminders and a "join call" link.
- **Interview detail** — candidate summary, résumé, AI-drafted questions.
- **Scorecard** — rate the same four criteria as the web panel, 1–4, with notes.
- **Positions → candidates** — roles I'm on, applicants, shortlist/reject.
- **Me** — profile, biometric app-lock, sign out.

Heavy recruiter work (bulk upload, job creation, AI Rank runs, billing) stays on
the web app by design.

## Architecture

```
aster-preview/
├─ src/                 ← existing web app (unchanged)
├─ shared/              ← @aster/shared: pure JS domain logic used by BOTH apps
│  ├─ stages.js         (JOB_STAGES, stage labels/colors)
│  ├─ scorecard.js      (SCORE_CRITERIA, recommendationFromRatings)
│  ├─ plan.js           (PLAN_LIMITS, ROLE_LABELS)
│  └─ time.js           (relTime, fmtInterviewTime, …)
├─ mobile/              ← this app
│  ├─ App.js            (navigation + auth gate)
│  └─ src/
│     ├─ AuthContext.js (Supabase auth, session, push, biometric lock)
│     ├─ lib/           (supabase, session, data, push, linking)
│     ├─ components/ui.js
│     └─ screens/
└─ supabase/            ← shared backend (migrations + edge functions)
   ├─ migrations/0108_device_tokens.sql   ← NEW: push tokens
   └─ functions/_shared/push.ts            ← NEW: Expo push helper
```

`shared/` is the canonical home for domain logic. The mobile app imports it via
`@aster/shared` (wired through `metro.config.js`). The web app can be pointed at
the same package later; nothing forces it to today.

## Prerequisites

- Node 18+ and the Expo tooling (`npx expo`).
- The Expo Go app on your phone (for quick dev) or a dev build for push testing.
- The same Supabase URL + anon key the web app uses.

## Setup

```bash
cd mobile
cp .env.example .env        # fill EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
npm install
npm run start               # then scan the QR with Expo Go, or press i / a
```

`npm install` resolves `@aster/shared` from `../shared` via the `file:` dependency;
`metro.config.js` watches the repo root so edits to `shared/` hot-reload.

## Backend steps (once)

1. **Apply the migration** so device tokens have a home:
   ```bash
   supabase db push          # applies supabase/migrations/0108_device_tokens.sql
   ```
2. **Deploy the shared push helper + updated notify function**:
   ```bash
   supabase functions deploy notify-panel-added
   ```
   `_shared/push.ts` needs no secret (Expo's send endpoint is unauthenticated).
3. **Wire push into the other events** you want on mobile. The one-liner drops
   into any notify/booking function that already has a service-role `admin`
   client and a target `user_id`:
   ```ts
   import { pushToUser } from "../_shared/push.ts";
   await pushToUser(admin, interviewerId, {
     title: "New interview scheduled",
     body: `${candidateName} · ${roleTitle} · ${whenStr}`,
     data: { url: `aster://interview/${candidateId}` },
   });
   ```
   Good candidates: `confirm-booking`, `send-interview-invite`,
   `notify-scheduling-request`, and the new-applicant path.

## Push + deep links

- Tokens are stored per user in `device_tokens` (RLS: a user sees only their own).
- Payloads set `data.url` to an `aster://` deep link; `src/lib/linking.js` maps
  those to screens (`aster://interview/<id>`, `aster://scorecard/<candidateId>`).
- For real push you need an **EAS dev build** (Expo Go can't receive project
  push in SDK 52 without a projectId). Run `eas build --profile development`.

## Security notes

- The anon key ships in the binary — that's expected. Every table this app
  touches is protected by Row Level Security; the app is untrusted.
- Before shipping, confirm from the interviewer's seat: they can read only their
  assigned jobs' applicants and only their own scorecards, and can update stage
  only on assigned jobs. The `submitScorecard` insert relies on the existing
  `job_id in assigned_job_ids()` policy.

## Not yet built (deliberate v1 cuts)

Password reset & SSO (web handles them), offer signing, in-app chat, and any
AI-run triggers. Mobile reads AI results; it never spends metered AI credits.
