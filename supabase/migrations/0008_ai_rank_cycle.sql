-- ============================================================================
-- Aster — AI Rank credits on a rolling 30-day cycle from signup
-- ============================================================================
-- Credits reset every 30 days counted from the company's signup (created_at),
-- not on the calendar 1st. The current cycle is identified by its start date;
-- usage_counters.period stores that cycle-start (YYYY-MM-DD).

-- Current cycle's period key + the date it next resets, for a given signup time.
create or replace function public._ai_rank_period(p_created timestamptz)
returns table (period text, resets_at date)
language sql stable as $$
  with c as (
    select greatest(0, floor(extract(epoch from (now() - p_created)) / 86400 / 30))::int as idx
  )
  select to_char(p_created + ((select idx from c) * 30) * interval '1 day', 'YYYY-MM-DD'),
         (p_created + (((select idx from c) + 1) * 30) * interval '1 day')::date;
$$;

-- Current cycle's usage + the plan limit + the next reset date.
create or replace function public.get_ai_rank_usage()
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
  select period, resets_at into v_period, v_reset from public._ai_rank_period(v_created);
  return query
    select coalesce((select ai_runs from public.usage_counters
                       where company_id = v_company and period = v_period), 0),
           public._ai_rank_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;

-- Charge one credit for the current cycle unless the plan limit is reached.
create or replace function public.bump_ai_rank()
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
  select period, resets_at into v_period, v_reset from public._ai_rank_period(v_created);
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

  return query select v_used, v_limit, v_reset;
end $$;

grant execute on function public.get_ai_rank_usage() to authenticated;
grant execute on function public.bump_ai_rank() to authenticated;
