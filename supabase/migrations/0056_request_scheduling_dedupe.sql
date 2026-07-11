-- 0056_request_scheduling_dedupe.sql
--
-- "Request interview" lock. Interviewers on a job flag a candidate as ready for
-- the hiring manager to schedule (request_scheduling -> schedule_requests row).
-- Four interviewers sharing a screen could each click it for the same candidate,
-- creating duplicate requests. This makes the first request win and the rest a
-- no-op, and lets every interviewer on the job SEE that a request already exists
-- so the UI can show "requested by X" and disable the button.

-- 1. One OPEN (unresolved) request per application. A duplicate insert hits this.
create unique index if not exists uq_schedule_requests_open
  on public.schedule_requests (application_id) where resolved_at is null;

-- 2. Interviewers on a job may READ every open request for that job's
--    applications (not only their own), so the lock state is visible to all of
--    them. Admins already see all via schedule_requests_admin.
drop policy if exists schedule_requests_assigned_read on public.schedule_requests;
create policy schedule_requests_assigned_read on public.schedule_requests for select
  using (
    application_id in (
      select a.id from public.applications a
      where a.job_id in (select public.assigned_job_ids())
    )
  );

-- 3. Make the RPC idempotent: first requester wins; a later click returns the
--    existing open request instead of erroring or duplicating (and the unique
--    index above guards the concurrent race).
create or replace function public.request_scheduling(p_application_id uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.applications
    where id = p_application_id and job_id in (select public.assigned_job_ids());
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Already an open request for this candidate? Return it (first-come wins).
  select id into v_id from public.schedule_requests
    where application_id = p_application_id and resolved_at is null limit 1;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.schedule_requests (company_id, application_id, requested_by, note)
    values (v_company, p_application_id, auth.uid(), nullif(trim(p_note), ''))
    returning id into v_id;
  exception when unique_violation then
    -- Lost the race to a concurrent request; return the winner.
    select id into v_id from public.schedule_requests
      where application_id = p_application_id and resolved_at is null limit 1;
  end;
  return v_id;
end $$;
