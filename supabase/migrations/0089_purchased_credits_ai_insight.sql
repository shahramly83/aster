-- ============================================================================
-- 0089: Purchased (top-up) credits for AI Insight
-- ============================================================================
-- Adds a fourth buyable credit kind, 'ai_insight', on the same rule as the
-- others: spend the monthly plan pool first (usage_counters.ai_insights), then
-- the purchased balance, and never reset the purchased balance on renewal.
-- consume_ai_insight() mirrors consume_ai_rank(): it resolves the company from
-- the caller's JWT, so it stays callable by authenticated (no company param to
-- spoof), and returns `source` so a failed model call refunds the right pool.

create or replace function public.consume_ai_insight()
returns table (used int, monthly_limit int, resets_at date, charged boolean, source text)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date; v_limit int; v_used int; v_bal int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._ai_insight_limit((select plan from public.companies where id = v_company));
  insert into public.usage_counters (company_id, period) values (v_company, v_period)
    on conflict (company_id, period) do nothing;
  select ai_insights into v_used from public.usage_counters where company_id = v_company and period = v_period for update;
  if v_limit is null or v_used < v_limit then
    update public.usage_counters set ai_insights = ai_insights + 1
      where company_id = v_company and period = v_period returning ai_insights into v_used;
    return query select v_used, v_limit, v_reset, true, 'monthly'::text;
    return;
  end if;
  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = v_company and kind = 'ai_insight' and balance > 0 returning balance into v_bal;
  if v_bal is not null then
    return query select v_used, v_limit, v_reset, true, 'purchased'::text;
    return;
  end if;
  return query select v_used, v_limit, v_reset, false, 'none'::text;
end $$;
grant execute on function public.consume_ai_insight() to authenticated;
