-- ============================================================================
-- 0087: Purchased (top-up) credits for AI Applicant Screening and AI Rank
-- ============================================================================
-- Extends the 0086 machinery to two more credit kinds:
--   'applicant_screen' — inbound applicant screening (usage_counters.applicant_parsing)
--   'ai_rank'          — AI Rank runs (usage_counters.ai_runs)
-- Same rule as resume_screen: spend the monthly plan pool first, then the
-- purchased balance, and never reset the purchased balance on renewal.

-- Applicant screening: consumed by parse-application (service_role, has company id).
create or replace function public.consume_applicant_screen_for(p_company uuid)
returns table (ok boolean, source text, monthly_used int, monthly_limit int, purchased_balance int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_limit int; v_used int; v_bal int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  v_limit := public._applicant_parse_limit((select plan from public.companies where id = p_company));
  select coalesce(applicant_parsing, 0) into v_used
    from public.usage_counters where company_id = p_company and period = v_period;
  v_used := coalesce(v_used, 0);
  if v_limit is null or v_used < v_limit then
    insert into public.usage_counters (company_id, period) values (p_company, v_period)
      on conflict (company_id, period) do nothing;
    update public.usage_counters set applicant_parsing = applicant_parsing + 1
      where company_id = p_company and period = v_period returning applicant_parsing into v_used;
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'applicant_screen';
    return query select true, 'monthly'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;
  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = p_company and kind = 'applicant_screen' and balance > 0 returning balance into v_bal;
  if v_bal is null then
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'applicant_screen';
    return query select false, 'none'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;
  return query select true, 'purchased'::text, v_used, v_limit, v_bal;
end $$;

-- AI Rank: consumed by the caller's own JWT (rank-candidates via _shared/meter). Mirrors
-- bump_ai_rank's shape (used/limit/reset/charged) and adds `source` so the caller can
-- refund the right pool if the model call then fails.
create or replace function public.consume_ai_rank()
returns table (used int, monthly_limit int, resets_at date, charged boolean, source text)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date; v_limit int; v_used int; v_bal int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._ai_rank_limit((select plan from public.companies where id = v_company));
  insert into public.usage_counters (company_id, period) values (v_company, v_period)
    on conflict (company_id, period) do nothing;
  select ai_runs into v_used from public.usage_counters where company_id = v_company and period = v_period for update;
  if v_limit is null or v_used < v_limit then
    update public.usage_counters set ai_runs = ai_runs + 1
      where company_id = v_company and period = v_period returning ai_runs into v_used;
    return query select v_used, v_limit, v_reset, true, 'monthly'::text;
    return;
  end if;
  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = v_company and kind = 'ai_rank' and balance > 0 returning balance into v_bal;
  if v_bal is not null then
    return query select v_used, v_limit, v_reset, true, 'purchased'::text;
    return;
  end if;
  return query select v_used, v_limit, v_reset, false, 'none'::text;
end $$;
grant execute on function public.consume_ai_rank() to authenticated;

-- Hand one purchased credit back (model call failed after we drew from the balance).
create or replace function public.refund_purchased_credit(p_company uuid, p_kind text)
returns void language sql security definer set search_path = public as $$
  update public.purchased_credits set balance = balance + 1, updated_at = now()
    where company_id = p_company and kind = p_kind;
$$;

-- Lock the company-parameter consume functions to service_role. Without this an
-- authenticated user could call them with ANOTHER company's id and drain its
-- credits. (consume_ai_rank takes no id — it resolves the company from the JWT —
-- so it stays callable by authenticated.) This also repairs 0086's function,
-- which was left executable by PUBLIC.
revoke all on function public.consume_resume_screen_for(uuid)    from public, anon, authenticated;
grant execute on function public.consume_resume_screen_for(uuid)    to service_role;
revoke all on function public.consume_applicant_screen_for(uuid) from public, anon, authenticated;
grant execute on function public.consume_applicant_screen_for(uuid) to service_role;
revoke all on function public.refund_purchased_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_purchased_credit(uuid, text) to service_role;
