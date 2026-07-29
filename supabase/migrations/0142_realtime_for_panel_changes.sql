-- ============================================================================
-- 0142: publish panel changes over realtime
-- ============================================================================
-- Removing an interviewer on the web left the mobile candidate profile showing
-- them until it happened to lose and regain focus. Editing a panel touches
-- neither `interviews` nor `activity_log`, which are the two signals that screen
-- was listening to, so nothing told it anything had changed.
--
-- REPLICA IDENTITY FULL as well as the publication, and that part matters for
-- more than completeness: with the default replica identity a DELETE payload
-- carries only the primary key, which is not enough for the server to evaluate
-- the row against RLS, so deletes get broadcast to every subscriber regardless
-- of policy. FULL puts the whole old row in the payload, so `job_assignments_read`
-- and `invitations_admin` are applied to deletes the same way they are to inserts
-- and updates, and a workspace only ever hears about its own panels.
--
-- Both tables are small and rarely written (a panel is edited a handful of times
-- per role), so the extra WAL volume from FULL is immaterial here.

alter table public.job_assignments replica identity full;
alter table public.invitations     replica identity full;

-- add_table is not idempotent, so guard rather than fail a re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_assignments'
  ) then
    alter publication supabase_realtime add table public.job_assignments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invitations'
  ) then
    alter publication supabase_realtime add table public.invitations;
  end if;
end $$;
