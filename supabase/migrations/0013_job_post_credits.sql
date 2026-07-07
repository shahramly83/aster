-- ============================================================================
-- Aster — job-posting credits on a rolling 30-day cycle from signup
-- ============================================================================
-- Publishing a job (or reopening a closed one) spends one job credit. Credits
-- renew every 30 days from the company's signup, on the same cycle as AI Rank
-- (reusing _ai_rank_period). Drafts are free and don't spend a credit; closing
-- a role does not refund one. starter = 5 posts / cycle; pro/enterprise = null
-- (unlimited), mirroring _ai_rank_limit.

alter table public.usage_counters add column if not exists jobs_posted int not null default 0;

create or replace function public._job_post_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'starter' then 5 else null end;  -- pro / enterprise = unlimited
$$;

-- Return-type parity with the AI Rank RPCs; drop first so the shape can't clash.
drop function if exists public.get_job_post_usage();
drop function if exists public.bump_job_post();

-- Current cycle's job-post usage + the plan limit + the next reset date.
create or replace function public.get_job_post_usage()
returns table (used int, monthly_limit int, resets_at date)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
begin
  if v_company is null then return; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  return query
    select coalesce((select jobs_posted from public.usage_counters
                       where company_id = v_company and period = v_period), 0),
           public._job_post_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;

-- Charge one job credit for the current cycle unless the plan limit is reached.
create or replace function public.bump_job_post()
returns table (used int, monthly_limit int, resets_at date)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_limit   int;
  v_used    int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._job_post_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select jobs_posted into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set jobs_posted = jobs_posted + 1
      where company_id = v_company and period = v_period
      returning jobs_posted into v_used;
  end if;

  return query select v_used, v_limit, v_reset;
end $$;

grant execute on function public.get_job_post_usage() to authenticated;
grant execute on function public.bump_job_post() to authenticated;
