-- Scorecards release gate: the hiring manager confirms the interview happened
-- ("Proceed to scorecards") before the panel can score. This stamp records that
-- release so an interviewer's separate client knows the scorecard is open.
-- Null = not yet released (panel scorecards stay locked).
alter table public.interviews
  add column if not exists scorecards_released_at timestamptz;
