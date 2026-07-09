-- ============================================================================
-- Aster — 365-day retention for expired job postings
-- ============================================================================
-- Locked pricing matrix: expired jobs are retained for 365 days, then purged
-- (replacing the earlier "don't delete" policy, which left personal data on
-- expired roles indefinitely). Retention is measured from a job's expires_at.
-- A job with no expires_at is never auto-purged by this routine; it lives until
-- the workspace itself is deleted (see 0018 purge_expired_workspaces).
--
-- Deleting a job cascades to its applications, interviews, and scorecards via
-- the existing FK cascades. Resume files in the `resumes` storage bucket are
-- NOT covered by the cascade; the scheduled edge function that calls this must
-- also remove the storage objects for the purged candidates it no longer needs.
-- Service-role only; call from the same daily cron as purge_expired_workspaces.

-- Default retention window, in days, so app + cron agree on one number.
create or replace function public._job_retention_days()
returns int language sql immutable as $$ select 365; $$;

create or replace function public.purge_expired_jobs(p_days int default null)
returns table (purged_job_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_days int := coalesce(p_days, public._job_retention_days());
begin
  return query
  delete from public.jobs
   where expires_at is not null
     and expires_at < (current_date - (v_days || ' days')::interval)
  returning id;
end;
$$;

revoke all on function public.purge_expired_jobs(int) from public, anon, authenticated;
grant execute on function public.purge_expired_jobs(int) to service_role;
