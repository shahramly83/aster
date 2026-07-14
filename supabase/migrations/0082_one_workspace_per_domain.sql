-- 0082_one_workspace_per_domain.sql
--
-- Two fixes to signup provisioning, both about giving the product away.
--
-- 1. A SECOND WORKSPACE ON THE SAME COMPANY DOMAIN WAS FREE.
--
--    The domain gate only ever governed the free TRIAL. It never stopped a second
--    signup. And when the trial was refused, we still provisioned:
--
--        companies.status     = 'active'
--        subscriptions.status = 'active'
--        subscriptions.plan   = 'launch'
--
--    with no Stripe subscription behind it. That is a fully working Launch
--    workspace — 1 job, 100 applicant parses, 10 uploads, 5 AI ranks a month —
--    for nothing, forever. Anyone could mint unlimited ones: a@corp.com,
--    b@corp.com, c@corp.com. A small recruiter never had to pay us at all.
--
--    Free-Launch-forever was never a decision. It was the fall-through of a gate
--    that only knew how to withhold a trial.
--
--    Now: if anyone from this business domain is already in a live workspace, the
--    signup is refused and they are told to ask their admin for an invite. One
--    workspace per company, which is what an invite system is for.
--
--    Public domains (gmail and friends) are exempt from the check, because they
--    are not companies. Signup blocks them anyway (isBusinessEmail), so this is
--    belt and braces.
--
-- 2. seats WAS STILL BEING WRITTEN AS 3.
--
--    0078 set seats to 0 at provisioning, but it redefined the TWO-argument
--    overload while the client calls the THREE-argument one (p_slug, 0061/0070).
--    Postgres treats those as different functions, so the live signup path never
--    changed: it still wrote the stale trial seat count that 0078 existed to kill.
--    The migration applied cleanly and did nothing, which is the second time that
--    exact trap has bitten in this codebase (see 0080/0081).
--
--    Fixed here, on the overload that is actually called, and the accidental
--    2-arg overload is dropped so there is only one signup function again.

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

  -- One workspace per company. If a colleague already has one, this person joins
  -- it by invitation rather than starting a rival copy of it.
  --
  -- Name the OWNER, not just the company. "Your company already uses Aster" tells
  -- someone they are blocked without telling them who can unblock them, which is a
  -- dead end dressed up as an explanation. They are a verified address on this
  -- domain, so telling them who owns their own company's workspace is not a leak.
  if v_domain is not null and not public._is_public_email_domain(v_domain) then
    select c.name || '|' || coalesce(o.full_name, '') || '|' || coalesce(o.email, '')
      into v_existing
      from public.companies c
      join public.profiles p on p.company_id = c.id and p.status = 'active'
      left join lateral (
        select p2.full_name, p2.email
          from public.profiles p2
         where p2.company_id = c.id and p2.role = 'owner' and p2.status = 'active'
         limit 1
      ) o on true
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

  -- seats 0: entitlement rides on the plan (0053/0054 read
  -- greatest(plan_base, coalesce(seats, 0))). This column is add-on seats only.
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
