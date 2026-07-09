-- ============================================================================
-- Aster: Oryx Digital Sdn Bhd workspace WIPE (no seed)
-- ============================================================================
-- Clears the workspace data for the "Oryx Digital Sdn Bhd" company ONLY, so the
-- app renders its empty states. Deletes candidates and jobs; foreign-key
-- cascades take care of applications, interviews, scorecards, offers, job_views
-- and role assignments. Your company row, team profiles and subscription are
-- left untouched. Run it in the Supabase SQL editor (executes as table owner,
-- bypassing RLS on purpose). No other company is touched. Safe to re-run.
--
-- To repopulate later, run oryx_workspace.sql.

do $$
declare
  co        record;
  found_co  boolean := false;
begin
for co in
  select id from public.companies c
  where c.name = 'Oryx Digital Sdn Bhd'
loop
  -- Deleting candidates cascades to applications, interviews, scorecards and
  -- offers; deleting jobs cascades to job_views and role assignments.
  delete from public.candidates where company_id = co.id;
  delete from public.jobs where company_id = co.id;
  found_co := true;
  raise notice 'Cleared workspace for company %', co.id;
end loop;
if not found_co then
  raise notice 'No company named "Oryx Digital Sdn Bhd" was found, nothing cleared. Run:  select id, name from public.companies;  to see exact names, then adjust the WHERE clause in this file.';
end if;
end $$;
