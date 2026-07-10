-- ============================================================================
-- 0040: plan_tier values become the plan names the product actually uses
-- ============================================================================
--   free   → launch    (there is no free tier: Launch is $19/month)
--   growth → scale
--   pro    → elite
--
-- The old names outlived two rebrands and had started causing real bugs, because
-- code kept reading 'free' as "unpaid". Twice the same mistake shipped: Billing
-- hid the Manage-billing button from Launch subscribers, and sign-up let anyone
-- pick Launch and skip checkout entirely. Both were `plan === "free"` tests that
-- looked obviously correct.
--
-- Renaming the enum value is metadata-only: existing rows follow automatically.
-- But plpgsql/sql function bodies holding the old literals are NOT revalidated,
-- so every function that names a tier must be recreated or it fails at runtime
-- (and, worse, falls through to `else null` = unlimited). Same lesson as 0020.

-- ---------------------------------------------------------------------------
-- 1. The enum
-- ---------------------------------------------------------------------------
alter type plan_tier rename value 'free'   to 'launch';
alter type plan_tier rename value 'growth' to 'scale';
alter type plan_tier rename value 'pro'    to 'elite';

alter table public.companies     alter column plan set default 'launch';
alter table public.subscriptions alter column plan set default 'launch';

-- ---------------------------------------------------------------------------
-- 2. Limit functions (bodies reference the tier literals)
-- ---------------------------------------------------------------------------
create or replace function public._job_post_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 1 when 'scale' then 5 when 'elite' then 10 else null end;
$$;

create or replace function public._ai_rank_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 5 when 'scale' then 30 when 'elite' then 100 else null end;
$$;

create or replace function public._see_why_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 5 when 'scale' then 30 when 'elite' then 100 else null end;
$$;

create or replace function public._ai_insight_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 5 when 'scale' then 100 when 'elite' then 300 else null end;
$$;

create or replace function public._interview_q_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 5 when 'scale' then 100 when 'elite' then 300 else null end;
$$;

create or replace function public._applicant_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 100 when 'scale' then 500 when 'elite' then 1000 else null end;
$$;

create or replace function public._bulk_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 10 when 'scale' then 50 when 'elite' then 100 else null end;
$$;

create or replace function public._resume_parse_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan
    when 'launch' then 10
    when 'scale' then 50
    when 'elite' then 100
    else null end;  -- enterprise / unknown = unlimited
$$;

-- ---------------------------------------------------------------------------
-- 3. Sign-up provisioning (inserts the tier literal)
-- ---------------------------------------------------------------------------
-- Unchanged from 0020 except for the tier names. A granted trial still starts on
-- the base tier with 14 days on the clock; the app grants Scale-level access for
-- the duration, and 0036 suspends the workspace if it lapses unpaid.
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
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, 'launch',
          case when v_grant then 'trial' else 'active' end, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, 'launch', 'monthly',
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
