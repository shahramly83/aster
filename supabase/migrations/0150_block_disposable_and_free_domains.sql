-- ============================================================================
-- Aster — block disposable and free-provider domains at signup
-- ============================================================================
-- 0148/0149 stop a siteless domain taking a free trial. That catches the case we
-- actually hit, but it does NOT catch mailinator.com and its kind, which serve
-- perfectly good websites. Kickbox does: it flags those as disposable, and flags
-- Gmail and friends as free.
--
-- The two layers are complementary, and neither replaces the other:
--   copawoke.com    site check says no site   | Kickbox says deliverable, 0.887
--   mailinator.com  site check says has site  | Kickbox says disposable
--
-- Kickbox's own `deliverable` verdict is deliberately ignored. It returned
-- "unknown" for hireaster.com and "undeliverable" for a real Microsoft address;
-- blocking on it would turn away genuine customers. Only `disposable` and `free`
-- are trusted, because those describe the domain rather than the mailbox.
--
-- These verdicts sit on the same per-domain row as the site check, written by
-- check-domain-site, so one call on email blur answers both questions and the
-- second person from a domain costs nothing.
--
-- Unlike the trial gate, this REFUSES the signup: a disposable address is never
-- a customer. Unknown still passes, for the same reason as 0149 -- our own
-- outage must not turn away real people.
-- ============================================================================

alter table public.domain_site_checks
  add column if not exists disposable    boolean,
  add column if not exists free_provider boolean,
  add column if not exists verifier      text;

-- Only an explicit true blocks. Null means unchecked or the verifier was off.
create or replace function public._domain_is_blocked(p_domain text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select false from public.domain_trial_allowlist where domain = lower(trim(coalesce(p_domain, '')))),
    (select (coalesce(disposable, false) or coalesce(free_provider, false))
       from public.domain_site_checks where domain = lower(trim(coalesce(p_domain, '')))),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Provisioning: as 0148, plus an outright refusal for disposable/free domains.
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

  -- Work email only, enforced here rather than only in the browser. The form has
  -- always said this; until now nothing stopped someone calling the API directly.
  if v_domain is null or public._is_public_email_domain(v_domain) or public._domain_is_blocked(v_domain) then
    raise exception 'email_not_allowed' using errcode = '22023';
  end if;

  -- One workspace per company. A colleague already has one, so this person joins it
  -- by invitation (server-side); we only surface the company name, nothing else.
  select c.name into v_existing
    from public.companies c
    join public.profiles p on p.company_id = c.id and p.status = 'active'
   where c.deleted_at is null
     and public._email_domain(p.email) = v_domain
   limit 1;
  if v_existing is not null then
    raise exception 'domain_in_use:%', v_existing using errcode = '23505';
  end if;

  -- A trial needs both: an identity that has not had one, and a domain that
  -- looks like a real company.
  v_grant := not public._free_trial_used(v_email) and public._domain_has_site(v_domain);
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
  -- pay before any access (no free Launch).
  insert into public.companies (name, slug, plan, status, region, deleted_at, purge_after)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, v_plan,
          (case when v_grant then 'trial' else 'suspended' end)::company_status, null,
          case when v_grant then null else now() end,
          case when v_grant then null else (now() + interval '30 days') end)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, v_plan, 'monthly',
          (case when v_grant then 'trialing' else 'past_due' end)::sub_status, 0,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  if v_grant and v_domain is not null then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;
