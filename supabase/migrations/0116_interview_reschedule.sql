-- ============================================================================
-- 0116: interview reschedule + candidate-proposed availability
-- ============================================================================
-- Adds the reschedule loop to interview scheduling:
--   * A candidate can decline ALL proposed times on the booking page and suggest
--     their own dates. Those dates become a panel poll flagged proposed_by =
--     'candidate' (round 2: candidate proposes, the panel picks one).
--   * After a scheduled interview's time passes, the HM can reschedule (a fresh
--     poll) instead of scoring — e.g. a no-show.
--
-- interviews.status already has no CHECK constraint (0001 defaults it to
-- 'scheduled'), so the new 'reschedule' value needs no ALTER — the flow just
-- uses it alongside 'sent' and 'scheduled'.

-- Distinguish a candidate-suggested poll (round 2) from the panel's own poll
-- (round 1). Round-1 polls stay 'panel'; the booking-page decline creates a
-- 'candidate' poll the panel then votes on.
alter table public.interview_polls
  add column if not exists proposed_by text not null default 'panel'
    check (proposed_by in ('panel', 'candidate'));

-- The candidate's optional note when declining the offered times ("mornings are
-- better"), and when the decline happened — shown to the HM.
alter table public.interviews
  add column if not exists reschedule_note text,
  add column if not exists reschedule_at   timestamptz;
