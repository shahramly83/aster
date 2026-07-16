-- 0093_reset_usage_on_plan_change.sql
--
-- When a plan changes (a deferred downgrade taking effect at period end, or an
-- upgrade), the customer should start the NEW plan's allowance fresh. Otherwise
-- usage racked up on the old plan sits against the new plan's limit and the meter
-- reads nonsense, e.g. "1000 / 100" right after Elite -> Launch.
--
-- This zeroes the AI/screening metered counters for the company's CURRENT usage
-- period (the rolling-30-day cycle keyed off signup, via _ai_rank_period). It does
-- NOT touch job/post counters. Called by stripe-webhook (service role) the moment a
-- plan change is applied — so the reset lands exactly when the plan actually flips.
create or replace function public.reset_current_usage(p_company uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz;
  v_period  text;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then return; end if;
  select period into v_period from public._ai_rank_period(v_created);

  update public.usage_counters
     set resume_parsing     = 0,
         applicant_parsing  = 0,
         ai_runs            = 0,
         ai_insights        = 0,
         interview_questions = 0,
         see_why            = 0
   where company_id = p_company
     and period = v_period;
end $$;

-- Service-role only: the webhook calls it. A client resetting its own usage would
-- be free unlimited AI, so keep it off `authenticated`/`anon` (same rule as the
-- refund functions in 0046).
revoke all on function public.reset_current_usage(uuid) from public, anon, authenticated;
