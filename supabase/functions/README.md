# Edge functions

The AI functions share one secret, `ANTHROPIC_API_KEY`; the email functions
share `RESEND_API_KEY` (both set once, below). Deploy each with
`supabase functions deploy <name>`. Until a function is deployed the app falls
back to its built-in behaviour, so nothing breaks in a fresh clone.

| Function | Purpose | Secrets | JWT |
| --- | --- | --- | --- |
| `analyze-experience` | AI Experience Insights | `ANTHROPIC_API_KEY` | required |
| `rank-candidates` | AI shortlist ranking | `ANTHROPIC_API_KEY` | required |
| `parse-application` | Parse resume + file application + **email applicant** | `ANTHROPIC_API_KEY`, `RESEND_API_KEY` | public |
| `support-intake` | File help-center ticket + **email requester** | `RESEND_API_KEY` | public (`--no-verify-jwt`) |
| `support-reply` | Admin replies to a ticket by **email** | `RESEND_API_KEY` | required |

`_shared/email.ts` is the one Resend wrapper every email function imports (from
address, branded template, error handling). It is not a deployable function; it
ships automatically when a function that imports it is deployed.

## Email (Resend)

Transactional email goes through [Resend](https://resend.com). The sending
domain **hireaster.com** must be verified in Resend (Domains → add DNS records)
before anything sends. Then set the shared secret once:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
# optional overrides (defaults shown):
supabase secrets set EMAIL_FROM="Aster <notifications@hireaster.com>"
supabase secrets set EMAIL_REPLY_TO="support@hireaster.com"
```

Redeploy the three email-sending functions so they pick up the secret:

```bash
supabase functions deploy parse-application
supabase functions deploy support-intake
supabase functions deploy support-reply
```

Notes:
- `support-intake` is public and must be deployed with `--no-verify-jwt`:
  `supabase functions deploy support-intake --no-verify-jwt`. The help page
  calls it and, if it isn't deployed, falls back to the `submit_support_ticket`
  RPC (ticket still files, confirmation email is skipped).
- `sendEmail()` never throws and is best-effort in `parse-application` /
  `support-intake`: a failed email is logged but never blocks the ticket or
  application. `support-reply` does surface an email failure to the admin.
- If `RESEND_API_KEY` is unset, sends are skipped (logged) rather than erroring,
  so a fresh clone keeps working.

## `analyze-experience`

Powers **AI Experience Insights** on the candidate profile. The client sends one
candidate's already-parsed resume; Claude (Haiku, `claude-haiku-4-5-20251001`)
returns the deep read — total and leadership experience, domain exposure,
employer tenure, career progression, and any employment gaps. A signed-in user
is required, and the function reads nothing from the database (it only analyses
what it's given). If it isn't deployed, the button falls back to the instant
derived analysis, and every run is still metered against the plan's monthly AI
insight allowance.

```bash
supabase functions deploy analyze-experience
```

## `parse-application`

Reads an applicant's PDF resume with Claude, stores the file privately, and
creates the candidate (with a fully parsed profile) + an `applied` application.
The apply page calls this automatically; if it isn't deployed, applications
still land via the `submit_application` RPC, just without the AI-parsed fields.

### 1. Get an Anthropic API key

This needs a **developer API key**, which is different from a Claude.ai
subscription. Go to **https://console.anthropic.com → API Keys → Create key**,
and make sure the workspace has some credit (Billing). Copy the `sk-ant-…` key.

### 2. Install + link the Supabase CLI

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # ref is in your project URL / Settings
```

### 3. Set the secret

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do
not set those.)

### 4. Deploy

```bash
supabase functions deploy parse-application
```

That's it. Submit a test application from a job's **Preview the application
page** with a real PDF, then open that job's applicants — the candidate profile
should now be filled in (skills, experience, education), and the PDF is in the
private `resumes` bucket at `resumes/{company_id}/{candidate_id}.pdf`.

### Notes

- Model is `claude-haiku-4-5-20251001` (fast + cheap). For tougher resumes,
  change `MODEL` in `index.ts` to a Sonnet/Opus id and redeploy.
- The function is authorised only by an **open job id** — it can't be used to
  write anywhere else. Add rate limiting before a public launch.
- Logs: **Supabase → Edge Functions → parse-application → Logs**.
