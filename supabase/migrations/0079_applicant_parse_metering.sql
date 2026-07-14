-- 0079_applicant_parse_metering.sql
--
-- Fix: we sell two parse pools and only ever metered one.
--
-- The pricing page sells "100 / 500 / 1,000 applicant parses per month" (public job
-- applications) AND a separate bulk CV upload allowance (10 / 50 / 100). The split
-- was clearly designed: usage_counters.applicant_parsing was added in 0024 and
-- _applicant_parse_limit in 0026. Neither was ever wired to anything.
--
-- What actually shipped was ONE pool. parse-application charged the BULK counter
-- (bump_resume_parse_for), so:
--
--   * the applicant allowance we sell (100/500/1000) enforced nothing at all,
--     because parse-application never checked a limit before parsing, and
--   * every public applicant ate the bulk upload budget instead. On Launch, 10
--     applicants meant the customer could not upload a single CV for the rest of
--     the month, while their billing page advertised 100 applicant parses.
--
-- Give the applicant pool the meter it was always supposed to have. The bulk pool
-- (resume_parsing / _resume_parse_limit) is untouched and keeps its own budget.
--
-- Historical counts stay where they are: applications already charged to
-- resume_parsing are left alone rather than guessed at and moved.

-- Usage for the signed-in company: the dashboard's "Applicant parses" meter.
create or replace function public.get_applicant_parse_usage()
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
    select coalesce((select applicant_parsing from public.usage_counters
                     where company_id = v_company and period = v_period), 0),
           public._applicant_parse_limit((select plan from public.companies where id = v_company)),
           v_reset;
end $$;
grant execute on function public.get_applicant_parse_usage() to authenticated;

-- Check-only usage for one company. parse-application runs as the service role on
-- a PUBLIC endpoint (there is no auth.uid for an applicant), so it passes the
-- company id explicitly. Service role only: this discloses a company's plan usage,
-- and 0041 locked the equivalent resume function down for exactly that reason.
create or replace function public.applicant_parse_usage_for(p_company uuid)
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then return; end if;
  select period into v_period from public._ai_rank_period(v_created);
  return query
    select coalesce((select applicant_parsing from public.usage_counters
                     where company_id = p_company and period = v_period), 0),
           public._applicant_parse_limit((select plan from public.companies where id = p_company));
end $$;
revoke all on function public.applicant_parse_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.applicant_parse_usage_for(uuid) to service_role;

-- Spend one applicant-parse credit. Called by parse-application AFTER a successful
-- parse, and only when the limit allowed it.
create or replace function public.bump_applicant_parse_for(p_company uuid)
returns table (used int, monthly_limit int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_used int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  insert into public.usage_counters (company_id, period) values (p_company, v_period)
    on conflict (company_id, period) do nothing;
  update public.usage_counters set applicant_parsing = applicant_parsing + 1
    where company_id = p_company and period = v_period
    returning applicant_parsing into v_used;
  return query select v_used, public._applicant_parse_limit((select plan from public.companies where id = p_company));
end $$;
revoke all on function public.bump_applicant_parse_for(uuid) from public, anon, authenticated;
grant execute on function public.bump_applicant_parse_for(uuid) to service_role;
