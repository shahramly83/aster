-- 0054_reactivate_removed_teammate.sql
--
-- Removing a teammate (remove_teammate, 0043) is a SOFT delete: it sets the
-- profile's status to 'suspended' so their scorecards / interview history stay
-- intact. But invite_teammate's duplicate check counted ANY profile for the
-- email regardless of status, so a removed teammate could never be re-invited:
-- the invite failed with 'already a member' while they were invisible in the
-- team list. The only escape was deleting rows by hand in SQL.
--
-- Fix: distinguish the two cases.
--   * an ACTIVE profile  -> genuine duplicate, still raise 'already a member'.
--   * a SUSPENDED profile -> a previously-removed teammate; reactivate them in
--     place (restore access + history) instead of blocking. They already have an
--     account, so no invitation/email is created -- the function returns null to
--     signal the caller (send-teammate-invite) to skip the invite email.
-- The seat cap still applies: a suspended profile does not count toward usage,
-- so reactivating one is checked against the plan's seats just like a new invite.

create or replace function public.invite_teammate(
  p_email text,
  p_role  profile_role default 'interviewer'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_email   text := lower(trim(p_email));
  v_plan    text;
  v_base    int;
  v_seats   int;
  v_used    int;
  v_token   uuid;
  v_status  text;
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if p_role not in ('admin','interviewer') then
    raise exception 'role must be admin or interviewer' using errcode = '22023';
  end if;

  -- Existing membership? An active profile is a genuine duplicate; a suspended
  -- one is a removed teammate we reactivate below rather than block.
  select status into v_status from public.profiles
   where company_id = v_company and lower(email) = v_email;
  if v_status = 'active' then
    raise exception 'already a member' using errcode = '23505';
  end if;

  -- Seat entitlement from the plan (keep in sync with src/lib/plan.js).
  select plan into v_plan from public.companies where id = v_company;
  v_base := case v_plan
    when 'launch'     then 1
    when 'scale'      then 30
    when 'elite'      then 100
    when 'enterprise' then 1000000  -- effectively unlimited
    else 1                          -- unknown / unset: fail closed to Launch
  end;
  -- Honour a higher purchased seat count if one is explicitly set, never a lower one.
  select greatest(v_base, coalesce(seats, 0)) into v_seats
    from public.subscriptions where company_id = v_company;
  v_seats := coalesce(v_seats, v_base);

  -- Active members (incl. the tenant) + pending invites count toward the cap.
  -- Suspended profiles do not, so reactivating one still respects the cap.
  select (select count(*) from public.profiles
            where company_id = v_company and status = 'active')
       + (select count(*) from public.invitations
            where company_id = v_company and accepted_at is null and expires_at > now())
    into v_used;
  if v_used >= v_seats then
    raise exception 'seat limit reached' using errcode = 'P0001';
  end if;

  -- Previously-removed teammate: reactivate in place. They keep their account
  -- and history; no invitation or email is needed. Null return tells the caller
  -- to skip the invite email and report a re-add instead.
  if v_status = 'suspended' then
    update public.profiles
       set status = 'active', role = p_role
     where company_id = v_company and lower(email) = v_email;
    return null;
  end if;

  -- Brand-new teammate: create (or refresh) the invitation and return its token.
  insert into public.invitations (company_id, email, role, invited_by)
  values (v_company, v_email, p_role, auth.uid())
  on conflict (company_id, email) do update
    set role        = excluded.role,
        invited_by  = excluded.invited_by,
        token       = gen_random_uuid(),
        expires_at  = now() + interval '7 days',
        accepted_at = null,
        created_at  = now()
  returning token into v_token;

  return v_token;
end $$;
