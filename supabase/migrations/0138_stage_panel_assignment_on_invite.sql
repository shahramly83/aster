-- ============================================================================
-- 0138: put someone on an interview panel before they've accepted their invite
-- ============================================================================
-- job_assignments.profile_id references profiles, and an invited teammate has no
-- profile until they accept and sign up. So the one thing you invite an
-- interviewer FOR — putting them on a role — was impossible until they joined,
-- and the picker simply didn't list them, with nothing to say why.
--
-- The intent is now recorded on the invitation itself, and accept_invite applies
-- it the moment the profile exists. Nothing else has to learn about half-real
-- people: job_assignments is unchanged, and every query that reads it still sees
-- only real profiles.

alter table public.invitations
  add column if not exists pending_job_ids uuid[] not null default '{}';

comment on column public.invitations.pending_job_ids is
  'Roles this invitee should join the interview panel for. accept_invite() turns these into job_assignments when they sign up. Discarded with the row if the invite is cancelled or expires.';

-- ---------------------------------------------------------------------------
-- Stage / unstage a role on a pending invite
-- ---------------------------------------------------------------------------
-- Admin-gated exactly like assign_interviewer, and scoped to this workspace so a
-- caller cannot stage a job (or an invite) belonging to another company.
create or replace function public.stage_invite_job(p_invite uuid, p_job_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id and company_id = v_company) then
    raise exception 'job not in this workspace' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.invitations
                  where id = p_invite and company_id = v_company and accepted_at is null) then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if p_on then
    -- array_append would duplicate on a repeat tap; this stays idempotent.
    update public.invitations
       set pending_job_ids = (select array(select distinct unnest(pending_job_ids || p_job_id)))
     where id = p_invite;
  else
    update public.invitations
       set pending_job_ids = array_remove(pending_job_ids, p_job_id)
     where id = p_invite;
  end if;
end $$;

revoke all on function public.stage_invite_job(uuid, uuid, boolean) from public, anon;
grant execute on function public.stage_invite_job(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_invite: create the profile, then honour the staged panel assignments
-- ---------------------------------------------------------------------------
-- Unchanged from 0059 except for the job_assignments insert at the end. The
-- insert is deliberately forgiving: a role deleted or closed since the invite was
-- sent is skipped by the join rather than failing the whole signup, because
-- losing a panel seat must never cost someone their account.
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

  -- The panel seats they were promised while the invite was outstanding.
  insert into public.job_assignments (job_id, profile_id, company_id, assigned_by)
  select j.id, v_uid, v_inv.company_id, v_inv.invited_by
    from public.jobs j
   where j.company_id = v_inv.company_id
     and j.id = any (v_inv.pending_job_ids)
  on conflict (job_id, profile_id) do nothing;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.company_id;
end $$;
