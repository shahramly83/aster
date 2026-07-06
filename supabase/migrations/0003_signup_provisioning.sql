-- ============================================================================
-- Aster — signup provisioning
-- ============================================================================
-- A brand-new customer has no profile yet, so RLS (which is keyed on the
-- caller's company) blocks them from inserting their own company + profile.
-- This SECURITY DEFINER function runs with the definer's rights to create the
-- company, link the caller as its owner, and open a 14-day trial subscription
-- in one atomic step. It refuses to run for anyone who already has a profile,
-- so it can't be used to re-home an existing user.

create or replace function public.create_company_and_owner(
  p_company_name text,
  p_full_name   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_company_id uuid;
  v_slug       text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- One workspace per user: refuse if they're already provisioned.
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- Build a url-safe slug from the company name, then de-dupe with a short suffix.
  v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := trim(both '-' from coalesce(v_slug, 'workspace'));
  if v_slug = '' then v_slug := 'workspace'; end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(v_uid::text, 1, 6);
  end if;

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, 'starter', 'trial', null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, 'starter', 'monthly', 'trialing', 1, (now() + interval '14 days')::date);

  return v_company_id;
end;
$$;

-- Only a signed-in user may provision (for themselves); anon cannot.
revoke all on function public.create_company_and_owner(text, text) from public, anon;
grant execute on function public.create_company_and_owner(text, text) to authenticated;
