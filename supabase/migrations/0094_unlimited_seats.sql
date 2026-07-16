-- 0094_unlimited_seats.sql
--
-- Team size is no longer a plan differentiator. Plans differ ONLY by job-post
-- quantity (maxJobs) and AI/screening credit allowances; everything else, seats
-- included, is the same on every plan. Redefine invite_teammate (last set in 0054)
-- so the seat cap is effectively unlimited for all plans. The rest of the function
-- -- admin check, duplicate/suspended handling, invitation upsert -- is unchanged.
create or replace function public.invite_teammate(
  p_email text,
  p_role  profile_role default 'interviewer'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_email   text := lower(trim(p_email));
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

  -- Seats are unlimited on every plan now, so there is no cap to enforce here.

  -- Previously-removed teammate: reactivate in place. They keep their account and
  -- history; no invitation or email is needed. Null return tells the caller to skip
  -- the invite email and report a re-add instead.
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
