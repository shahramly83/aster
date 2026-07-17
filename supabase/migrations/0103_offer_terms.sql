-- ============================================================================
-- 0103: structured offer terms
-- ============================================================================
-- The offer was freeform email text only. Real offers should record the actual
-- terms as data (salary, start date, type, expiry), so we can render a proper
-- letter later and the candidate sees the same terms on /offer/<token>. All
-- columns are nullable: an offer can still be sent with terms left blank.
alter table public.offers add column if not exists base_salary     numeric;
alter table public.offers add column if not exists salary_currency text;     -- 'myr' | 'usd' | 'sgd'
alter table public.offers add column if not exists employment_type text;     -- 'full_time' | 'part_time' | 'contract' | 'internship'
alter table public.offers add column if not exists start_date      date;
alter table public.offers add column if not exists expires_at      date;
alter table public.offers add column if not exists offer_job_title text;     -- overrides the derived title on the letter

-- Expose the terms on the public preview so /offer/<token> can show them without
-- a login. Job title prefers the offer's own title, else the candidate's most
-- recent application. SECURITY DEFINER (offers is company-only under RLS).
-- Drop first: the return signature gains columns, which CREATE OR REPLACE can't do.
drop function if exists public.offer_preview(uuid);
create or replace function public.offer_preview(p_token uuid)
returns table (
  company_name text, logo_url text, job_title text, status text,
  base_salary numeric, salary_currency text, employment_type text,
  start_date date, expires_at date
)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url,
    coalesce(o.offer_job_title, (
      select j.title
        from public.applications a
        join public.jobs j on j.id = a.job_id
       where a.candidate_id = o.candidate_id and a.company_id = o.company_id
       order by a.created_at desc limit 1)),
    o.status,
    o.base_salary, o.salary_currency, o.employment_type,
    o.start_date, o.expires_at
  from public.offers o
  join public.companies c on c.id = o.company_id
  where o.token = p_token;
$$;

revoke all on function public.offer_preview(uuid) from public;
grant execute on function public.offer_preview(uuid) to anon, authenticated;
