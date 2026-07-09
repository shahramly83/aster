-- ============================================================================
-- Aster — reconciled credit limits (4 tiers) + See Why credit RPCs
-- ============================================================================
-- Runs after 0024 (which adds the 'growth' enum value in its own transaction),
-- so these bodies may safely reference 'growth'. Sets every metered pool to its
-- locked-matrix value, per tier:
--
--   pool                 free   growth   pro     enterprise
--   job posts             1       5       10      unlimited
--   applicant parsing     100     500     1000    unlimited
--   bulk upload parsing   10      50      100     unlimited
--   AI Rank               5       30      100     unlimited   (shared by
--                                                              match-to-role
--                                                              + database rank)
--   AI Insight            5       100     300     unlimited
--   AI Interview Qs       5       100     300     unlimited
--   See Why               5       30      100     unlimited   (Option B: own
--                                                              credit, charged
--                                                              per candidate,
--                                                              cached)
--
-- null limit = unlimited. All pools reset on the rolling 30-day cycle from
-- signup (reusing _ai_rank_period).

-- ---------------------------------------------------------------------------
-- Reconciled limit functions (matrix numbers, 4 tiers).
-- ---------------------------------------------------------------------------
create or replace function public._job_post_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 1 when 'growth' then 5 when 'pro' then 10 else null end;
$$;

create or replace function public._ai_rank_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 5 when 'growth' then 30 when 'pro' then 100 else null end;
$$;

create or replace function public._see_why_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 5 when 'growth' then 30 when 'pro' then 100 else null end;
$$;

create or replace function public._ai_insight_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 5 when 'growth' then 100 when 'pro' then 300 else null end;
$$;

create or replace function public._interview_q_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 5 when 'growth' then 100 when 'pro' then 300 else null end;
$$;

create or replace function public._applicant_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 100 when 'growth' then 500 when 'pro' then 1000 else null end;
$$;

create or replace function public._bulk_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 10 when 'growth' then 50 when 'pro' then 100 else null end;
$$;

-- ---------------------------------------------------------------------------
-- See Why usage + charge RPCs (mirrors the AI Rank pattern in 0008). A credit
-- is charged once per candidate by the caller and cached; the bump advances the
-- cycle counter unless the plan cap is hit.
-- ---------------------------------------------------------------------------
create or replace function public.get_see_why_usage()
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
    select coalesce((select see_why from public.usage_counters
                       where company_id = v_company and period = v_period), 0),
           public._see_why_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;

create or replace function public.bump_see_why()
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
  v_limit := public._see_why_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select see_why into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set see_why = see_why + 1
      where company_id = v_company and period = v_period
      returning see_why into v_used;
  end if;

  return query select v_used, v_limit, v_reset;
end $$;

grant execute on function public.get_see_why_usage() to authenticated;
grant execute on function public.bump_see_why() to authenticated;
