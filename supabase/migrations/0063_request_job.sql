-- 0063_request_job.sql
--
-- Let an interviewer request a NEW role. The jobs table's RLS (jobs_company)
-- only lets owners/admins write, so an interviewer's direct insert is refused
-- (42501). This narrow SECURITY DEFINER door inserts the requested role as a
-- DRAFT with an approval marker in the details jsonb, tagged with the requester,
-- so a hiring manager can review and publish it. It never publishes (status is
-- always 'draft', so no job-post credit is charged), and it always writes to the
-- caller's OWN company, resolved from their JWT.

create or replace function public.request_job(p_title text, p_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_name    text;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id, full_name into v_company, v_name from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;

  insert into public.jobs (company_id, title, status, created_by, details)
  values (
    v_company,
    coalesce(nullif(trim(p_title), ''), 'Untitled role'),
    'draft',
    v_uid,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
      'approvalStatus', 'pending',
      'requestedBy',    v_uid::text,
      'requestedByName', coalesce(v_name, '')
    )
  )
  returning id into v_id;

  return v_id;
end $$;
revoke all on function public.request_job(text, jsonb) from public, anon;
grant execute on function public.request_job(text, jsonb) to authenticated;
