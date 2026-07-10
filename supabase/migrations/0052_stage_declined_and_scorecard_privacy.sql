-- 0052_stage_declined_and_scorecard_privacy.sql
--
-- Candidate stage machine + scorecard privacy (per the agreed rules):
--   * Manual moves (owner/hiring-manager) are limited to shortlisted / rejected.
--   * "Interview Scheduled" reuses the existing `interviewing` stage (set
--     automatically when a booking is confirmed).
--   * Offer -> Hired (offer accepted) or Declined (offer rejected) are owner/HM
--     actions on the candidate profile. `declined` is a NEW stage.
--   * Each interviewer may see ONLY their own scorecard; owner/HM see all.

-- 1. New stage: offer declined by the candidate (distinct from `rejected`, which
--    is the company rejecting the candidate). Safe to add in-txn on PG15; it is
--    not USED in this migration, so no "unsafe use of new enum value" issue.
alter type public.app_stage add value if not exists 'declined';

-- 2. Scorecard privacy: an interviewer could previously read EVERY scorecard on
--    a job they were assigned to (job-scoped), so they saw other interviewers'
--    scores. Restrict their SELECT to their own row. Owner/HM keep full access
--    via scorecards_admin (unchanged).
drop policy if exists scorecards_interviewer_read on public.scorecards;
create policy scorecards_interviewer_read on public.scorecards
  for select using (
    interviewer_id = auth.uid()
    and job_id in (select public.assigned_job_ids())
  );
