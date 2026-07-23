-- ============================================================================
-- 0127: interviews.starting_soon_notified_at
-- ============================================================================
-- The day-before reminder (reminder_sent_at, 0060) is a separate tier from the
-- "starts soon" push added here, so it needs its own stamp: an interview should
-- get the heads-up the day before AND the buzz an hour before, each exactly
-- once. A tighter cron fires the soon-reminder and stamps this, so a job that
-- runs every 15 minutes never pushes the same interview twice.
alter table public.interviews
  add column if not exists starting_soon_notified_at timestamptz;

comment on column public.interviews.starting_soon_notified_at is
  'Set when the ~1h "starting soon" push has gone out. Distinct from reminder_sent_at (the day-before reminder).';
