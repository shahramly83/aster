-- ============================================================================
-- Aster — interview booking (public candidate slot picker)
-- ============================================================================
-- Turns interview scheduling into a real, persisted flow. When HR sends an
-- invite the app inserts an interviews row carrying the proposed slots + a
-- public token; the candidate opens /book/<token> (no login), previews it via
-- book_interview_preview, and confirms a slot. Confirmation + the resulting
-- emails run in the confirm-booking edge function (service role), so the public
-- page never touches the interviews table directly.
--
-- interviewer_id stays a profiles FK but is usually null here: the scheduling UI
-- picks interviewers from a client-side roster that aren't necessarily profiles,
-- so the interviewer's name/email are denormalised to still notify them.
-- ============================================================================

alter table public.interviews
  add column if not exists token             uuid not null default gen_random_uuid(),
  add column if not exists proposed_slots    jsonb not null default '[]',
  add column if not exists interviewer_name  text,
  add column if not exists interviewer_email text;

create unique index if not exists uq_interviews_token on public.interviews (token);

-- Public preview of a pending interview invite, so /book/<token> can render the
-- proposed times without a login. Reveals only what the token holder (the
-- invited candidate) needs; no candidate PII. SECURITY DEFINER because
-- interviews is company-only under RLS. Zero rows for an unknown token.
create or replace function public.book_interview_preview(p_token uuid)
returns table (
  company_name text, logo_url text, job_title text, interviewer_name text,
  proposed_slots jsonb, status text, scheduled_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, j.title, i.interviewer_name,
         i.proposed_slots, i.status, i.scheduled_at
  from public.interviews i
  join public.companies c on c.id = i.company_id
  left join public.jobs j on j.id = i.job_id
  where i.token = p_token;
$$;

revoke all on function public.book_interview_preview(uuid) from public;
grant execute on function public.book_interview_preview(uuid) to anon, authenticated;
