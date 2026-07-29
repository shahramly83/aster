-- ============================================================================
-- 0139: emptying a role's panel puts its untouched candidates back to Applied
-- ============================================================================
-- Putting someone on a candidate's panel moves that candidate to Interview (the
-- web does this when the panel is set from the candidate's profile). Taking the
-- last person back off is the same act undone, so the candidate should go back
-- to Applied rather than sitting at Interview with nobody to interview them and
-- no way to tell why.
--
-- This lives in the database rather than in each client because the panel is
-- edited from three places already (the web candidate profile, the web pipeline,
-- the mobile role screen) and only one of them has a candidate in context. A
-- trigger keeps the rule identical everywhere and cannot drift between clients.
--
-- It is deliberately timid. A candidate is only moved back when ALL of these
-- hold, so nothing in flight is ever disturbed:
--   * the role has nobody left on its panel, staged invitations included
--   * the candidate is sitting exactly at 'interviewing'
--   * no interview row exists for them on this role (nothing offered or booked)
--   * no availability poll exists for them on this role
-- Anyone at offer, hired, rejected or declined is untouched by the stage filter,
-- and a candidate whose interview is already arranged keeps it.

create or replace function public._revert_stage_if_panel_empty(p_job_id uuid, p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_id is null then return; end if;

  -- Someone still on the panel? Then it was reduced, not emptied.
  if exists (select 1 from public.job_assignments where job_id = p_job_id) then
    return;
  end if;

  -- An invitee staged onto this role (0138) counts as being on the panel: they
  -- have accepted nothing yet, but the hiring manager has already decided.
  if exists (
    select 1
      from public.invitations
     where accepted_at is null
       and expires_at > now()
       and p_job_id = any (pending_job_ids)
       and (p_company is null or company_id = p_company)
  ) then
    return;
  end if;

  update public.applications a
     set stage = 'applied'
   where a.job_id = p_job_id
     and a.stage = 'interviewing'
     and not exists (
       select 1 from public.interviews i
        where i.candidate_id = a.candidate_id
          and i.job_id = a.job_id
     )
     and not exists (
       select 1 from public.interview_polls p
        where p.candidate_id = a.candidate_id
          and p.job_id = a.job_id
     );
end $$;

revoke all on function public._revert_stage_if_panel_empty(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An accepted interviewer leaves the panel
-- ---------------------------------------------------------------------------
create or replace function public._trg_panel_assignment_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._revert_stage_if_panel_empty(old.job_id, old.company_id);
  return old;
end $$;

revoke all on function public._trg_panel_assignment_removed() from public, anon, authenticated;

drop trigger if exists trg_revert_stage_on_empty_panel on public.job_assignments;
create trigger trg_revert_stage_on_empty_panel
  after delete on public.job_assignments
  for each row
  execute function public._trg_panel_assignment_removed();

-- ---------------------------------------------------------------------------
-- A staged invitation is unstaged, cancelled, or expires out of the way
-- ---------------------------------------------------------------------------
-- Without this the rule has an obvious hole: a panel whose only member is a
-- pending invite is emptied by an UPDATE to invitations.pending_job_ids (mobile
-- toggles the role off) or by deleting the invitation (cancelled), neither of
-- which touches job_assignments. The candidate would then be stranded at
-- Interview exactly as before.
-- The set of removed roles is worked out in plpgsql rather than inside a SQL
-- subquery: NEW is unassigned during a DELETE, so a query that mentions
-- new.pending_job_ids at all is unsafe there even when guarded by TG_OP.
create or replace function public._trg_invite_unstaged()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_removed uuid[];
  v_job     uuid;
begin
  if tg_op = 'DELETE' then
    v_removed := coalesce(old.pending_job_ids, '{}');
  else
    select coalesce(array_agg(j), '{}') into v_removed
      from unnest(coalesce(old.pending_job_ids, '{}')) j
     where not (j = any (coalesce(new.pending_job_ids, '{}')));
  end if;

  foreach v_job in array v_removed loop
    perform public._revert_stage_if_panel_empty(v_job, old.company_id);
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function public._trg_invite_unstaged() from public, anon, authenticated;

drop trigger if exists trg_revert_stage_on_invite_unstaged on public.invitations;
create trigger trg_revert_stage_on_invite_unstaged
  after update of pending_job_ids or delete on public.invitations
  for each row
  execute function public._trg_invite_unstaged();

comment on function public._revert_stage_if_panel_empty(uuid, uuid) is
  'Once a role has nobody left on its panel (assignments and staged invitations both), sends its Interview-stage candidates back to Applied unless an interview or availability poll already exists for them. Pairs with the web moving a candidate to Interview when their panel is set.';
