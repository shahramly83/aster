-- ============================================================================
-- 0125: correct the AI Question monthly limits
-- ============================================================================
-- Scale 100 -> 30, Elite 300 -> 100. Launch (5) and Enterprise (unlimited,
-- null) are unchanged.
--
-- This is the function bump_interview_questions() reads, so it is what actually
-- enforces the cap. shared/plan.js carries the same numbers for the meter the
-- UI draws; both are updated together, because a mismatch either shows a meter
-- that never fills or refuses a generate the meter says is still available.
create or replace function public._interview_q_limit(p_plan plan_tier)
returns int language sql immutable as $$
  select case p_plan when 'launch' then 5 when 'scale' then 30 when 'elite' then 100 else null end;
$$;
