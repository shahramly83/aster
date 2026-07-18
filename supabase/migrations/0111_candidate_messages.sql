-- ============================================================================
-- 0109: candidate_messages — team discussion (chat) on a candidate
-- ============================================================================
-- A lightweight chat thread scoped to a candidate, so hiring managers and the
-- interview panel can talk about a specific candidate in context (the mobile
-- "Discussion" feature). Realtime-enabled so open threads update live.
--
-- Visibility: a company member may read/post in a candidate's thread if they are
-- a manager (owner/admin/recruiter) OR they're on the panel for the message's
-- role (job_assignments). Managers see all; interviewers see the roles they're on.
create table if not exists public.candidate_messages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index if not exists idx_candidate_messages_thread on public.candidate_messages (candidate_id, created_at);

alter table public.candidate_messages enable row level security;

-- Is the current user a manager in their company?
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner', 'admin', 'recruiter')
  );
$$;

-- Read: same company, and either a manager or on the panel for this role.
drop policy if exists candidate_messages_read on public.candidate_messages;
create policy candidate_messages_read on public.candidate_messages for select
  using (
    company_id = public.current_company_id()
    and (
      public.is_manager()
      or job_id in (select ja.job_id from public.job_assignments ja where ja.profile_id = auth.uid())
    )
  );

-- Insert: you may only post as yourself, in your company, where you can read.
drop policy if exists candidate_messages_insert on public.candidate_messages;
create policy candidate_messages_insert on public.candidate_messages for insert
  with check (
    author_id = auth.uid()
    and company_id = public.current_company_id()
    and (
      public.is_manager()
      or job_id in (select ja.job_id from public.job_assignments ja where ja.profile_id = auth.uid())
    )
  );

-- Authors can delete their own message; no updates (chat is append-only).
drop policy if exists candidate_messages_delete on public.candidate_messages;
create policy candidate_messages_delete on public.candidate_messages for delete
  using (author_id = auth.uid());

grant select, insert, delete on public.candidate_messages to authenticated;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- Realtime: stream inserts to clients with the thread open. Guarded so re-running
-- (the table may already be a publication member) is a no-op rather than an error.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidate_messages') then
    alter publication supabase_realtime add table public.candidate_messages;
  end if;
end $$;
