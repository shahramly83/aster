-- ============================================================================
-- 0156: ai_unit_costs.updated_by blocked every save
-- ============================================================================
-- 0155 declared updated_by as a reference to public.profiles. Profiles are
-- CUSTOMER users; the person editing these rates is an Aster admin, and admins
-- live in public.admin_users. auth.uid() therefore never matched a profiles row
-- and every save failed with
--   insert or update on table "ai_unit_costs" violates foreign key constraint
--   "ai_unit_costs_updated_by_fkey"
-- which made the AI costs screen unusable.
--
-- The constraint is dropped rather than repointed at admin_users. updated_by is
-- informational only: who changed a rate is already recorded in the audit log,
-- which is the record that matters. Keeping a foreign key here buys nothing and
-- is one more way for a rate change to fail. The column keeps the uuid.
--
-- Idempotent: safe to re-run, and a no-op on a database created from the
-- corrected 0155.

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.ai_unit_costs'::regclass
       and conname  = 'ai_unit_costs_updated_by_fkey'
  ) then
    alter table public.ai_unit_costs drop constraint ai_unit_costs_updated_by_fkey;
  end if;
end $$;
