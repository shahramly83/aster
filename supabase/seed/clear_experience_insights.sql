-- ============================================================================
-- Clear stored AI Experience Insights
-- ============================================================================
-- Wipes candidates.experience_insights (migration 0090) for one workspace.
--
-- What this does NOT do: remove the insight section from the app. Those figures
-- are recomputed from the parsed CV on every render by deriveInsights(), so a
-- cleared candidate simply falls back to the "FROM THE RESUME" view rather than
-- showing nothing.
--
-- What it costs: the column exists precisely so a paid analysis survives a
-- refresh. Clearing it discards work that was already charged for, and seeing
-- those insights again means spending another AI Insight credit per candidate.
--
-- Run STEP 1 first and read the count. STEP 2 is commented out on purpose.
-- ============================================================================

-- Set this once. Everything below is scoped to it, so a stray run can't reach
-- another workspace.
\set company_email 'tenant@onlazy.com'

-- ---------------------------------------------------------------------------
-- STEP 1 — Dry run. Who actually has a stored analysis?
-- ---------------------------------------------------------------------------
with target as (
  select p.company_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = :'company_email'
  limit 1
)
select
  c.id,
  c.full_name,
  c.email,
  jsonb_typeof(c.experience_insights) as stored,
  pg_size_pretty(length(c.experience_insights::text)::bigint) as size
from public.candidates c
join target t on t.company_id = c.company_id
where c.experience_insights is not null
order by c.full_name;

-- Expect zero rows if nobody in this workspace has run AI Insight. In that case
-- there is nothing to clear and STEP 2 would be a no-op.

-- ---------------------------------------------------------------------------
-- STEP 2 — The wipe. Uncomment ONLY after reading STEP 1's output.
-- ---------------------------------------------------------------------------
-- Irreversible: the JSON is not archived anywhere, and regenerating it costs a
-- credit per candidate.
--
-- with target as (
--   select p.company_id
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   where u.email = :'company_email'
--   limit 1
-- )
-- update public.candidates c
--    set experience_insights = null
--   from target t
--  where c.company_id = t.company_id
--    and c.experience_insights is not null
-- returning c.id, c.full_name;

-- To clear a single candidate instead, add to the WHERE above:
--    and c.full_name = 'Mohamad Shah Nusi bin Ramly'
