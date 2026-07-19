-- 0117_realtime_web.sql
-- ---------------------------------------------------------------------------
-- Make the web app fully realtime. The collaborative tables the workspace reads
-- live (applications, jobs, activity_log, candidate_messages, interview_polls,
-- interview_poll_votes) are already published to supabase_realtime; add the
-- remaining ones the web UI reacts to: interviews (scheduling / booking status),
-- interview_poll_slots (a new poll's options), and candidates (edits, new hires).
--
-- interview_poll_votes and interviews get REPLICA IDENTITY FULL so DELETE events
-- (un-voting, a withdrawn interview) carry enough columns for row-level security
-- to be evaluated and delivered to subscribers, not just the primary key.
-- Idempotent: safe to re-run.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interviews') then
    alter publication supabase_realtime add table public.interviews;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interview_poll_slots') then
    alter publication supabase_realtime add table public.interview_poll_slots;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidates') then
    alter publication supabase_realtime add table public.candidates;
  end if;
end $$;

alter table public.interview_poll_votes replica identity full;
alter table public.interviews replica identity full;
