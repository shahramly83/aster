-- ============================================================================
-- 0075: per-user candidate shortlists ("my picks")
-- ============================================================================
-- An interviewer marks the candidates they'd like to interview. It's THEIR own
-- list (each interviewer sees their own stars), and it's independent of the AI
-- Rank order and the pipeline stage: when a hiring manager re-runs AI Rank and
-- the list re-sorts by score, the interviewer can still see exactly who they
-- shortlisted before requesting interviews. Hiring managers may read every pick
-- in their workspace (to see what the panel is leaning toward).

create table if not exists public.candidate_shortlists (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id)    on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id)     on delete cascade,
  created_at     timestamptz not null default now(),
  unique (application_id, profile_id)
);
create index if not exists idx_candidate_shortlists_owner on public.candidate_shortlists(company_id, profile_id);
create index if not exists idx_candidate_shortlists_app   on public.candidate_shortlists(application_id);

alter table public.candidate_shortlists enable row level security;

-- Your own picks: read + add + remove. You can only shortlist a candidate on a
-- job you're assigned to (or any, if you're a manager), and always in your own
-- company as yourself.
drop policy if exists shortlists_own on public.candidate_shortlists;
create policy shortlists_own on public.candidate_shortlists for all
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and company_id = public.current_company_id()
    and (
      public.is_company_admin()
      or application_id in (
        select a.id from public.applications a where a.job_id in (select public.assigned_job_ids())
      )
    )
  );

-- Hiring managers (owner + admins) can read every pick in their workspace.
drop policy if exists shortlists_admin_read on public.candidate_shortlists;
create policy shortlists_admin_read on public.candidate_shortlists for select
  using (company_id = public.current_company_id() and public.is_company_admin());
