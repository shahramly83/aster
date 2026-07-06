-- ============================================================================
-- Aster — public job application intake
-- ============================================================================
-- A candidate applying through a job's public link is anonymous, and RLS
-- correctly blocks anon from inserting candidates/applications. This
-- SECURITY DEFINER function is the one narrow, safe door: given an OPEN job, it
-- creates (or reuses) the candidate and files an 'applied' application for that
-- job's company. It can do nothing else — no reads leak back, no other table is
-- touched, and it refuses anything but an open job.

create or replace function public.submit_application(
  p_job_id          uuid,
  p_name            text,
  p_email           text,
  p_phone           text default null,
  p_resume_filename text default null,
  p_source          text default 'Career Page'
) returns uuid                       -- the application id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company   uuid;
  v_status    text;
  v_candidate uuid;
  v_app       uuid;
begin
  select company_id, status into v_company, v_status from public.jobs where id = p_job_id;
  if v_company is null then raise exception 'job not found'  using errcode = 'P0002'; end if;
  if v_status <> 'open' then raise exception 'job not open'   using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required' using errcode = '22023';
  end if;

  -- Reuse an existing candidate with this email in the company, else create one.
  select id into v_candidate from public.candidates
    where company_id = v_company and lower(email) = lower(trim(p_email)) limit 1;

  if v_candidate is null then
    insert into public.candidates (company_id, full_name, email, phone, file_name, status, has_photo, parsed)
    values (
      v_company, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''),
      p_resume_filename, 'parsed', false,
      jsonb_build_object(
        'name', trim(p_name), 'email', lower(trim(p_email)), 'phone', nullif(trim(p_phone), ''),
        'skills', jsonb_build_array(), 'experience', jsonb_build_array(),
        'education', jsonb_build_array(), 'summary', null, 'years_of_experience', null)
    )
    returning id into v_candidate;
  end if;

  -- One application per candidate per job.
  select id into v_app from public.applications
    where company_id = v_company and candidate_id = v_candidate and job_id = p_job_id limit 1;

  if v_app is null then
    insert into public.applications (company_id, candidate_id, job_id, stage, source)
    values (v_company, v_candidate, p_job_id, 'applied', coalesce(nullif(trim(p_source), ''), 'Career Page'))
    returning id into v_app;
  end if;

  return v_app;
end;
$$;

revoke all on function public.submit_application(uuid, text, text, text, text, text) from public;
grant execute on function public.submit_application(uuid, text, text, text, text, text) to anon, authenticated;
