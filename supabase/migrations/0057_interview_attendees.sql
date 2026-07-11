-- 0057_interview_attendees.sql
--
-- An interview can have more than one interviewer (the hiring manager plus a
-- subset of the job's pool). Until now the interviews row only carried a single
-- denormalised interviewer_name/email, so we couldn't notify every attendee or
-- scope the post-interview scorecard to the people who actually attended.
--
-- Store the panel as jsonb: [{ id, name, email }] where id is the profile id
-- (used to scope the scorecard) and name/email drive notifications. Kept on the
-- interviews row (not a join table) since it's always read and written together
-- with the interview and never queried across interviews. RLS is unchanged:
-- interviews are already visible to admins and to interviewers on the job.

alter table public.interviews
  add column if not exists attendees jsonb not null default '[]'::jsonb;

comment on column public.interviews.attendees is
  'Interview panel: [{id: profile_id, name, email}]. Drives attendee notifications and scorecard scoping.';
