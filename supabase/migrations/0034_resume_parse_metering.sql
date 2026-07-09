-- ============================================================================
-- 0034: AI Parsing (bulk resume upload) credit metering
-- ============================================================================
-- Meters resume parsing per company on the same rolling 30-day cycle as AI Rank
-- (usage_counters.resume_parsing, keyed by _ai_rank_period). The parse-resume
-- edge function checks the limit before spending an AI call and consumes one
-- credit per successful parse, so the "10 Parsing / month" allowance is enforced
-- server-side (not just in the client). Limits below match the app's displayed
-- resumeUploads: free 10, growth 50, pro 100, enterprise unlimited.

create or replace function public._resume_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan
    when 'free' then 10
    when 'growth' then 50
    when 'pro' then 100
    else null end;  -- enterprise / unknown = unlimited
$$;

-- Current cycle usage + limit + reset date, for the signed-in company (used by
-- the app to show the "AI Parsing" usage bar). null limit = unlimited.
create or replace function public.get_resume_parse_usage()
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
    select coalesce((select resume_parsing from public.usage_counters
                     where company_id = v_company and period = v_period), 0),
           public._resume_parse_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;
grant execute on function public.get_resume_parse_usage() to authenticated;

-- Check-only usage for a specific company. The parse-resume edge function runs
-- as the service role (no auth.uid), so it passes the company id explicitly.
create or replace function public.resume_parse_usage_for(p_company uuid)
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then return; end if;
  select period into v_period from public._ai_rank_period(v_created);
  return query
    select coalesce((select resume_parsing from public.usage_counters
                     where company_id = p_company and period = v_period), 0),
           public._resume_parse_limit((select plan from public.companies where id = p_company));
end $$;

-- Consume one parse credit for a company; returns the new used + limit. Called by
-- parse-resume after a successful parse (the function checks the limit first).
create or replace function public.bump_resume_parse_for(p_company uuid)
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_used int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  insert into public.usage_counters (company_id, period) values (p_company, v_period)
    on conflict (company_id, period) do nothing;
  update public.usage_counters set resume_parsing = resume_parsing + 1
    where company_id = p_company and period = v_period
    returning resume_parsing into v_used;
  return query select v_used, public._resume_parse_limit((select plan from public.companies where id = p_company));
end $$;
