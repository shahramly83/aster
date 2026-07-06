-- ============================================================================
-- Aster — job posting expiry
-- ============================================================================
-- Jobs already carry a post date (created_at). This adds an optional expiry
-- date. Expiry is enforced where it matters: a job stops taking applications
-- once its expires_at has passed. The public apply RPC checks it below; the
-- parse-application edge function checks it too; and the UI shows expired jobs
-- as closed. (No cron is required — the checks are at apply time. If you also
-- want expired jobs flipped to status='closed' automatically, schedule a daily
-- pg_cron running: update public.jobs set status='closed'
--   where status='open' and expires_at is not null and expires_at < current_date;)

alter table public.jobs add column if not exists expires_at date;

-- Public apply intake now also refuses jobs whose expiry has passed.
create or replace function public.submit_application(
  p_job_id          uuid,
  p_name            text,
  p_email           text,
  p_phone           text default null,
  p_resume_filename text default null,
  p_source          text default 'Career Page'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company   uuid;
  v_status    text;
  v_expires   date;
  v_candidate uuid;
  v_app       uuid;
begin
  select company_id, status, expires_at into v_company, v_status, v_expires from public.jobs where id = p_job_id;
  if v_company is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if v_status <> 'open' then raise exception 'job not open' using errcode = 'P0001'; end if;
  if v_expires is not null and v_expires < current_date then raise exception 'job expired' using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required' using errcode = '22023';
  end if;

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
