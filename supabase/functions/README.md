# Edge functions

All three share one secret, `ANTHROPIC_API_KEY` (set once, below). Deploy each
with `supabase functions deploy <name>`. Until a function is deployed the app
falls back to its built-in behaviour, so nothing breaks in a fresh clone.

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
