-- ============================================================================
-- 0141: take the panel/stage rule out of the database
-- ============================================================================
-- 0139 and 0140 moved candidates between Applied and Interview whenever a role's
-- panel was emptied or first staffed. The rule was right; the place was wrong.
--
-- A panel belongs to the JOB, so a trigger on job_assignments has no idea which
-- candidate the person editing it had in mind. It could only act on all of them,
-- and staffing a panel would sweep every strong applicant on the role into
-- Interview at once — seven of them on a role with eight applicants, when the
-- intent was one. The reverse had the same fault: emptying a panel dragged back
-- candidates a hiring manager had moved forward by hand for their own reasons.
--
-- The move now happens in the clients, on the candidate whose profile you are
-- looking at, which is the only place that knows who is meant. Editing a panel
-- from a role screen changes no stages at all, which is correct: at that point
-- nobody has said which candidate this is about.

drop trigger if exists trg_revert_stage_on_empty_panel on public.job_assignments;
drop trigger if exists trg_revert_stage_on_invite_unstaged on public.invitations;
drop trigger if exists trg_advance_stage_on_panel_added on public.job_assignments;
drop trigger if exists trg_advance_stage_on_invite_staged on public.invitations;

drop function if exists public._trg_panel_assignment_removed();
drop function if exists public._trg_invite_unstaged();
drop function if exists public._trg_panel_assignment_added();
drop function if exists public._trg_invite_staged();
drop function if exists public._revert_stage_if_panel_empty(uuid, uuid);
drop function if exists public._advance_stage_on_first_panel_member(uuid);
