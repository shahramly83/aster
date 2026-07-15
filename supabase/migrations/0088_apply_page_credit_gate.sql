-- ============================================================================
-- 0088: Close the public apply page when a company is out of screening credits
-- ============================================================================
-- When a company has exhausted BOTH its monthly applicant-screening pool and any
-- purchased top-up, new applications should stop: the public apply page shows a
-- plain "position closed" and the company sees its open roles as "Unpublished,
-- out of credits". Nothing is mutated on the job row — this is a live, reversible
-- state derived from the credit balance, so buying credits reopens everything.

-- Does this company still have applicant-screening credit (monthly pool OR
-- purchased balance)? Unlimited plans always accept.
create or replace function public._company_accepting_applicants(p_company uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_limit int; v_used int; v_bal int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then return false; end if;
  v_limit := public._applicant_parse_limit((select plan from public.companies where id = p_company));
  if v_limit is null then return true; end if;                 -- unlimited plan
  select period into v_period from public._ai_rank_period(v_created);
  select coalesce(applicant_parsing, 0) into v_used
    from public.usage_counters where company_id = p_company and period = v_period;
  if coalesce(v_used, 0) < v_limit then return true; end if;   -- monthly pool has room
  select coalesce(balance, 0) into v_bal
    from public.purchased_credits where company_id = p_company and kind = 'applicant_screen';
  return coalesce(v_bal, 0) > 0;                               -- purchased top-up covers it
end $$;
grant execute on function public._company_accepting_applicants(uuid) to anon, authenticated;

-- Add `accepting` to the public job payload (0068 was the previous definition).
drop function if exists public.get_public_job(uuid);
create function public.get_public_job(p_job_id uuid)
returns table (id uuid, title text, status text, details jsonb, expires_at date,
               company_name text, logo_url text, accepting boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select j.id, j.title, j.status, j.details, j.expires_at, c.name, c.logo_url,
           public._company_accepting_applicants(j.company_id)
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id
      and j.status <> 'draft'
      and c.deleted_at is null;
end $$;
grant execute on function public.get_public_job(uuid) to anon, authenticated;
