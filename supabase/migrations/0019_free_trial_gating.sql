-- ============================================================================
-- Aster — one free trial per identity (email) and per business domain
-- ============================================================================
-- Signup stays card-free and easy. But the 14-day Premium trial is granted only
-- if the identity has not used it before:
--   * same exact email (normalized) -> no new trial
--   * same *business* domain -> no new trial (one trial per company domain)
--   * public email providers (gmail, outlook, ...) are NOT domain-blocked, only
--     email-blocked, so we never lock out everyone on a shared provider
-- A returning identity can still sign up freely; they just land on the plain
-- Free plan and must buy a plan (enter a card) to get Premium.

create extension if not exists pgcrypto with schema extensions;

-- Business domains that have already received their one free trial.
create table if not exists public.domain_grants (
  domain           text primary key,
  first_granted_at timestamptz not null default now()
);
alter table public.domain_grants enable row level security;   -- definer/service only

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create or replace function public._normalize_email(p text)
returns text language sql immutable as $$
  select case
    when position('@' in lower(trim(coalesce(p,'')))) < 2 then lower(trim(coalesce(p,'')))
    else (
      with parts as (
        select split_part(lower(trim(p)),'@',1) as loc,
               split_part(lower(trim(p)),'@',2) as dom
      )
      select (case when dom in ('gmail.com','googlemail.com')
                   then replace(split_part(loc,'+',1),'.','')
                   else split_part(loc,'+',1) end) || '@' || dom
      from parts
    )
  end;
$$;

create or replace function public._email_domain(p text)
returns text language sql immutable as $$
  select nullif(split_part(lower(trim(coalesce(p,''))),'@',2),'');
$$;

create or replace function public._is_public_email_domain(p text)
returns boolean language sql immutable as $$
  select lower(coalesce(p,'')) in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com',
    'yahoo.com','yahoo.co.uk','yahoo.co.in','ymail.com','rocketmail.com',
    'icloud.com','me.com','mac.com','proton.me','protonmail.com','pm.me',
    'aol.com','gmx.com','gmx.net','mail.com','yandex.com','yandex.ru',
    'zoho.com','fastmail.com','hey.com','tutanota.com','hotmail.co.uk'
  );
$$;

-- One-way hash of the normalized email, so we never retain raw emails of deleted
-- users. Peppered to make casual reversal harder.
create or replace function public._email_hash(p text)
returns text language sql immutable as $$
  select encode(extensions.digest('aster:free-grant:v1:' || public._normalize_email(p), 'sha256'), 'hex');
$$;

-- Has this email (or its business domain) already used the free trial?
create or replace function public._free_trial_used(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.free_grant_ledger g where g.email_hash = public._email_hash(p_email))
    or (
      not public._is_public_email_domain(public._email_domain(p_email))
      and exists (select 1 from public.domain_grants d where d.domain = public._email_domain(p_email))
    );
$$;

-- ---------------------------------------------------------------------------
-- Signup provisioning now gates the trial (replaces 0003 version)
-- ---------------------------------------------------------------------------
create or replace function public.create_company_and_owner(
  p_company_name text,
  p_full_name   text default null
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
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_domain := public._email_domain(v_email);
  v_grant  := not public._free_trial_used(v_email);   -- deny repeat free trials

  v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := trim(both '-' from coalesce(v_slug, 'workspace'));
  if v_slug = '' then v_slug := 'workspace'; end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(v_uid::text, 1, 6);
  end if;

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, 'starter',
          case when v_grant then 'trial' else 'active' end, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, 'starter', 'monthly',
          case when v_grant then 'trialing' else 'active' end, 1,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  -- This business domain has now used its one free trial.
  if v_grant and v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;
revoke all on function public.create_company_and_owner(text, text) from public, anon;
grant execute on function public.create_company_and_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deletion now records the identity itself (no dependence on an edge secret)
-- ---------------------------------------------------------------------------
create or replace function public.request_workspace_deletion(p_email_hash text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_email   text;
  v_domain  text;
  v_purge   timestamptz := now() + interval '30 days';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can delete it' using errcode = '42501';
  end if;

  update public.companies set deleted_at = now(), purge_after = v_purge
   where id = v_company and deleted_at is null;
  if not found then
    raise exception 'workspace is already scheduled for deletion' using errcode = 'P0001';
  end if;

  -- Remember this identity so a re-signup cannot get the free trial again.
  select email into v_email from auth.users where id = v_uid;
  v_domain := public._email_domain(v_email);
  insert into public.free_grant_ledger (email_hash) values (public._email_hash(v_email))
    on conflict (email_hash) do update
      set workspaces_deleted = public.free_grant_ledger.workspaces_deleted + 1,
          last_deleted_at     = now();
  if v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_purge;
end;
$$;
revoke all on function public.request_workspace_deletion(text) from public, anon;
grant execute on function public.request_workspace_deletion(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: existing business domains have effectively used their trial, so a
-- colleague signing up later doesn't hand out a second one.
-- ---------------------------------------------------------------------------
insert into public.domain_grants (domain)
select distinct public._email_domain(p.email)
from public.profiles p
where p.email is not null
  and public._email_domain(p.email) is not null
  and not public._is_public_email_domain(public._email_domain(p.email))
on conflict (domain) do nothing;
