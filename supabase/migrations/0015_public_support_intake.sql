-- ============================================================================
-- Aster — public support intake (help.hireaster.com contact form)
-- ============================================================================
-- The public help center lets anyone file a support ticket without an account.
-- support_tickets keys tickets to a company via RLS, but a public submitter has
-- neither a company nor a profile, so we:
--   * give id a sequence-backed default so an insert needs no client-side id,
--   * add free-text requester_name / requester_email for account-less senders,
--   * expose ONE narrow SECURITY DEFINER door (submit_support_ticket) that anon
--     may call to file a company-less 'open' ticket and nothing else. It mirrors
--     submit_application: no reads leak back, no other table is touched.

-- Human-readable ids continue after the seeded 'T-1042'.
create sequence if not exists public.support_ticket_seq as bigint start with 1043;

alter table public.support_tickets
  alter column id set default 'T-' || nextval('public.support_ticket_seq');

alter table public.support_tickets add column if not exists requester_name  text;
alter table public.support_tickets add column if not exists requester_email text;

-- The id default advances the sequence as the inserting role. The public RPC
-- runs as its (bypassrls) owner, but grant both roles usage so a future signed-in
-- direct insert via the tickets_company policy also works. (0001's blanket grant
-- only covered sequences that existed then.)
grant usage, select on sequence public.support_ticket_seq to authenticated, anon;

create or replace function public.submit_support_ticket(
  p_name    text,
  p_email   text,
  p_subject text,
  p_body    text default null
) returns text                       -- the new ticket id, e.g. 'T-1043'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required' using errcode = '22023';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'a subject is required' using errcode = '22023';
  end if;
  if position('@' in p_email) = 0 then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;

  insert into public.support_tickets
    (company_id, subject, requester_id, requester_name, requester_email,
     channel, priority, status, body)
  values
    (null, left(trim(p_subject), 200), null, left(trim(p_name), 120), lower(trim(p_email)),
     'Help center', 'normal', 'open', nullif(trim(p_body), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_support_ticket(text, text, text, text) from public;
grant execute on function public.submit_support_ticket(text, text, text, text) to anon, authenticated;
