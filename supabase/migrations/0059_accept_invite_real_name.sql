-- 0059_accept_invite_real_name.sql
--
-- accept_invite stamped the new teammate's profile full_name with their EMAIL,
-- so invited interviewers showed up as "ivtest@onlazy.com" everywhere (team
-- lists, "requested by", scorecards, interview panels). The person's real name
-- is captured at signup and lives in auth.users.raw_user_meta_data.full_name
-- (set by accept-invite-create / signUp). Use that, falling back to the email
-- only when no name was provided.

create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_inv   public.invitations;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select * into v_inv from public.invitations
    where token = p_token and accepted_at is null and expires_at > now();
  if v_inv.id is null then
    raise exception 'invite invalid or expired' using errcode = 'P0002';
  end if;

  select email, nullif(trim(raw_user_meta_data->>'full_name'), '')
    into v_email, v_name
    from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'invite is for a different email' using errcode = '42501';
  end if;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_inv.company_id, coalesce(v_name, v_email), v_email, v_inv.role, 'active');

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.company_id;
end $$;

-- Backfill existing teammates whose name was set to their email but who have a
-- real name in auth metadata (e.g. everyone invited before this fix).
update public.profiles p
set full_name = nullif(trim(u.raw_user_meta_data->>'full_name'), '')
from auth.users u
where u.id = p.id
  and lower(p.full_name) = lower(p.email)
  and nullif(trim(u.raw_user_meta_data->>'full_name'), '') is not null;
