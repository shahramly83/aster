-- 0053_seat_limit_from_plan.sql
--
-- Team-seat limit should come from the PLAN, matching PLAN_LIMITS in the app
-- (Launch 1, Scale 30, Elite 100, Enterprise unlimited). Until now invite_teammate
-- read subscriptions.seats and fell back to 1 when it was NULL, so any workspace
-- whose seats column was never provisioned (e.g. older signups) was silently
-- capped at a single seat, disagreeing with the meter the app shows.
--
-- Fix: derive the cap from companies.plan, honouring an explicitly-purchased
-- subscriptions.seats only when it is HIGHER than the plan's base (add-on seats).
-- Everything else in the function is unchanged.

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
  if exists (select 1 from public.profiles
             where company_id = v_company and lower(email) = v_email) then
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
  select (select count(*) from public.profiles
            where company_id = v_company and status = 'active')
       + (select count(*) from public.invitations
            where company_id = v_company and accepted_at is null and expires_at > now())
    into v_used;
  if v_used >= v_seats then
    raise exception 'seat limit reached' using errcode = 'P0001';
  end if;

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
