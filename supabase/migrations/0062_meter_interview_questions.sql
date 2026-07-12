-- 0062_meter_interview_questions.sql
--
-- Server-side metering for AI interview-question generation, so the new
-- generate-interview-questions edge function can charge a credit BEFORE calling
-- Claude (and refund on failure). Mirrors bump_ai_insight / refund_ai_insight_for
-- (0046) against the existing usage_counters.interview_questions column (0024)
-- and _interview_q_limit() (0026/0040).

create or replace function public.get_interview_q_usage()
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
    select coalesce((select interview_questions from public.usage_counters
                     where company_id = v_company and period = v_period), 0),
           public._interview_q_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;
grant execute on function public.get_interview_q_usage() to authenticated;

create or replace function public.bump_interview_questions()
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
  v_limit := public._interview_q_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  -- FOR UPDATE serialises concurrent callers, so the cap cannot be overshot.
  select interview_questions into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set interview_questions = interview_questions + 1
      where company_id = v_company and period = v_period
      returning interview_questions into v_used;
    v_charged := true;
  end if;

  return query select v_used, v_limit, v_reset, v_charged;
end $$;
grant execute on function public.bump_interview_questions() to authenticated;

-- Refund (service_role only) for when our Anthropic call fails after charging.
create or replace function public.refund_interview_questions_for(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.usage_counters set interview_questions = greatest(interview_questions - 1, 0)
  where company_id = p_company
    and period = (select period from public._ai_rank_period(
                    (select created_at from public.companies where id = p_company)));
$$;
revoke all on function public.refund_interview_questions_for(uuid) from public, anon, authenticated;
grant execute on function public.refund_interview_questions_for(uuid) to service_role;
