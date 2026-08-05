-- ============================================================================
-- 0155: what the AI actually costs us, per workspace, per month
-- ============================================================================
-- The console can show what a customer PAYS (Stripe) and what they USED
-- (credit_spend_log), but not what serving them cost. No edge function records
-- token spend, so there is no measured cost to read back. Rather than invent
-- one, this stores a rate per action type that an admin sets, and exposes the
-- usage counts to multiply it by. Cost is therefore a stated model, not a
-- measurement, and the rate is visible and editable rather than buried in code.
--
-- Two objects:
--   ai_unit_costs      -- sen per AI action, admin-editable
--   admin_usage_detail -- per company, per month: counts by action type
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Rates. Keyed by the same `kind` strings credit_spend_log records, so a new
-- credit type needs a row here and nothing else. Cost is in sen (1/100 MYR)
-- and integer-free: fractions of a sen per call are normal.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_unit_costs (
  kind       text primary key,
  cost_sen   numeric(10,4) not null default 0 check (cost_sen >= 0),
  label      text not null,
  updated_at timestamptz not null default now(),
  -- Who last changed it. No foreign key on purpose: the editor is an Aster admin
  -- (admin_users), not a customer user (profiles), and the audit log is the real
  -- record of who did what. A key here would only add ways for a save to fail.
  updated_by uuid
);

-- Seed the five kinds the app logs today. Zeroed deliberately: a made-up rate
-- would read as fact on the dashboard. An admin sets these once, in the UI.
insert into public.ai_unit_costs (kind, label, cost_sen) values
  ('resume_screen',       'Resume screening',   0),
  ('applicant_screen',    'Applicant screening', 0),
  ('ai_rank',             'AI rank',            0),
  ('ai_insight',          'AI insight',         0),
  ('interview_questions', 'Interview questions', 0)
on conflict (kind) do nothing;

alter table public.ai_unit_costs enable row level security;

-- Admin-only, both ways. Nothing in the customer app reads this.
drop policy if exists ai_unit_costs_admin_read on public.ai_unit_costs;
create policy ai_unit_costs_admin_read on public.ai_unit_costs
  for select using (public.is_admin());

revoke all on table public.ai_unit_costs from public, anon;
grant select on table public.ai_unit_costs to authenticated;

-- Writes go through the RPC, never straight at the table, so every change is
-- role-checked in one place.
create or replace function public.set_ai_unit_cost(p_kind text, p_cost_sen numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_cost_sen is null or p_cost_sen < 0 then
    raise exception 'cost must be zero or more';
  end if;
  update public.ai_unit_costs
     set cost_sen = p_cost_sen, updated_at = now(), updated_by = auth.uid()
   where kind = p_kind;
  if not found then raise exception 'unknown AI action: %', p_kind; end if;
end $$;
revoke all on function public.set_ai_unit_cost(text, numeric) from public, anon;
grant execute on function public.set_ai_unit_cost(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Usage per company for one month, broken down by action type. p_period is
-- 'YYYY-MM'; null means the current month. Counts come from credit_spend_log
-- (one row per action, so quantity is summed rather than counted).
--
-- Every company is returned, including those with no usage, so the Usage screen
-- can show a zero row rather than silently omitting a workspace.
-- ---------------------------------------------------------------------------
create or replace function public.admin_usage_detail(p_period text default null)
returns table (
  company_id uuid,
  company_name text,
  plan plan_tier,
  status company_status,
  period text,
  resume_screen bigint,
  applicant_screen bigint,
  ai_rank bigint,
  ai_insight bigint,
  interview_questions bigint,
  total_actions bigint,
  monthly_pool bigint,
  purchased_pool bigint
) language plpgsql stable security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, to_char(now(), 'YYYY-MM'));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with spend as (
      select l.company_id,
             sum(l.quantity) filter (where l.kind = 'resume_screen')       as resume_screen,
             sum(l.quantity) filter (where l.kind = 'applicant_screen')    as applicant_screen,
             sum(l.quantity) filter (where l.kind = 'ai_rank')             as ai_rank,
             sum(l.quantity) filter (where l.kind = 'ai_insight')          as ai_insight,
             sum(l.quantity) filter (where l.kind = 'interview_questions') as interview_questions,
             sum(l.quantity)                                               as total_actions,
             sum(l.quantity) filter (where l.pool = 'monthly')             as monthly_pool,
             sum(l.quantity) filter (where l.pool = 'purchased')           as purchased_pool
        from public.credit_spend_log l
       where to_char(l.created_at, 'YYYY-MM') = v_period
       group by l.company_id
    )
    select c.id, c.name, c.plan, c.status, v_period,
           coalesce(s.resume_screen, 0),
           coalesce(s.applicant_screen, 0),
           coalesce(s.ai_rank, 0),
           coalesce(s.ai_insight, 0),
           coalesce(s.interview_questions, 0),
           coalesce(s.total_actions, 0),
           coalesce(s.monthly_pool, 0),
           coalesce(s.purchased_pool, 0)
      from public.companies c
      left join spend s on s.company_id = c.id
     order by coalesce(s.total_actions, 0) desc, c.name;
end $$;
revoke all on function public.admin_usage_detail(text) from public, anon;
grant execute on function public.admin_usage_detail(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The console showed a blank "Owner:" under every company because nothing
-- returned one. Add the owner's name and email to the existing detail RPC.
-- These are workspace staff, never candidates.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_company_detail();
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz,
  owner_name text, owner_email text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.status, c.region,
           (select count(*) from public.profiles p where p.company_id = c.id),
           (select count(*) from public.candidates ca where ca.company_id = c.id),
           (select count(*) from public.jobs j where j.company_id = c.id and j.status = 'open'),
           s.status, s.cycle, s.current_period_end, c.created_at,
           o.full_name, o.email
    from public.companies c
    left join public.subscriptions s on s.company_id = c.id
    left join lateral (
      select p.full_name, p.email
        from public.profiles p
       where p.company_id = c.id and p.role = 'owner'
       order by p.created_at
       limit 1
    ) o on true
    order by c.created_at desc;
end $$;
revoke all on function public.admin_company_detail() from public, anon;
grant execute on function public.admin_company_detail() to authenticated;
