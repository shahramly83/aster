-- ============================================================================
-- 0106: activity_log — an authoritative event feed for the notification bell
-- ============================================================================
-- Every notable event is appended here as it happens (real timestamp), so the
-- bell reads a true log instead of reconstructing a summary from current state.
-- Company-scoped read; unread is derived from profiles.activities_seen_at. Writes
-- come from edge functions (service role) or the log_activity RPC (company-gated).
create table if not exists public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  type         text not null,          -- new_application | interview_requested | interview_scheduled | offer_sent | offer_signed | offer_declined | offer_expired | hired | scorecard | role_requested ...
  title        text not null,
  description  text,
  candidate_id uuid,
  job_id       uuid,
  actor_id     uuid,                     -- who triggered it (null for candidate/system events)
  created_at   timestamptz not null default now()
);
create index if not exists idx_activity_log_company on public.activity_log (company_id, created_at desc);

alter table public.activity_log enable row level security;
drop policy if exists activity_log_read on public.activity_log;
create policy activity_log_read on public.activity_log for select
  using (company_id = public.current_company_id());
-- No client insert policy: writes go through log_activity (definer) or service role.

grant select on public.activity_log to authenticated;

-- Company-gated logger for in-app actions (hired, offer sent, scorecard, ...).
create or replace function public.log_activity(
  p_type text, p_title text, p_description text default null,
  p_candidate_id uuid default null, p_job_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id(); v_id uuid;
begin
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.activity_log (company_id, type, title, description, candidate_id, job_id, actor_id)
    values (v_company, p_type, left(coalesce(p_title, ''), 200), left(p_description, 400), p_candidate_id, p_job_id, auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_activity(text, text, text, uuid, uuid) from public, anon;
grant execute on function public.log_activity(text, text, text, uuid, uuid) to authenticated;
