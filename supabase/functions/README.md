# Edge functions

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
