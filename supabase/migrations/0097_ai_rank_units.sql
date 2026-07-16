-- ============================================================================
-- 0097: AI Rank priced per N candidates (multi-credit atomic charge)
-- ============================================================================
-- AI Rank used to cost a flat 1 credit per run no matter the size. It now costs
-- 1 credit per N candidates: the caller passes how many CREDITS (units) a run
-- needs (ceil(count/10) on the Applicants board, ceil(count/50) in Candidate
-- Search) and this charges them atomically — monthly plan pool first, then the
-- purchased top-up balance — returning the split so a failed model call refunds
-- exactly what it took.
--
-- If the workspace can't afford the full run, NOTHING is charged and `available`
-- (monthly remaining + purchased) is returned, so the caller can offer a top-up
-- or a partial run of just what's affordable.
create or replace function public.consume_ai_rank_units(p_units int)
returns table (
  charged boolean, monthly_charged int, purchased_charged int,
  used int, monthly_limit int, resets_at date, available int
)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date;
  v_limit int; v_used int; v_bal int;
  v_remaining int; v_avail int; v_from_month int; v_from_purch int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  if p_units is null or p_units < 1 then p_units := 1; end if;

  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._ai_rank_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period) values (v_company, v_period)
    on conflict (company_id, period) do nothing;
  select ai_runs into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;
  v_used := coalesce(v_used, 0);

  -- Unlimited plan (no monthly cap): just record the runs, nothing to gate.
  if v_limit is null then
    update public.usage_counters set ai_runs = ai_runs + p_units
      where company_id = v_company and period = v_period returning ai_runs into v_used;
    return query select true, p_units, 0, v_used, v_limit, v_reset, 2147483647;
    return;
  end if;

  select coalesce(balance, 0) into v_bal from public.purchased_credits
    where company_id = v_company and kind = 'ai_rank';
  v_bal := coalesce(v_bal, 0);
  v_remaining := greatest(v_limit - v_used, 0);           -- monthly credits left
  v_avail := v_remaining + v_bal;                         -- total affordable

  -- Can't afford the whole run: charge nothing, report what's available so the
  -- caller can offer a partial run or a top-up.
  if v_avail < p_units then
    return query select false, 0, 0, v_used, v_limit, v_reset, v_avail;
    return;
  end if;

  v_from_month := least(p_units, v_remaining);
  v_from_purch := p_units - v_from_month;

  if v_from_month > 0 then
    update public.usage_counters set ai_runs = ai_runs + v_from_month
      where company_id = v_company and period = v_period returning ai_runs into v_used;
  end if;
  if v_from_purch > 0 then
    update public.purchased_credits set balance = balance - v_from_purch, updated_at = now()
      where company_id = v_company and kind = 'ai_rank';
  end if;

  return query select true, v_from_month, v_from_purch, v_used, v_limit, v_reset, greatest(v_avail - p_units, 0);
end $$;
grant execute on function public.consume_ai_rank_units(int) to authenticated;

-- Refund an exact split when our model call failed after charging. Monthly credits
-- go back to the counter (never below 0); purchased credits back to the balance.
-- Service-role only (takes a company id), same rule as the other refunds.
create or replace function public.refund_ai_rank_units(p_company uuid, p_monthly int, p_purchased int)
returns void language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text;
begin
  if coalesce(p_monthly, 0) > 0 then
    select created_at into v_created from public.companies where id = p_company;
    select period into v_period from public._ai_rank_period(v_created);
    update public.usage_counters set ai_runs = greatest(ai_runs - p_monthly, 0)
      where company_id = p_company and period = v_period;
  end if;
  if coalesce(p_purchased, 0) > 0 then
    update public.purchased_credits set balance = balance + p_purchased, updated_at = now()
      where company_id = p_company and kind = 'ai_rank';
  end if;
end $$;
revoke all on function public.refund_ai_rank_units(uuid, int, int) from public, anon, authenticated;
grant execute on function public.refund_ai_rank_units(uuid, int, int) to service_role;
