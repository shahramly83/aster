-- ============================================================================
-- 0123: publish candidates + interviews for realtime
-- ============================================================================
-- The web workspace channel (ws:<companyId>) already listens on both tables,
-- but neither was ever added to the supabase_realtime publication, so Postgres
-- never emitted the changes and the subscription sat silent. The symptom people
-- actually hit: run AI Insight on mobile, and the same profile open on the web
-- keeps showing the Run button until a manual reload, because insightsCache is
-- only refilled by hydrateWorkspace.
--
-- 0110 published applications / jobs / activity_log and 0114 the poll tables;
-- these two were simply missed.
--
-- RLS still applies. Realtime evaluates each subscriber's policies before
-- delivering a row, so publishing a table widens nobody's access: a client only
-- ever receives changes it could already have selected.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidates'
  ) then
    alter publication supabase_realtime add table public.candidates;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interviews'
  ) then
    alter publication supabase_realtime add table public.interviews;
  end if;
end $$;
