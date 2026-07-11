-- 0058_interview_questions.sql
--
-- AI interview questions for a candidate + role. The hiring manager generates
-- them once; they're stored and shown (read-only) to every interviewer on the
-- job so the panel walks in with the same tailored questions.
--
-- One set per (candidate, job) enforces "generate once": a second attempt hits
-- the unique constraint and is ignored. HR generates; interviewers only read.

create table if not exists public.interview_questions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  questions    jsonb not null default '[]',
  generated_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create index if not exists idx_interview_questions_company on public.interview_questions(company_id);

alter table public.interview_questions enable row level security;

-- Hiring managers/owners manage; interviewers on the job read only.
drop policy if exists interview_questions_admin on public.interview_questions;
create policy interview_questions_admin on public.interview_questions for all
  using      (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());

drop policy if exists interview_questions_interviewer_read on public.interview_questions;
create policy interview_questions_interviewer_read on public.interview_questions for select
  using (job_id in (select public.assigned_job_ids()));

grant select, insert, update, delete on public.interview_questions to authenticated;
