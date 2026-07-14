-- 0078_clear_stale_trial_seats.sql
--
-- Fix: subscriptions.seats is an ADD-ON count, not the trial's leftovers.
--
-- Seat entitlement comes from the plan (0053/0054):
--
--   v_seats := greatest(plan_base, coalesce(subscriptions.seats, 0))
--
-- so subscriptions.seats only ever means "extra seats bought on top of the plan".
-- We do not sell add-on seats, so it should be null for everyone.
--
-- But provisioning (0050) writes seats = 3 for a granted trial. That value is
-- already redundant while the trial runs, because a trial is born on Scale and
-- Scale's base is 30. And nothing ever clears it. Once the customer lands on
-- Launch, whose base is 1, that stale 3 is read as a 3-seat add-on: the server
-- allows 3 teammates while the UI, which reads the plan table, says 1. Launch
-- quietly ships with triple the seats it sells, and the two numbers disagree.
--
-- Clear it, and stop writing it. Entitlement then comes from the plan alone, which
-- is the only place it is actually priced, and the column is free to mean what it
-- says if we ever do sell add-on seats.

-- ---------------------------------------------------------------------------
-- 1. Clear the stale value everywhere. No workspace has bought add-on seats.
-- ---------------------------------------------------------------------------
-- Zero, not null: the column is NOT NULL, and the gate reads
-- greatest(plan_base, coalesce(seats, 0)), so 0 says "no add-ons" exactly.
update public.subscriptions set seats = 0 where seats <> 0;

-- ---------------------------------------------------------------------------
-- 2. Stop writing it at signup. Identical to 0050 except seats is now null.
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
  v_plan       plan_tier;
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

  -- A granted trial gets Scale-level access for 14 days; a repeat signup with no
  -- grant lands on the base tier, no trial. Seats ride on the plan, so a trial's
  -- allotment is Scale's 30 and nothing extra needs writing.
  v_plan := case when v_grant then 'scale'::plan_tier else 'launch'::plan_tier end;

  v_slug := nullif(regexp_replace(lower(trim(coalesce(p_company_name, ''))), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := trim(both '-' from coalesce(v_slug, 'workspace'));
  if v_slug = '' then v_slug := 'workspace'; end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(v_uid::text, 1, 6);
  end if;

  insert into public.companies (name, slug, plan, status, region)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_slug, v_plan,
          case when v_grant then 'trial' else 'active' end, null)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_company_id, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, 'owner', 'active');

  -- seats: 0. The plan carries the entitlement; this column is add-ons only.
  insert into public.subscriptions (company_id, plan, cycle, status, seats, current_period_end)
  values (v_company_id, v_plan, 'monthly',
          case when v_grant then 'trialing' else 'active' end, 0,
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
