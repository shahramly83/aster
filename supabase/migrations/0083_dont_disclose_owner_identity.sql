-- 0083_dont_disclose_owner_identity.sql
--
-- Fix: 0082 printed the workspace owner's NAME AND EMAIL to whoever was blocked.
--
--   "Onlazy Blogger Sdn Bhd already uses Aster. Ask Tara Tenant (tenant@onlazy.com)
--    to invite you..."
--
-- The reasoning was that the person had a confirmed address on the same domain, so
-- it was their own colleague. That is too generous. Anyone who can receive mail at
-- a domain can now sign up, confirm, and be handed the account owner's name and
-- email by the product itself: a directory lookup for whoever runs a target
-- company's recruiting system, which is exactly the address a phisher wants. And it
-- is printed on an unauthenticated-looking screen.
--
-- The owner's identity is never needed by the person asking. The SERVER knows who
-- to email, and request-workspace-access sends it. So the block now returns the
-- company name and nothing else, and the screen offers a button rather than a
-- contact card.
--
-- Company name only: it is the name of the company they themselves just claimed to
-- work for and typed into the signup form, so it discloses nothing they did not
-- already bring with them.

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
  -- by invitation. We name the COMPANY and stop there: who owns it is the server's
  -- business, and request-workspace-access does the asking on their behalf.
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

  v_grant := not public._free_trial_used(v_email);
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

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, v_plan,
          (case when v_grant then 'trial' else 'active' end)::company_status, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  -- seats 0: entitlement rides on the plan; this column is add-on seats only.
  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, v_plan, 'monthly',
          (case when v_grant then 'trialing' else 'active' end)::sub_status, 0,
          case when v_grant then (now() + interval '14 days')::date else current_date end);

  if v_grant and v_domain is not null and not public._is_public_email_domain(v_domain) then
    insert into public.domain_grants (domain) values (v_domain) on conflict (domain) do nothing;
  end if;

  return v_company_id;
end;
$$;

revoke all on function public.create_company_and_owner(text, text, text) from public, anon;
grant execute on function public.create_company_and_owner(text, text, text) to authenticated;
