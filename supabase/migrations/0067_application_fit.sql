-- ============================================================================
-- Aster — classify public applicants as Strong / Other (never reject)
-- ============================================================================
-- Public applications now accept everyone. At apply time the AI judges each
-- resume against the role's criteria and we store the verdict here so the
-- Applicants page can split candidates into two tabs:
--   'strong' — matches the role; run the full ranking / scoring / Why this fit.
--   'other'  — doesn't sufficiently match this role; saved to the talent pool,
--              not ranked for this role, labelled accordingly.
-- NULL means unclassified (pre-existing applications / job had no criteria) and
-- is treated as Strong. RLS on applications already scopes reads/writes.

alter table public.applications add column if not exists fit text; -- 'strong' | 'other' | null
