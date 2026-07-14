# Aster end-to-end suite

Playwright drives the real app in a real browser. `npm run e2e`.

## Read this first: it can touch live data

The dev server boots from `.env.local`, which points at the **live Supabase
project**. So an authenticated run can create real jobs and candidates, **spend
real AI credits**, and **send real email**.

Nothing destructive runs unless you turn it on. With no env set, only the
public / read-only specs run and everything else is **skipped with a reason**,
so `npm run e2e` is always safe to run cold.

**Point this at a throwaway workspace** — ideally a separate Supabase project.
Never at a customer tenant.

## The three gates

| Env | Unlocks | Costs |
|---|---|---|
| `E2E_ALLOW_WRITES=1` | create/edit tenant rows (jobs, shortlists, stages, assignments) | rows in your workspace |
| `E2E_ALLOW_AI=1` | apply-page parse, AI Rank | **real AI credits + Claude calls** |
| `E2E_ALLOW_EMAIL=1` | invites, interview links, notifications | **real emails sent** |

Each gate also needs the matching sign-in credentials.

## Setup

```bash
# Sign-in credentials, one per role. Omit a role to skip its specs.
E2E_TENANT_EMAIL=owner@yourtest.com
E2E_TENANT_PASSWORD=...
E2E_HM_EMAIL=hm@yourtest.com
E2E_HM_PASSWORD=...
E2E_INTERVIEWER_EMAIL=interviewer@yourtest.com
E2E_INTERVIEWER_PASSWORD=...

# An OPEN job in the test workspace (from its apply link: /apply/<jobId>).
E2E_APPLY_JOB_ID=...
# Optional: a DRAFT job, to cover the draft apply-page state.
E2E_DRAFT_JOB_ID=...

# Gates (all off by default)
E2E_ALLOW_WRITES=1
E2E_ALLOW_AI=1
E2E_ALLOW_EMAIL=1
```

Run:

```bash
npm run e2e                 # everything you've unlocked
npm run e2e -- auth.spec.js # one file
npm run e2e:report          # open the HTML report
```

## What's covered

| Spec | Covers | Gate |
|---|---|---|
| `auth-guard.spec.js` | signed-out visitor to a workspace route lands on `/login` | none |
| `public-audit.spec.js` | marketing/public pages, meta, a11y | none |
| `auth.spec.js` | login form, bad password, reveal, sign in, session cleared | creds |
| `apply-public.spec.js` | apply page renders, PDF **and Word** accepted, submit disabled until a file, bad file rejected, `?source=` carried, draft link takes nothing | creds-free; **submit** needs `AI` |
| `jobs.spec.js` | Jobs screen, open-role meter, draft → publish, On-site default, tagged apply link, open-role limit refuses a publish | `WRITES` |
| `applicants.spec.js` | Strong/Non-Match/Hired split, free "Why:" on a non-match, shortlist star + filter, shortlist survives reload, AI Rank writes scores + Why | `WRITES`; rank needs `AI` |
| `team-and-roles.spec.js` | team list + tenant badge, invite, add-interviewer excludes self, **interviewer only sees assigned roles**, interviewer blocked from manager screens, interviewer requests a role | `WRITES`, invite needs `EMAIL` |
| `interviews.spec.js` | scheduled state, meeting link required + validated, sharing emails candidate + panel, panel swap grants job access | `WRITES`, share needs `EMAIL` |

## The rule the suite encodes

An interviewer sees a job **only when assigned to it** (`job_assignments`).
Being on an interview **panel** is not the same thing. `team-and-roles.spec.js`
and `interviews.spec.js` both pin this down, because it's the bug that kept a
swapped-in interviewer from seeing anything.

## Selectors

The app has few test ids, so specs use accessible selectors (`getByRole`,
`getByLabel`, visible text). That keeps them honest — if a spec can't find a
control, a screen reader probably can't either. If you rename a button, expect
to update the matching regex.
