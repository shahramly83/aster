-- ============================================================================
-- Aster — initial schema + Row Level Security
-- ============================================================================
-- Security model (enforced in the DB, not just the UI):
--   * Supabase Auth (auth.users) is shared. A signed-in user is EITHER a
--     company user (row in public.profiles, tied to one company) OR an Aster
--     admin (row in public.admin_users). Never both.
--   * Multi-tenant isolation: a company only ever sees its own rows.
--   * Candidate data (candidates, applications, interviews, scorecards, and the
--     resumes bucket) is NEVER exposed to admins. There is simply no admin
--     policy on those tables, so admin sessions read zero rows. Admins get only
--     aggregate counts via a SECURITY DEFINER function.
--   * public.subscriptions stores processor *reference ids* only — no card
--     number, CVV, expiry or last4. Card data lives with the payment processor.
--   * public.audit_log is append-only (no update/delete policy).
--   * Admin RBAC: super | support | billing, encoded in policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type company_status as enum ('trial','active','suspended','churned');
  create type plan_tier      as enum ('starter','pro','enterprise');
  create type profile_role   as enum ('owner','admin','recruiter','interviewer');
  create type profile_status as enum ('active','invited','suspended');
  create type admin_role     as enum ('super','support','billing');
  create type sub_status     as enum ('trialing','active','past_due','canceled');
  create type app_stage      as enum ('applied','shortlisted','interviewing','offer','hired','rejected');
  create type ticket_status  as enum ('open','pending','resolved');
  create type ticket_priority as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  plan        plan_tier not null default 'starter',
  status      company_status not null default 'trial',
  region      text,
  created_at  timestamptz not null default now()
);

-- Company users (customers). id == auth.users.id.
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete cascade,
  full_name      text,
  email          text,
  role           profile_role not null default 'recruiter',
  status         profile_status not null default 'active',
  last_active_at timestamptz,
  created_at     timestamptz not null default now()
);

-- Aster internal staff. id == auth.users.id. Separate from profiles.
create table if not exists public.admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        admin_role not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  title       text not null,
  status      text not null default 'open',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- SENSITIVE: candidate PII. Never exposed to admins (no admin policy below).
create table if not exists public.candidates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  full_name         text,
  email             text,
  phone             text,
  location          text,
  summary           text,
  years_experience  int,
  skills            jsonb not null default '[]',
  resume_path       text,   -- points at the private `resumes` storage bucket
  photo_path        text,
  created_at        timestamptz not null default now()
);

create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  candidate_id  uuid not null references public.candidates(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  stage         app_stage not null default 'applied',
  match_score   int,
  match_reasons jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.interviews (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete set null,
  interviewer_id uuid references public.profiles(id) on delete set null,
  scheduled_at   timestamptz,
  status         text not null default 'scheduled',
  created_at     timestamptz not null default now()
);

create table if not exists public.scorecards (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete set null,
  interviewer_id uuid references public.profiles(id) on delete set null,
  ratings        jsonb not null default '{}',
  notes          text,
  created_at     timestamptz not null default now()
);

-- Billing. NO card columns — only processor references + plan/status.
create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null unique references public.companies(id) on delete cascade,
  plan                  plan_tier not null default 'starter',
  cycle                 text not null default 'monthly',
  status                sub_status not null default 'trialing',
  seats                 int not null default 1,
  current_period_end    date,
  processor_customer_id text,   -- e.g. Stripe customer id (a reference, not card data)
  processor_sub_id      text,   -- e.g. Stripe subscription id
  created_at            timestamptz not null default now()
  -- Intentionally NO card number / cvv / expiry / last4 columns.
);

create table if not exists public.usage_counters (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  period         text not null,           -- e.g. '2026-07'
  resume_parsing int not null default 0,
  ai_runs        int not null default 0,
  active_jobs    int not null default 0,
  api_calls      int not null default 0,
  unique (company_id, period)
);

