-- ============================================================================
-- 0146: the name printed under the signature, editable, beside the job title
-- ============================================================================
-- 0145 gave a signature a job title. The name was still taken from
-- profiles.full_name, which is the account name and not always the name someone
-- signs letters with: a legal name against a preferred one, an initial, a name
-- with an honorific. Making the letter borrow the account name also meant you
-- could not fix the sign-off without renaming the account itself.
--
-- offer_signature_name holds the letter name. Null falls back to full_name, so
-- nothing changes for anyone who does not set it.

alter table public.profiles add column if not exists offer_signature_name text;

comment on column public.profiles.offer_signature_name is
  'Name printed under this person''s signature on offer letters. Null means use profiles.full_name. Set by the person themselves alongside offer_signature.';

-- ---------------------------------------------------------------------------
-- Save signature, name and title together
-- ---------------------------------------------------------------------------
-- Replaces the two-argument 0145 version rather than overloading it: two
-- functions of the same name taking (text, text) and (text, text, text) both
-- resolve for some PostgREST payloads, and the ambiguity is not worth keeping a
-- one-release-old signature alive for.
drop function if exists public.set_my_offer_signatory(text, text);

create or replace function public.set_my_offer_signatory(p_sig text, p_name text, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set offer_signature       = p_sig,
         offer_signature_name  = nullif(btrim(coalesce(p_name, '')), ''),
         offer_signature_title = nullif(btrim(coalesce(p_title, '')), '')
   where id = auth.uid();
end;
$$;

revoke all on function public.set_my_offer_signatory(text, text, text) from public, anon;
grant execute on function public.set_my_offer_signatory(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who can sign off an offer letter, now preferring the letter name
-- ---------------------------------------------------------------------------
create or replace function public.list_offer_signatories()
returns table (id uuid, name text, title text, signature text)
language sql
security definer
set search_path = public
as $$
  select p.id,
         coalesce(
           nullif(btrim(coalesce(p.offer_signature_name, '')), ''),
           nullif(btrim(coalesce(p.full_name, '')), ''),
           p.email
         ) as name,
         p.offer_signature_title as title,
         p.offer_signature as signature
    from public.profiles p
   where p.company_id = public.current_company_id()
     and p.offer_signature is not null
     and btrim(p.offer_signature) <> ''
   order by (p.id = auth.uid()) desc, 2;
$$;

revoke all on function public.list_offer_signatories() from public, anon;
grant execute on function public.list_offer_signatories() to authenticated;
