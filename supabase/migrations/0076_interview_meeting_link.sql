-- ============================================================================
-- 0076: store the interview's video meeting link
-- ============================================================================
-- The hiring manager creates the video call (Meet / Zoom / Teams) separately and
-- pastes the link into Aster, which shares it with the candidate and the panel
-- (different messages, same link). Persist it on the interview row so it survives
-- reloads and re-shares don't lose it.

alter table public.interviews
  add column if not exists meeting_link text;
