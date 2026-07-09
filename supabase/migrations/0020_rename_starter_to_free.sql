-- ============================================================================
-- Aster — rename the base plan tier "starter" to "free"
-- ============================================================================
-- The database base plan was called 'starter' while the app calls the base plan
-- 'free'. That mismatch made a loaded workspace look like a paid plan and broke
-- the trial display. Rename the enum value so DB and app agree on 'free'.
-- (The app's separate internal key 'starter' = the paid "Pro" plan is a
-- frontend-only label and is untouched here.)

-- Rename the value everywhere it is stored (metadata-only; existing rows follow).
alter type plan_tier rename value 'starter' to 'free';

-- Keep the column defaults valid + explicit.
alter table public.companies     alter column plan set default 'free';
alter table public.subscriptions alter column plan set default 'free';

-- Recreate the functions whose bodies referenced the old label, or they would
-- error at runtime (and, worse, fall through to "unlimited" for the base plan).
create or replace function public._ai_rank_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 30 else null end; -- null = unlimited
$$;

create or replace function public._job_post_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'free' then 5 else null end;  -- pro / enterprise = unlimited
$$;

-- Signup provisioning: same gating as 0019, but provisions the base plan as
-- 'free' instead of 'starter'.
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
  v_grant  := not public._free_trial_used(v_email);

  v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := trim(both '-' from coalesce(v_slug, 'workspace'));
  if v_slug = '' then v_slug := 'workspace'; end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(v_uid::text, 1, 6);
  end if;

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, 'free',
          case when v_grant then 'trial' else 'active' end, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, 'free', 'monthly',
          case when v_grant then 'trialing' else 'active' end, 1,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  if v_grant and v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;
revoke all on function public.create_company_and_owner(text, text) from public, anon;
grant execute on function public.create_company_and_owner(text, text) to authenticated;
