-- ============================================================================
-- Aster — AI Rank credit metering (per company, per month, by plan)
-- ============================================================================
-- AI Rank usage is counted in usage_counters.ai_runs for the caller's company
-- and the current month. The monthly credit limit is derived from the company's
-- plan on the server so it can't be spoofed by the client:
--   starter → 30 credits/month,  pro / enterprise → unlimited.
-- Customers can already READ their own usage_counters (RLS); writes go only
-- through these SECURITY DEFINER functions.

create or replace function public._ai_rank_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'starter' then 30 else null end; -- null = unlimited
$$;

-- Current month's usage + the plan's limit (limit null = unlimited).
create or replace function public.get_ai_rank_usage()
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_period  text := to_char(now(), 'YYYY-MM');
begin
  if v_company is null then return; end if;
  return query
    select coalesce((select ai_runs from public.usage_counters
                       where company_id = v_company and period = v_period), 0),
           public._ai_rank_limit((select plan from public.companies where id = v_company));
end $$;

-- Charge one AI Rank credit for this month, unless the plan limit is reached.
-- Returns the resulting usage + limit; if already at the limit it does not
-- increment (so it's safe to call and then check the returned `used`).
create or replace function public.bump_ai_rank()
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_period  text := to_char(now(), 'YYYY-MM');
  v_limit   int;
  v_used    int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  v_limit := public._ai_rank_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select ai_runs into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set ai_runs = ai_runs + 1
      where company_id = v_company and period = v_period
      returning ai_runs into v_used;
  end if;

  return query select v_used, v_limit;
end $$;

grant execute on function public.get_ai_rank_usage() to authenticated;
grant execute on function public.bump_ai_rank() to authenticated;
