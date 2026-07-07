-- ============================================================================
-- Aster — job-post credits reflect jobs that are already live
-- ============================================================================
-- 0013 introduced the per-cycle job-post counter (usage_counters.jobs_posted),
-- but only *new* publishes/reopens bump it. Jobs that were already live when the
-- credit system launched were never counted, so a workspace with 3 open roles
-- showed "0 of 5 used" — the meter and reality disagreed.
--
-- Fix: a live (status = 'open') job holds one credit for the cycle, so floor the
-- reported usage at the number of currently-open jobs. The stored counter still
-- tracks spend within the cycle (closing a role does not refund the counter);
-- flooring only ensures the meter can never read fewer credits than the jobs
-- that are actually live. Applied to both the read (meter) and the bump (gate)
-- so they stay consistent.

-- Current cycle's job-post usage, floored at the live-job count.
create or replace function public.get_job_post_usage()
returns table (used int, monthly_limit int, resets_at date)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_stored  int;
  v_live    int;
begin
  if v_company is null then return; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  select coalesce((select jobs_posted from public.usage_counters
                     where company_id = v_company and period = v_period), 0) into v_stored;
  select count(*)::int into v_live from public.jobs
    where company_id = v_company and status = 'open';
  return query
    select greatest(v_stored, v_live),
           public._job_post_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;

-- Charge one job credit for the current cycle unless usage (floored at the live
-- count) has reached the plan limit.
create or replace function public.bump_job_post()
returns table (used int, monthly_limit int, resets_at date)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_limit   int;
  v_stored  int;
  v_live    int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._job_post_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select jobs_posted into v_stored from public.usage_counters
    where company_id = v_company and period = v_period for update;
  select count(*)::int into v_live from public.jobs
    where company_id = v_company and status = 'open';

  -- Block on the effective usage (stored spend or live jobs, whichever is higher).
  if v_limit is null or greatest(v_stored, v_live) < v_limit then
    update public.usage_counters set jobs_posted = jobs_posted + 1
      where company_id = v_company and period = v_period
      returning jobs_posted into v_stored;
  end if;

  return query select greatest(v_stored, v_live), v_limit, v_reset;
end $$;

grant execute on function public.get_job_post_usage() to authenticated;
grant execute on function public.bump_job_post() to authenticated;
