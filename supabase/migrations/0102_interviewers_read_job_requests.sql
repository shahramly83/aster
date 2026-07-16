-- ============================================================================
-- 0102: interviewers see the whole panel's interview requests for their jobs
-- ============================================================================
-- schedule_requests previously let an interviewer read only their OWN requests
-- (schedule_requests_self_read). So a request raised by one interviewer was
-- invisible to the others on the same job. This adds a SELECT policy scoped to the
-- interviewer's assigned jobs, so every interviewer on a job sees all pending
-- requests for it, attributed to who raised them. Managers/tenant already read all
-- (schedule_requests_admin). Additive: RLS policies are OR'd, so this only grants.
drop policy if exists schedule_requests_assigned_read on public.schedule_requests;
create policy schedule_requests_assigned_read on public.schedule_requests
  for select using (
    company_id = public.current_company_id()
    and application_id in (
      select a.id from public.applications a where a.job_id in (select public.assigned_job_ids())
    )
  );
