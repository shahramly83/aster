# Aster — Supabase setup

This folder holds the database as code. The app talks to Supabase through
[`src/lib/supabase.js`](../src/lib/supabase.js), which reads its keys from
`.env.local`. Until those keys exist, the app keeps running on mock data — so
nothing breaks while you set this up.

---

## 1. Create the project

1. Go to **https://supabase.com** → sign in → **New project**.
2. Pick an **organization**, a **name** (e.g. `aster`), a strong **database
   password** (save it), and the **region** closest to your users.
3. Wait ~2 minutes for it to provision.

## 2. Get your keys

In the project: **Settings → API**. Copy:

- **Project URL** → `VITE_SUPABASE_URL`
- **Project API keys → `anon` `public`** → `VITE_SUPABASE_ANON_KEY`

Then, in the repo root:

```bash
cp .env.example .env.local
# open .env.local and paste the two values
```

> The **`service_role`** key on that page is a secret that bypasses all
> security. Never put it in `.env.local`, in the client, or in git — it's only
> for server / edge-function environments.

For a Vercel deploy, add the same two `VITE_SUPABASE_*` vars in
**Vercel → Project → Settings → Environment Variables**.

## 3. Apply the schema

**Option A — SQL editor (quickest):** in Supabase, open **SQL Editor → New
query**, paste the contents of `migrations/0001_init.sql`, run it, then do the
same for `migrations/0002_storage_and_seed.sql`.

**Option B — Supabase CLI (recommended long-term):**

```bash
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>   # ref is in the URL / Settings
supabase db push           # applies everything in supabase/migrations/
```

## 4. Create your first admin (internal user)

Admins are separate from company users and are not created by signup UI.

1. **Authentication → Users → Add user** — create the admin's email + password
   (or have them sign up once through the app's admin login).
2. Copy that user's **UID** from the Users list.
3. In the **SQL Editor**, run (swap in the UID / details):

```sql
insert into public.admin_users (id, full_name, email, role)
values ('PASTE-AUTH-UID', 'Priya Nair', 'priya@hireaster.com', 'super');
```

Roles: `super`, `support`, `billing`.

## 5. Create your first company + owner (customer)

1. Create an auth user for the owner (Authentication → Users, or app signup).
2. Run:

```sql
with c as (
  insert into public.companies (name, slug, plan, status, region)
  values ('Oryx Studio', 'oryx-studio', 'pro', 'active', 'MY')
  returning id
)
insert into public.profiles (id, company_id, full_name, email, role, status)
select 'PASTE-AUTH-UID', c.id, 'Shah Ramly', 'shah@oryx.studio', 'owner', 'active' from c;
```

---

## What the RLS guarantees (already in the migration)

| Rule | How it's enforced |
|---|---|
| A company only sees its own data | Every customer policy is keyed on `current_company_id()` |
| **Admins cannot see resumes / candidate PII** | `candidates`, `applications`, `interviews`, `scorecards` and the `resumes` bucket have **no admin policy** → admin sessions read zero rows |
| Admins get only aggregate company stats | `admin_company_overview()` returns counts, never candidate rows |
| **No card data stored/shown** | `subscriptions` has no card columns — only processor reference ids |
| Admin RBAC (super / support / billing) | Admin policies check `current_admin_role()` (e.g. billing sees subscriptions but not users; support sees users/tickets but not billing/flags) |
| Audit log is tamper-proof | `audit_log` has insert + select policies but **no update/delete** → append-only |

## Next steps in the app (not done yet)

The schema is ready; the app still uses mock data. The wiring order is:
1. **Auth** — point the customer login/signup and the separate admin login at
   Supabase Auth.
2. **Read paths** — replace mock reads screen by screen with Supabase queries.
3. **Write paths** — actions (create job, move stage, resolve ticket, toggle
   flag) write through, appending to `audit_log` where relevant.

Tell me which to wire first and I'll take it from there.