create table if not exists public.support_tickets (
  id            text primary key,          -- e.g. 'T-1042'
  company_id    uuid references public.companies(id) on delete set null,
  subject       text not null,
  requester_id  uuid references public.profiles(id) on delete set null,
  channel       text,
  priority      ticket_priority not null default 'normal',
  status        ticket_status not null default 'open',
  body          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.feature_flags (
  key          text primary key,
  label        text,
  description  text,
  enabled      boolean not null default false,
  rollout      int not null default 0,
  environment  text not null default 'prod',
  updated_by   uuid references public.admin_users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Append-only audit trail of admin actions.
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.admin_users(id) on delete set null,
  actor_name  text,
  actor_role  admin_role,
  action      text not null,
  target      text,
  ip          inet,
  created_at  timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists idx_profiles_company     on public.profiles(company_id);
create index if not exists idx_jobs_company         on public.jobs(company_id);
create index if not exists idx_candidates_company   on public.candidates(company_id);
create index if not exists idx_applications_company on public.applications(company_id);
create index if not exists idx_applications_job     on public.applications(job_id);
create index if not exists idx_interviews_company   on public.interviews(company_id);
create index if not exists idx_scorecards_company   on public.scorecards(company_id);
create index if not exists idx_usage_company        on public.usage_counters(company_id);
create index if not exists idx_tickets_company      on public.support_tickets(company_id);
create index if not exists idx_audit_created        on public.audit_log(created_at desc);

-- ---------- helper functions ----------
-- SECURITY DEFINER so they bypass RLS internally and can't cause policy
-- recursion when referenced from a policy on the same table.

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where id = auth.uid() and status = 'active');
$$;

create or replace function public.current_admin_role()
returns admin_role language sql stable security definer set search_path = public as $$
  select role from public.admin_users where id = auth.uid() and status = 'active';
$$;

grant execute on function public.current_company_id(), public.is_admin(), public.current_admin_role() to authenticated, anon;

-- Aggregate overview for admins. Returns counts only — never candidate rows —
-- so "admins cannot see resumes / candidate PII" holds even for reporting.
create or replace function public.admin_company_overview()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.status, c.region,
           (select count(*) from public.profiles p where p.company_id = c.id),
           (select count(*) from public.candidates ca where ca.company_id = c.id),
           (select count(*) from public.jobs j where j.company_id = c.id and j.status = 'open'),
           c.created_at
    from public.companies c
    order by c.created_at desc;
end $$;
grant execute on function public.admin_company_overview() to authenticated;

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_tickets_touch on public.support_tickets;
create trigger trg_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

-- ---------- grants (RLS restricts *rows*; grants enable the verb) ----------
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on
  public.companies, public.profiles, public.admin_users, public.jobs,
  public.candidates, public.applications, public.interviews, public.scorecards,
  public.subscriptions, public.usage_counters, public.support_tickets,
  public.feature_flags
  to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- enable RLS ----------
alter table public.companies       enable row level security;
alter table public.profiles        enable row level security;
alter table public.admin_users     enable row level security;
alter table public.jobs            enable row level security;
alter table public.candidates      enable row level security;
alter table public.applications    enable row level security;
alter table public.interviews      enable row level security;
alter table public.scorecards      enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.usage_counters  enable row level security;
alter table public.support_tickets enable row level security;
alter table public.feature_flags   enable row level security;
alter table public.audit_log       enable row level security;

-- ---------- policies ----------

-- companies: customers see their own; admins see all; only super may change.
create policy companies_customer_select on public.companies for select using (id = public.current_company_id());
create policy companies_admin_select    on public.companies for select using (public.is_admin());
create policy companies_admin_update    on public.companies for update using (public.current_admin_role() = 'super') with check (public.current_admin_role() = 'super');

-- profiles: self + teammates; owners/admins manage; super+support admins read.
create policy profiles_self           on public.profiles for select using (id = auth.uid());
create policy profiles_company_select on public.profiles for select using (company_id = public.current_company_id());
create policy profiles_company_manage on public.profiles for update
  using (company_id = public.current_company_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin')))
  with check (company_id = public.current_company_id());
create policy profiles_admin_select   on public.profiles for select using (public.current_admin_role() in ('super','support'));

-- admin_users: an admin sees their own row; super manages all.
create policy admin_self          on public.admin_users for select using (id = auth.uid());
create policy admin_super_select  on public.admin_users for select using (public.current_admin_role() = 'super');
create policy admin_super_manage  on public.admin_users for all using (public.current_admin_role() = 'super') with check (public.current_admin_role() = 'super');

-- candidate-adjacent tables: company-only, NO admin policy (admins read zero rows).
create policy jobs_company         on public.jobs         for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy candidates_company   on public.candidates   for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy applications_company on public.applications for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy interviews_company   on public.interviews   for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy scorecards_company   on public.scorecards   for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());

-- subscriptions: company reads own; super+billing admins read + change. (support: none)
create policy subs_customer_select on public.subscriptions for select using (company_id = public.current_company_id());
create policy subs_admin_select    on public.subscriptions for select using (public.current_admin_role() in ('super','billing'));
create policy subs_admin_update    on public.subscriptions for update using (public.current_admin_role() in ('super','billing')) with check (public.current_admin_role() in ('super','billing'));

-- usage: company reads own; any admin reads (aggregate only).
create policy usage_customer on public.usage_counters for select using (company_id = public.current_company_id());
create policy usage_admin    on public.usage_counters for select using (public.is_admin());

-- support tickets: company manages own; super+support admins read + update. (billing: none)
create policy tickets_company       on public.support_tickets for all using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy tickets_admin_select  on public.support_tickets for select using (public.current_admin_role() in ('super','support'));
create policy tickets_admin_update  on public.support_tickets for update using (public.current_admin_role() in ('super','support')) with check (public.current_admin_role() in ('super','support'));

-- feature flags: readable by any signed-in user (app gating); only super changes.
create policy flags_read         on public.feature_flags for select using (auth.uid() is not null);
create policy flags_super_write  on public.feature_flags for update using (public.current_admin_role() = 'super') with check (public.current_admin_role() = 'super');
create policy flags_super_insert on public.feature_flags for insert with check (public.current_admin_role() = 'super');

-- audit log: any active admin appends their own actions; super+billing read.
-- No update/delete policy => the log is append-only.
create policy audit_insert on public.audit_log for insert with check (public.is_admin() and actor_id = auth.uid());
create policy audit_select on public.audit_log for select using (public.current_admin_role() in ('super','billing'));
