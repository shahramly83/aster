-- ============================================================================
-- 0073: let an interviewer read the roles THEY requested (any status)
-- ============================================================================
-- jobs_interviewer_read (0021) only lets an interviewer SELECT jobs they've been
-- assigned to. But request_job (0063) files a requested role as a DRAFT with
-- created_by = the requester and it is not assigned to anyone, so the requester
-- could never see their own request come back, its approval status, or the
-- published role: their "Open Roles > Your requests" list was always blank,
-- whether the hiring manager approved or rejected it.
--
-- Widen the policy so an interviewer also sees any job they created (requested).
-- created_by = auth.uid() is inherently self-scoped and same-company, so this
-- exposes nothing beyond the requester's own rows.

drop policy if exists jobs_interviewer_read on public.jobs;
create policy jobs_interviewer_read on public.jobs for select
  using (
    id in (select public.assigned_job_ids())
    or created_by = auth.uid()
  );
