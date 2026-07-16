-- 0096_clear_job_views.sql
--
-- Reopening a closed role starts it fresh: its applicants are already dropped
-- (dbClearJobApplicants), and now its apply-page view analytics reset to zero too,
-- so the reopened posting's counts reflect the new run, not the previous one.
-- job_views has no delete policy (writes only ever happen through track_job_view),
-- so clearing needs a SECURITY DEFINER RPC. Admin-gated; only ever removes the
-- caller's own company's rows for the given job.
create or replace function public.clear_job_views(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.job_views where job_id = p_job_id and company_id = v_company;
end $$;

grant execute on function public.clear_job_views(uuid) to authenticated;
