-- ============================================================================
-- 0124: let the interview panel write interview questions
-- ============================================================================
-- 0058 gave interviewers read-only access: writes were admin-only. That matched
-- the old rule where only a hiring manager could generate a set. Interviewers
-- generate now (they are the ones walking into the room), and both clients save
-- from the client session, so without this their generate would spend the credit
-- and then fail silently at the save.
--
-- Scoped to jobs they are actually assigned to, so an interviewer still cannot
-- touch a role they are not on. The company check is kept alongside
-- assigned_job_ids() as defence in depth.
--
-- One row per candidate+job, so "regenerate" is an update of that row rather
-- than a second row: the panel always reads one set.

drop policy if exists interview_questions_panel_insert on public.interview_questions;
create policy interview_questions_panel_insert on public.interview_questions for insert
  with check (
    company_id = public.current_company_id()
    and job_id in (select public.assigned_job_ids())
  );

drop policy if exists interview_questions_panel_update on public.interview_questions;
create policy interview_questions_panel_update on public.interview_questions for update
  using (
    company_id = public.current_company_id()
    and job_id in (select public.assigned_job_ids())
  )
  with check (
    company_id = public.current_company_id()
    and job_id in (select public.assigned_job_ids())
  );
