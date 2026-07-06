-- ============================================================================
-- Aster — fix "column reference resets_at is ambiguous" in the AI Rank RPCs
-- ============================================================================
-- 0008 gave get_ai_rank_usage() and bump_ai_rank() a RETURNS TABLE column named
-- resets_at, and both also `select ... resets_at ... from _ai_rank_period(...)`.
-- Since _ai_rank_period also returns a resets_at column, the unqualified name is
-- ambiguous with the function's OUT column, so the RPC 400s and the UI shows 0
-- credits used. Alias the helper (p.period, p.resets_at) to disambiguate.
-- Return shapes are unchanged, so create-or-replace is enough (no drop).

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
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  return query
    select coalesce((select ai_runs from public.usage_counters
                       where company_id = v_company and period = v_period), 0),
           public._ai_rank_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;

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
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
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
