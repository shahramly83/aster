-- ---------------------------------------------------------------------------
-- 0172: Advertise open roles on external job sites
--
-- Aggregators (Adzuna, Jooble, Careerjet, Talent.com) do not have their own
-- jobs: they crawl a feed file and republish what they find. One file at
-- /feed/jobs.xml carrying every opted-in role means a customer opens a job in
-- Aster and it appears on those sites within a day, with nobody retyping it.
--
-- Because that file is public and cross-tenant, the gate is opt-in and defaults
-- to false. Publishing a company's salary ranges and headcount plans to third
-- party sites is a consent decision, not a default, and a confidential search
-- must never leave the workspace by accident. The default also handles the demo
-- and seed workspaces for free: nobody switches them on, so their fabricated
-- roles can never reach a real aggregator (which would get the feed rejected).
--
-- Indeed is deliberately not a target. It stopped collecting organic XML feeds
-- on 2026-03-31 and moved to a partner API, so the format here serves the
-- aggregators that still read it.
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists feed_enabled boolean not null default false;

comment on column public.companies.feed_enabled is
  'Opt-in: include this workspace''s open roles in the public job-site feed (/feed/jobs.xml).';

-- ---------------------------------------------------------------------------
-- The feed itself.
--
-- Unlike list_public_jobs (0121) this is deliberately NOT scoped to one slug:
-- the aggregators onboard Aster once as a publisher and read a single file, so
-- the query spans every opted-in workspace. Same safety envelope as 0121: it
-- returns only what the public apply page already shows, plus the company
-- address the feed needs to place the role on a map.
--
-- Filtered out, and each for a reason that costs money if ignored:
--   * not opted in, soft-deleted, suspended or churned workspaces
--   * drafts, closed roles, and roles past their closing date
--   * roles whose company has run out of screening credits: the aggregator
--     would spend a click sending someone to a form that cannot accept them.
-- ---------------------------------------------------------------------------
create or replace function public.list_feed_jobs()
returns table (
  id uuid,
  title text,
  details jsonb,
  expires_at date,
  created_at timestamptz,
  company_name text,
  company_slug text,
  logo_url text,
  address_city text,
  address_state text,
  address_country text
)
language sql security definer set search_path = public stable as $$
  select j.id, j.title, j.details, j.expires_at, j.created_at,
         c.name, c.slug, c.logo_url,
         nullif(btrim(coalesce(c.address_city, '')), ''),
         nullif(btrim(coalesce(c.address_state, '')), ''),
         nullif(btrim(coalesce(c.address_country, '')), '')
    from public.jobs j
    join public.companies c on c.id = j.company_id
   where c.feed_enabled
     and c.deleted_at is null
     and c.status in ('trial', 'active')
     and j.status = 'open'
     and (j.expires_at is null or j.expires_at >= (now() at time zone 'utc')::date)
     and public._company_accepting_applicants(j.company_id)
   order by j.created_at desc;
$$;

revoke all on function public.list_feed_jobs() from public;
grant execute on function public.list_feed_jobs() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The customer's own switch, in Settings.
--
-- Owner or workspace admin only, matching set_company_currency (0095): this
-- decides what becomes public about the company, so it is not a recruiter's
-- call. Interviewers and recruiters can see the state but not change it.
-- ---------------------------------------------------------------------------
create or replace function public.set_company_feed(p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_role    profile_role;
begin
  if v_company is null then
    raise exception 'no company for this session' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'owner' and v_role is distinct from 'admin' then
    raise exception 'only an owner or admin can change job-site advertising' using errcode = '42501';
  end if;
  update public.companies
     set feed_enabled = coalesce(p_enabled, false)
   where id = v_company;
end $$;

revoke all on function public.set_company_feed(boolean) from public, anon;
grant execute on function public.set_company_feed(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Aster staff switch, so a pilot customer can be turned on over the phone
-- without waiting for them to find the setting themselves.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_company_feed(p_company_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.companies
     set feed_enabled = coalesce(p_enabled, false)
   where id = p_company_id;
end $$;

revoke all on function public.admin_set_company_feed(uuid, boolean) from public, anon;
grant execute on function public.admin_set_company_feed(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Surface the flag in the admin workspace list. Identical to the 0165
-- definition with feed_enabled appended; recreated rather than altered because
-- a plpgsql function's return type cannot be extended in place.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_company_detail();
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz,
  owner_name text, owner_email text,
  interview_count bigint, hired_count bigint, upcoming_interviews bigint,
  comped_at timestamptz, comped_note text,
  address_country text,
  feed_enabled boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.status, c.region,
           (select count(*) from public.profiles p where p.company_id = c.id),
           (select count(*) from public.candidates ca where ca.company_id = c.id),
           (select count(*) from public.jobs j where j.company_id = c.id and j.status = 'open'),
           s.status, s.cycle, s.current_period_end, c.created_at,
           o.full_name, o.email,
           (select count(*) from public.interviews i where i.company_id = c.id),
           (select count(*) from public.applications a
             where a.company_id = c.id and a.stage = 'hired'),
           (select count(*) from public.interviews i2
             where i2.company_id = c.id
               and i2.scheduled_at >= now()
               and coalesce(i2.status, '') <> 'cancelled'),
           c.comped_at, c.comped_note,
           nullif(btrim(c.address_country), ''),
           c.feed_enabled
      from public.companies c
      left join public.subscriptions s on s.company_id = c.id
      left join lateral (
        select p.full_name, p.email
          from public.profiles p
         where p.company_id = c.id and p.role = 'owner'
         order by p.created_at
         limit 1
      ) o on true
     order by c.created_at desc;
end $$;
revoke all on function public.admin_company_detail() from public, anon;
grant execute on function public.admin_company_detail() to authenticated;
