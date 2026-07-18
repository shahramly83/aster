-- ============================================================================
-- 0114: interview_polls — propose interview dates to the panel, collect votes
-- ============================================================================
-- A hiring manager proposes a few candidate interview date/time slots; the
-- assigned interviewers (the panel) mark which slots they're available for. The
-- manager then picks the winning slot, which schedules the interview.
--
-- Visibility mirrors candidate_messages (0109): a manager sees all; an
-- interviewer sees polls for roles they're assigned to (job_assignments).

create table if not exists public.interview_polls (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  chosen_slot  timestamptz,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create index if not exists idx_interview_polls_candidate on public.interview_polls (candidate_id, created_at desc);

create table if not exists public.interview_poll_slots (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.interview_polls(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  slot_ts    timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_interview_poll_slots_poll on public.interview_poll_slots (poll_id);

create table if not exists public.interview_poll_votes (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.interview_polls(id) on delete cascade,
  slot_id    uuid not null references public.interview_poll_slots(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  voter_name text,
  created_at timestamptz not null default now(),
  unique (slot_id, profile_id)
);
create index if not exists idx_interview_poll_votes_poll on public.interview_poll_votes (poll_id);

alter table public.interview_polls      enable row level security;
alter table public.interview_poll_slots enable row level security;
alter table public.interview_poll_votes enable row level security;

-- Manager, or an interviewer assigned to this role. (is_manager() from 0109.)
create or replace function public.can_see_role(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or (p_job_id is not null
        and p_job_id in (select ja.job_id from public.job_assignments ja where ja.profile_id = auth.uid()));
$$;
revoke all on function public.can_see_role(uuid) from public, anon;
grant execute on function public.can_see_role(uuid) to authenticated;

-- Polls: panel members read; managers create/close.
drop policy if exists interview_polls_read on public.interview_polls;
create policy interview_polls_read on public.interview_polls for select
  using (company_id = public.current_company_id() and public.can_see_role(job_id));

drop policy if exists interview_polls_insert on public.interview_polls;
create policy interview_polls_insert on public.interview_polls for insert
  with check (company_id = public.current_company_id() and public.is_manager() and created_by = auth.uid());

drop policy if exists interview_polls_update on public.interview_polls;
create policy interview_polls_update on public.interview_polls for update
  using (company_id = public.current_company_id() and public.is_manager());

-- Slots: panel reads; managers add (at poll creation).
drop policy if exists interview_poll_slots_read on public.interview_poll_slots;
create policy interview_poll_slots_read on public.interview_poll_slots for select
  using (company_id = public.current_company_id()
    and poll_id in (select id from public.interview_polls where public.can_see_role(job_id)));

drop policy if exists interview_poll_slots_insert on public.interview_poll_slots;
create policy interview_poll_slots_insert on public.interview_poll_slots for insert
  with check (company_id = public.current_company_id() and public.is_manager());

-- Votes: any panel member reads; each votes as themselves; removes own vote.
drop policy if exists interview_poll_votes_read on public.interview_poll_votes;
create policy interview_poll_votes_read on public.interview_poll_votes for select
  using (company_id = public.current_company_id()
    and poll_id in (select id from public.interview_polls where public.can_see_role(job_id)));

drop policy if exists interview_poll_votes_insert on public.interview_poll_votes;
create policy interview_poll_votes_insert on public.interview_poll_votes for insert
  with check (company_id = public.current_company_id() and profile_id = auth.uid()
    and poll_id in (select id from public.interview_polls where public.can_see_role(job_id)));

drop policy if exists interview_poll_votes_delete on public.interview_poll_votes;
create policy interview_poll_votes_delete on public.interview_poll_votes for delete
  using (profile_id = auth.uid());

grant select, insert, update on public.interview_polls to authenticated;
grant select, insert on public.interview_poll_slots to authenticated;
grant select, insert, delete on public.interview_poll_votes to authenticated;

-- Realtime: votes/polls stream so an open thread updates live.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interview_poll_votes') then
    alter publication supabase_realtime add table public.interview_poll_votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interview_polls') then
    alter publication supabase_realtime add table public.interview_polls;
  end if;
end $$;
