-- ============================================================================
-- 0115: interview_poll_slots.slot_end — proposed slots are time ranges
-- ============================================================================
-- A proposed interview slot is a window (e.g. 2:00-3:00 PM), so store the end
-- alongside the start. Nullable for any pre-existing single-time rows.
alter table public.interview_poll_slots
  add column if not exists slot_end timestamptz;
