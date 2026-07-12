-- 0061_workspace_slug_choice.sql
--
-- Let a signer choose their dashboard subdomain (<slug>.hireaster.com) instead of
-- it always being auto-derived from the company name, and expose a public
-- availability check the signup form can call before submitting.
--
-- companies.slug already exists (0050). Slugs here are lowercase alphanumeric
-- with NO dashes, matching the signup field.

-- Public availability check. SECURITY DEFINER so an unauthenticated visitor on
-- the signup page can test a subdomain without being able to read companies.
-- Normalizes the input the same way the client + provisioning RPC do.
create or replace function public.workspace_slug_available(p_slug text)
returns boolean
language sql security definer set search_path = public
as $$
  with norm as (select regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g') as s)
  select case
    when (select length(s) from norm) < 2 then false
    else not exists (select 1 from public.companies c where c.slug = (select s from norm))
  end;
$$;
revoke all on function public.workspace_slug_available(text) from public;
grant execute on function public.workspace_slug_available(text) to anon, authenticated;

-- Recreate the provisioning RPC with an optional chosen slug. Drop the 2-arg
-- form first so a 2-arg call isn't ambiguous against the new default-arg one.
drop function if exists public.create_company_and_owner(text, text);

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
  v_seats      int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_domain := public._email_domain(v_email);
  v_grant  := not public._free_trial_used(v_email);
  v_plan   := case when v_grant then 'scale'::plan_tier else 'launch'::plan_tier end;
  v_seats  := case when v_grant then 3 else 1 end;

  -- Prefer the caller's chosen slug (sanitized to lowercase alphanumeric, no
  -- dashes); fall back to one derived from the company name. Dedupe with a short
  -- uid suffix if the slug is already taken.
  v_slug := nullif(regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g'), '');
  if v_slug is null or length(v_slug) < 2 then
    v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '', 'g'), '');
  end if;
  if v_slug is null or v_slug = '' then v_slug := 'workspace'; end if;
  v_slug := substr(v_slug, 1, 30);
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := substr(v_slug, 1, 23) || substr(v_uid::text, 1, 6);
  end if;

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, v_plan,
          case when v_grant then 'trial' else 'active' end, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, v_plan, 'monthly',
          case when v_grant then 'trialing' else 'active' end, v_seats,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  if v_grant and v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;
revoke all on function public.create_company_and_owner(text, text, text) from public, anon;
grant execute on function public.create_company_and_owner(text, text, text) to authenticated;
