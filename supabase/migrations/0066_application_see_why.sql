-- ============================================================================
-- Aster — persist the "Why this fit" (See Why) explanation per application
-- ============================================================================
-- The per-candidate fit rationale used to live only in browser session state, so
-- it vanished on reload and an AI Rank re-run, and re-viewing it cost another
-- credit. Store it on the application row (same place as match_score /
-- match_reasons) so it survives and is read back for free. RLS on applications
-- already scopes reads/writes to the owning company.

alter table public.applications add column if not exists see_why text;
