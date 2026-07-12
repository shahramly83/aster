-- 0060_interview_reminder.sql
--
-- Stamp when the "your interview is coming up" reminder was sent for a scheduled
-- interview, so the daily cron (scheduled-emails, task: interview_reminder) sends
-- it exactly once regardless of how often it runs.

alter table public.interviews
  add column if not exists reminder_sent_at timestamptz;
