-- ============================================================================
-- 0074: mark when a scheduling request has emailed the hiring managers
-- ============================================================================
-- When an interviewer requests an interview, the hiring managers should get an
-- email so they know to set it up. notify-scheduling-request sends that mail and
-- claims this stamp atomically, so a re-fire (retry, dedupe hit) never emails the
-- team twice for the same request.

alter table public.schedule_requests
  add column if not exists notified_at timestamptz;
