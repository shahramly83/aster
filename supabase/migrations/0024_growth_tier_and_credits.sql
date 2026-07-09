-- ============================================================================
-- Aster — add the Growth tier + new per-cycle credit counters
-- ============================================================================
-- Until now the DB knew only free / pro / enterprise, so it could not tell the
-- Free plan apart from Growth. This adds a real 'growth' tier and the new usage
-- counters. The limit functions + See Why RPCs that *reference* 'growth' live in
-- 0026, because Postgres forbids using a newly added enum value in the same
-- transaction that adds it (SQLSTATE 55P04).

-- ---------------------------------------------------------------------------
-- 1. Add the 'growth' tier.
-- ---------------------------------------------------------------------------
alter type plan_tier add value if not exists 'growth';

-- ---------------------------------------------------------------------------
-- 2. New per-cycle counters on usage_counters.
--    resume_parsing (existing) is reused as the bulk-upload pool.
-- ---------------------------------------------------------------------------
alter table public.usage_counters add column if not exists see_why            int not null default 0;
alter table public.usage_counters add column if not exists ai_insights        int not null default 0;
alter table public.usage_counters add column if not exists interview_questions int not null default 0;
alter table public.usage_counters add column if not exists applicant_parsing  int not null default 0;
