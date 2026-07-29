-- ============================================================================
-- 0143: a spend log, so a company can see what its credits actually went on
-- ============================================================================
-- Today a workspace can see what it BOUGHT (credit_purchase_log), what it has
-- LEFT (purchased_credits), and how many it has used this period in aggregate
-- (usage_counters). What it cannot see is what any of that was spent on. "You
-- have used 6 of 500 applicant screenings" answers nothing when the question is
-- "why did that cost me a credit?".
--
-- This records one row per spend, with a sentence the customer can read and the
-- candidate/job it relates to, so the answer is a list they can scan rather than
-- a number they have to trust.
--
-- Deliberately a log, not a source of truth. Balances stay in usage_counters and
-- purchased_credits; nothing reads this back to decide whether a credit is
-- available. That keeps a failure to log from ever blocking the work, and lets
-- the log be trimmed later without touching billing.

create table if not exists public.credit_spend_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- Which allowance was drawn down: applicant_screen | resume_screen | ai_rank |
  -- ai_insight | interview_questions. Free text rather than an enum so a new
  -- credit type does not need a migration before it can be logged.
  kind         text not null,
  quantity     int  not null default 1,
  -- 'monthly' or 'purchased', as reported by the consume function, so a customer
  -- can tell plan credits from ones they topped up.
  pool         text,
  -- The sentence shown in the UI, written at the call site where the context is
  -- known: "Screened Nurul Izzati for Drupal Developer", "Resume rejected: file
  -- could not be read".
  label        text not null,
  -- Optional extra line for the reason, when there is one worth showing.
  detail       text,
  candidate_id uuid references public.candidates(id) on delete set null,
  job_id       uuid references public.jobs(id) on delete set null,
  -- Who triggered it. Null for the public apply page, which has no signed-in user.
  actor_id     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists credit_spend_log_company_time
  on public.credit_spend_log (company_id, created_at desc);

alter table public.credit_spend_log enable row level security;

-- Readable by the workspace it belongs to. Interviewers do not see billing, so
-- this follows the same owner/admin rule the rest of billing uses.
drop policy if exists credit_spend_log_read on public.credit_spend_log;
create policy credit_spend_log_read on public.credit_spend_log
  for select using (company_id = public.current_company_id() and public.is_company_admin());

-- No insert policy: writes go through log_credit_spend() below, which is
-- SECURITY DEFINER. A client cannot forge or edit its own spend history.

-- ---------------------------------------------------------------------------
-- Record a spend
-- ---------------------------------------------------------------------------
-- Called right after a consume_* function succeeds, from whichever edge function
-- or client did the work, because that is the only place that knows what the
-- credit was for. Never raises: a logging failure must not fail the thing the
-- customer actually asked for.
create or replace function public.log_credit_spend(
  p_company   uuid,
  p_kind      text,
  p_label     text,
  p_quantity  int default 1,
  p_pool      text default null,
  p_detail    text default null,
  p_candidate uuid default null,
  p_job       uuid default null,
  p_actor     uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company is null or p_kind is null or p_label is null then return; end if;
  insert into public.credit_spend_log
    (company_id, kind, quantity, pool, label, detail, candidate_id, job_id, actor_id)
  values
    (p_company, p_kind, coalesce(p_quantity, 1), p_pool, p_label, p_detail, p_candidate, p_job, p_actor);
exception when others then
  -- Swallow. The work is already done and paid for; losing a log line is not
  -- worth failing an application submission or an AI run over.
  raise warning 'log_credit_spend failed: %', sqlerrm;
end $$;

revoke all on function public.log_credit_spend(uuid, text, text, int, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.log_credit_spend(uuid, text, text, int, text, text, uuid, uuid, uuid) to authenticated, service_role;

comment on table public.credit_spend_log is
  'One row per credit spent, with a readable label and the candidate/job it relates to. A log for the customer, never read back to decide whether a credit is available.';
