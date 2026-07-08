-- ============================================================================
-- Aster — spam honeypot on the public support intake
-- ============================================================================
-- submit_support_ticket is anon-callable, so it will get hit by bots. Add a
-- honeypot: a hidden 'website' field that a real human never sees and never
-- fills. Bots that autofill every field trip it; when they do we silently drop
-- the submission and return a throwaway id, so the bot believes it succeeded
-- and does not retry. Legitimate submissions (empty honeypot) are unaffected.
--
-- The parameter list changes, so drop the old signature before recreating.

drop function if exists public.submit_support_ticket(text, text, text, text);

create or replace function public.submit_support_ticket(
  p_name    text,
  p_email   text,
  p_subject text,
  p_body    text default null,
  p_website text default null           -- honeypot: real forms leave this empty
) returns text                          -- the new ticket id, e.g. 'T-1043'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  -- Honeypot tripped: pretend it worked, insert nothing.
  if coalesce(trim(p_website), '') <> '' then
    return 'T-0';
  end if;

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

revoke all on function public.submit_support_ticket(text, text, text, text, text) from public;
grant execute on function public.submit_support_ticket(text, text, text, text, text) to anon, authenticated;
