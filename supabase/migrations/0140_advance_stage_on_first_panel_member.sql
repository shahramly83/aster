-- ============================================================================
-- 0140: staffing an empty panel moves the role's applicants to Interview
-- ============================================================================
-- The mirror of 0139. Emptying a role's panel sends its untouched candidates
-- back to Applied; putting the first person on it is that same act done, so the
-- candidates should move to Interview. The web already did this when the panel
-- was set from a candidate's profile, but the panel is also edited from the web
-- pipeline and the mobile role screen, where there is no candidate in context
-- and nothing happened at all. The rule belongs next to its opposite, in one
-- place, so the two can never disagree.
--
-- Scope, deliberately: this fires only when the panel goes from EMPTY to having
-- somebody. Adding a second interviewer later does not re-sweep the role, and a
-- candidate rejected or hired in the meantime is left alone by the stage filter.
--
-- Non-matches are excluded. AI Rank already sorts applicants into Strong and
-- Other, and sweeping a candidate the model judged unrelated to the role into
-- Interview is not what staffing a panel means.
--
-- Note this is a ROLE-level rule: every strong applicant sitting at Applied on
-- that role moves, not one candidate. That is inherent in where the panel lives
-- (it belongs to the job, not to a candidate) and is the behaviour asked for.

create or replace function public._advance_stage_on_first_panel_member(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_id is null then return; end if;

  update public.applications a
     set stage = 'interviewing'
   where a.job_id = p_job_id
     and a.stage = 'applied'
     and coalesce(a.fit, '') <> 'other';
end $$;

revoke all on function public._advance_stage_on_first_panel_member(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- First interviewer assigned to the role
-- ---------------------------------------------------------------------------
create or replace function public._trg_panel_assignment_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Was this the first? Anyone else already assigned means the panel was not
  -- empty, so nothing changes. The new row is already visible to this AFTER
  -- trigger, hence the exclusion of its own profile_id.
  if exists (
    select 1 from public.job_assignments
     where job_id = new.job_id and profile_id <> new.profile_id
  ) then
    return new;
  end if;

  perform public._advance_stage_on_first_panel_member(new.job_id);
  return new;
end $$;

revoke all on function public._trg_panel_assignment_added() from public, anon, authenticated;

drop trigger if exists trg_advance_stage_on_panel_added on public.job_assignments;
create trigger trg_advance_stage_on_panel_added
  after insert on public.job_assignments
  for each row
  execute function public._trg_panel_assignment_added();

-- ---------------------------------------------------------------------------
-- A role staged onto an invitation that has not been accepted yet
-- ---------------------------------------------------------------------------
-- The other half of the pair 0139 covers on the way out. An invite is a decision
-- already made, so it counts as staffing the panel even before they sign up,
-- which is what "even though it is still pending" meant.
create or replace function public._trg_invite_staged()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_added uuid[];
  v_job   uuid;
begin
  select coalesce(array_agg(j), '{}') into v_added
    from unnest(coalesce(new.pending_job_ids, '{}')) j
   where tg_op = 'INSERT'
      or not (j = any (coalesce(old.pending_job_ids, '{}')));

  foreach v_job in array v_added loop
    -- Only if nobody was on the panel before this invite was staged.
    if not exists (select 1 from public.job_assignments where job_id = v_job)
       and not exists (
         select 1 from public.invitations
          where id <> new.id
            and accepted_at is null
            and expires_at > now()
            and v_job = any (pending_job_ids)
       )
    then
      perform public._advance_stage_on_first_panel_member(v_job);
    end if;
  end loop;

  return new;
end $$;

revoke all on function public._trg_invite_staged() from public, anon, authenticated;

drop trigger if exists trg_advance_stage_on_invite_staged on public.invitations;
create trigger trg_advance_stage_on_invite_staged
  after insert or update of pending_job_ids on public.invitations
  for each row
  execute function public._trg_invite_staged();

comment on function public._advance_stage_on_first_panel_member(uuid) is
  'When a role gets its first panel member (assigned or staged on an invitation), moves its strong-match Applied candidates to Interview. Mirror of _revert_stage_if_panel_empty.';
