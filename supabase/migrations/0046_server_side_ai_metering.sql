-- ============================================================================
-- 0046: make AI credits enforceable on the server (decision D4)
-- ============================================================================
-- rank-candidates and analyze-experience verify the JWT and then call Anthropic.
-- Neither checks or bumps a counter — the *browser* does it, after the fact. So
-- any signed-in user can invoke either function directly, in a loop, for
-- unlimited Claude spend billed to us. parse-resume is the only AI function that
-- meters server-side. Everything else is an honour system.
--
-- Two blockers had to be cleared first:
--
-- 1. bump_ai_rank() cannot report refusal. At the cap it skips the UPDATE and
--    returns `used = limit` — byte-for-byte identical to the call that consumed
--    the final credit. A browser can live with that ambiguity. A server deciding
--    whether to spend money cannot. It now also returns `charged boolean`.
--
-- 2. There is no bump_ai_insight() at all. _ai_insight_limit() exists and the UI
--    renders a meter against it, but nothing ever incremented a counter, and
--    aiInsightsUsed was never hydrated on load — so the cap reset to zero on
--    every page refresh. AI Insight spend has been entirely uncapped.
--
-- Charging happens BEFORE the Anthropic call, or the cap is unenforceable. The
-- refund functions below undo it when *our* call fails, so an outage on our side
-- is not billed to the customer. They take a company id and are therefore
-- service-role only: exposing a credit-returning function to `authenticated`
-- would let anyone refund themselves to infinity. This is the same mistake 0034
-- made with bump_resume_parse_for, which 0041 had to revoke.

-- ---------------------------------------------------------------------------
-- 1. bump_ai_rank: report whether the credit was actually taken
-- ---------------------------------------------------------------------------
-- Return type changes, so drop and recreate. Existing callers read `used` by
-- name and are unaffected by the extra column.
drop function if exists public.bump_ai_rank();

create function public.bump_ai_rank()
returns table (used int, monthly_limit int, resets_at date, charged boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_limit   int;
  v_used    int;
  v_charged boolean := false;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._ai_rank_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  -- FOR UPDATE serialises concurrent callers, so the cap cannot be overshot.
  select ai_runs into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set ai_runs = ai_runs + 1
      where company_id = v_company and period = v_period
      returning ai_runs into v_used;
    v_charged := true;
  end if;

  return query select v_used, v_limit, v_reset, v_charged;
end $$;
grant execute on function public.bump_ai_rank() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. AI Insight metering, which never existed
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_insight_usage()
returns table (used int, monthly_limit int, resets_at date)
language plpgsql stable security definer set search_path = public as $$
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
    select coalesce((select ai_insights from public.usage_counters
                     where company_id = v_company and period = v_period), 0),
           public._ai_insight_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;
grant execute on function public.get_ai_insight_usage() to authenticated;

create or replace function public.bump_ai_insight()
returns table (used int, monthly_limit int, resets_at date, charged boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_limit   int;
  v_used    int;
  v_charged boolean := false;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._ai_insight_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select ai_insights into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set ai_insights = ai_insights + 1
      where company_id = v_company and period = v_period
      returning ai_insights into v_used;
    v_charged := true;
  end if;

  return query select v_used, v_limit, v_reset, v_charged;
end $$;
grant execute on function public.bump_ai_insight() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Refunds — service_role ONLY
-- ---------------------------------------------------------------------------
-- Called by the edge function when the Anthropic request fails, so our outage is
-- not billed to the customer. These take a company id and hand credits BACK, so
-- exposing them to `authenticated` would be a self-service credit printer.
-- Floor at zero: a refund must never manufacture credit out of an empty counter.
create or replace function public.refund_ai_rank_for(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.usage_counters set ai_runs = greatest(ai_runs - 1, 0)
  where company_id = p_company
    and period = (select period from public._ai_rank_period(
                    (select created_at from public.companies where id = p_company)));
$$;

create or replace function public.refund_ai_insight_for(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.usage_counters set ai_insights = greatest(ai_insights - 1, 0)
  where company_id = p_company
    and period = (select period from public._ai_rank_period(
                    (select created_at from public.companies where id = p_company)));
$$;

revoke all on function public.refund_ai_rank_for(uuid)    from public, anon, authenticated;
revoke all on function public.refund_ai_insight_for(uuid) from public, anon, authenticated;
grant execute on function public.refund_ai_rank_for(uuid)    to service_role;
grant execute on function public.refund_ai_insight_for(uuid) to service_role;
