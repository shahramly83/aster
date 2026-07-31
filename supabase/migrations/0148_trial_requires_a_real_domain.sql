-- ============================================================================
-- Aster — a free trial requires the email domain to serve a website
-- ============================================================================
-- A throwaway signup (lefebi5946@copawoke.com) took a full 14-day Scale trial:
-- 500 screenings, 30 AI Rank, 100 AI Insight, all billable AI at our cost.
--
-- That address survived every filter we could test it against:
--   * four public disposable-domain lists, up to 74,679 entries  -> not listed
--   * MX inspection            -> mail.copawoke.com, self-hosted, looks ordinary
--   * domain age               -> 1,176 days old (hireaster.com is 25)
--   * Kickbox, a paid verifier -> "deliverable", disposable=false, sendex 0.887,
--                                 a better score than gmail.com
--
-- One check did separate it: copawoke.com serves no website at all. Connection
-- refused on the apex, nothing on www. A company with roles to fill has a site;
-- a domain bought to catch throwaway mail does not.
--
-- So the trial now requires a website at the email's domain. Signup itself is
-- untouched: someone on a siteless domain still gets an account, on the same
-- suspended/pay-first path a repeat trial already lands on. They lose the free
-- AI, not the ability to become a customer.
--
-- The HTTP request lives in the check-domain-site edge function; Postgres only
-- reads its verdict. See that function for the fail-open rule.
-- ============================================================================

-- One row per domain, written by check-domain-site. Cached because the answer
-- changes about as often as a company rebuilds its website, and because the
-- second person from acme.com to sign up should not wait for a second fetch.
create table if not exists public.domain_site_checks (
  domain      text primary key,
  has_site    boolean     not null,
  http_status int,
  note        text,
  checked_at  timestamptz not null default now()
);
alter table public.domain_site_checks enable row level security;  -- definer/service only

-- Manual override, for the genuine customer whose site was down at the wrong
-- moment, or who really does trade without one.
create table if not exists public.domain_trial_allowlist (
  domain   text primary key,
  reason   text,
  added_at timestamptz not null default now()
);
alter table public.domain_trial_allowlist enable row level security;

-- Allowlisted, or checked and found to have a site. An unchecked domain is NOT
-- eligible here; 0149 relaxes that, see the reasoning there.
create or replace function public._domain_has_site(p_domain text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.domain_trial_allowlist where domain = lower(trim(coalesce(p_domain, '')))),
    (select has_site from public.domain_site_checks   where domain = lower(trim(coalesce(p_domain, '')))),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Provisioning: same as 0120, with one extra condition on the trial grant.
-- ---------------------------------------------------------------------------
create or replace function public.create_company_and_owner(
  p_company_name text,
  p_full_name    text default null,
  p_slug         text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_company_id uuid;
  v_slug       text;
  v_domain     text;
  v_grant      boolean;
  v_plan       plan_tier;
  v_existing   text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_domain := public._email_domain(v_email);

  -- One workspace per company. A colleague already has one, so this person joins it
  -- by invitation (server-side); we only surface the company name, nothing else.
  if v_domain is not null and not public._is_public_email_domain(v_domain) then
    select c.name into v_existing
      from public.companies c
      join public.profiles p on p.company_id = c.id and p.status = 'active'
     where c.deleted_at is null
       and public._email_domain(p.email) = v_domain
     limit 1;
    if v_existing is not null then
      raise exception 'domain_in_use:%', v_existing using errcode = '23505';
    end if;
  end if;

  -- A trial needs both: an identity that has not had one, and a domain that
  -- looks like a real company. Public providers keep their existing treatment,
  -- email-gated rather than domain-gated, so nobody is locked out of Gmail.
  v_grant := not public._free_trial_used(v_email)
             and (public._is_public_email_domain(v_domain) or public._domain_has_site(v_domain));
  v_plan  := case when v_grant then 'scale'::plan_tier else 'launch'::plan_tier end;

  v_slug := nullif(regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g'), '');
  if v_slug is null or length(v_slug) < 2 then
    v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '', 'g'), '');
  end if;
  if v_slug is null or v_slug = '' then v_slug := 'workspace'; end if;
  v_slug := substr(v_slug, 1, 30);
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := substr(v_slug, 1, 23) || substr(v_uid::text, 1, 6);
  end if;

  -- Trial-eligible: live workspace on a 14-day Scale trial.
  -- Trial-denied: created suspended + soft-deleted so the owner must subscribe and
  -- pay before any access (no free Launch). The 30-day purge window cleans up an
  -- unpaid workspace; stripe-webhook clears deleted_at + goes active on payment.
  insert into public.companies (name, slug, plan, status, region, deleted_at, purge_after)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, v_plan,
          (case when v_grant then 'trial' else 'suspended' end)::company_status, null,
          case when v_grant then null else now() end,
          case when v_grant then null else (now() + interval '30 days') end)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  -- seats 0: entitlement rides on the plan; this column is add-on seats only.
  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, v_plan, 'monthly',
          (case when v_grant then 'trialing' else 'past_due' end)::sub_status, 0,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  -- Record the trial grant so the domain can't claim a second one.
  if v_grant and v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;
