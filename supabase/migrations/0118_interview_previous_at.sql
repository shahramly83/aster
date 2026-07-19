-- 0118_interview_previous_at.sql
-- ---------------------------------------------------------------------------
-- When an interview is rescheduled (a no-show, or the candidate can't make the
-- offered times), we keep the ORIGINAL interview time in previous_at. That lets
-- the panel poll and the candidate's new invite show "rescheduled from <date>",
-- instead of losing the context when scheduled_at is cleared.
alter table public.interviews add column if not exists previous_at timestamptz;
