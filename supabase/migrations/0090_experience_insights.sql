-- ============================================================================
-- 0090: Persist AI Experience Insights on the candidate
-- ============================================================================
-- AI Insight results were only held in a session cache, so a refresh lost them
-- and the user had to spend another credit to see the same read. Store the JSON
-- on the candidate row: once generated (and the credit spent) it is kept and
-- shown for good. analyze-experience (service role) writes it after a successful
-- run; the app loads it with the rest of the candidate on hydrate.

alter table public.candidates
  add column if not exists experience_insights jsonb;
