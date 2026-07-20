-- 0120_gate_trial_ineligible_signups.sql
--
-- Close the free-Launch loophole. Previously, a sign-up from a domain that had
-- already used its one free 14-day trial was provisioned as plan=launch,
-- status=active — i.e. FREE Launch access, with no payment ever collected.
--
-- Now that path is a hard paywall: the workspace is created suspended AND
-- soft-deleted (deleted_at/purge_after set), exactly like a lapsed trial. On next
-- load the owner hits the existing subscribe paywall (DeletedWorkspaceScreen,
-- gated on deleted_at) and must pick a plan and pay through Stripe Checkout before
-- any access. stripe-webhook already clears deleted_at + flips status to active
-- when the payment lands, so the whole reactivation loop is reused unchanged.
--
-- Trial-ELIGIBLE domains are untouched: they still get the 14-day Scale trial.
-- Only the trial-denied branch changes (status suspended + soft-delete, sub
-- past_due). The 30-day purge window means an unpaid, never-activated workspace is
-- cleaned up automatically.
--
-- Revert: re-run 0083's definition (trial-denied branch -> 'active'/'active', no
-- deleted_at) to restore the old free-Launch behaviour.

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
