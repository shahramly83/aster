-- Per-interviewer "I'm done marking" flag for an availability poll. Marks stay
-- editable until the interviewer submits; then their availability is locked
-- (read-only, with an Edit escape hatch) until the poll closes.
create table if not exists public.interview_poll_submissions (
  poll_id      uuid not null references public.interview_polls(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (poll_id, profile_id)
);
create index if not exists idx_poll_submissions_poll on public.interview_poll_submissions (poll_id);

alter table public.interview_poll_submissions enable row level security;

drop policy if exists poll_submissions_read on public.interview_poll_submissions;
create policy poll_submissions_read on public.interview_poll_submissions for select
  using (company_id = public.current_company_id());

drop policy if exists poll_submissions_insert on public.interview_poll_submissions;
create policy poll_submissions_insert on public.interview_poll_submissions for insert
  with check (company_id = public.current_company_id() and profile_id = auth.uid());

drop policy if exists poll_submissions_delete on public.interview_poll_submissions;
create policy poll_submissions_delete on public.interview_poll_submissions for delete
  using (profile_id = auth.uid());

grant select, insert, delete on public.interview_poll_submissions to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interview_poll_submissions') then
    alter publication supabase_realtime add table public.interview_poll_submissions;
  end if;
end $$;
