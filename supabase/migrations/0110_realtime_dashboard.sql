-- ============================================================================
-- 0110: realtime for the mobile dashboard
-- ============================================================================
-- Add the tables the manager dashboard reads to the Realtime publication so the
-- app can subscribe to live changes (new applications, stage moves, new roles,
-- logged activity) and refresh without a manual pull. RLS still governs which
-- rows a subscriber receives.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'applications') then
    alter publication supabase_realtime add table public.applications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs') then
    alter publication supabase_realtime add table public.jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log') then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end $$;
