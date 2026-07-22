-- ============================================================================
-- 0126: sell AI Question credits
-- ============================================================================
-- AI Rank and AI Insights both fall through to a purchased balance when the
-- monthly allowance runs out (0087, 0089). Interview questions never did: they
-- were charged by bump_interview_questions (0062), which only knows about the
-- monthly counter, so a workspace that hit its cap had no way to keep going
-- short of upgrading the plan.
--
-- consume_interview_questions mirrors consume_ai_insight exactly: spend the
-- monthly allowance first, fall through to purchased credits, and report which
-- pool paid so the edge function can refund the right one on failure. Monthly
-- first matters — purchased credits never expire, so spending them ahead of an
-- allowance that resets in days would quietly waste them.
--
-- purchased_credits.kind is free text with no check constraint, so
-- 'interview_questions' needs no schema change.
create or replace function public.consume_interview_questions()
returns table (used int, monthly_limit int, resets_at date, charged boolean, source text)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date; v_limit int; v_used int; v_bal int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._interview_q_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period) values (v_company, v_period)
    on conflict (company_id, period) do nothing;
  select interview_questions into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set interview_questions = interview_questions + 1
      where company_id = v_company and period = v_period returning interview_questions into v_used;
    return query select v_used, v_limit, v_reset, true, 'monthly'::text;
    return;
  end if;

  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = v_company and kind = 'interview_questions' and balance > 0 returning balance into v_bal;
  if v_bal is not null then
    return query select v_used, v_limit, v_reset, true, 'purchased'::text;
    return;
  end if;

  return query select v_used, v_limit, v_reset, false, 'none'::text;
end $$;

grant execute on function public.consume_interview_questions() to authenticated;
