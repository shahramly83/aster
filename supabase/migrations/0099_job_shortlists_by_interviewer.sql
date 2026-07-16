-- ============================================================================
-- 0099: Manager view of who each interviewer shortlisted (attribution)
-- ============================================================================
-- Interviewer shortlists stay PRIVATE between interviewers (no anchoring bias):
-- each interviewer only ever sees their own stars (candidate_shortlists RLS
-- shortlists_own). But the HIRING MANAGER should see the whole panel's picks with
-- attribution ("Shortlisted by Rahim, Ivan") to gauge consensus. The RLS already
-- lets admins read every pick; this RPC just joins the shortlister's name and
-- scopes to one job, admin-gated so only managers/tenant can call it.
create or replace function public.get_job_shortlists(p_job_id uuid)
returns table (application_id uuid, profile_id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select cs.application_id, cs.profile_id, coalesce(nullif(btrim(p.full_name), ''), 'Interviewer')
    from public.candidate_shortlists cs
    join public.applications a on a.id = cs.application_id and a.company_id = v_company
    left join public.profiles p on p.id = cs.profile_id
    where cs.company_id = v_company and a.job_id = p_job_id;
end $$;
grant execute on function public.get_job_shortlists(uuid) to authenticated;
