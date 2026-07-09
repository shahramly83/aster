-- ============================================================================
-- Aster: Oryx Digital Sdn Bhd usage reset (AI Rank + metered counters)
-- ============================================================================
-- Zeroes this company's usage counters (AI Rank credits, resume parsing, active
-- jobs, api calls) for every cycle, so metered limits read 0 / limit again.
-- These counters live in public.usage_counters and are independent of workspace
-- data, so wiping candidates/jobs does NOT reset them, which is why AI Rank can
-- still show "8 / 5 used" on an empty workspace. Run in the Supabase SQL editor
-- (executes as table owner, bypassing RLS on purpose). Company, team and
-- subscription are untouched. Safe to re-run.

-- Full reset: clears every metered counter for the company.
delete from public.usage_counters uc
using public.companies c
where c.name = 'Oryx Digital Sdn Bhd'
  and uc.company_id = c.id;

-- AI Rank ONLY (keep resume-parsing / active-jobs / api counters): comment out
-- the delete above and use this instead:
--   update public.usage_counters uc set ai_runs = 0
--     from public.companies c
--     where c.name = 'Oryx Digital Sdn Bhd' and uc.company_id = c.id;
