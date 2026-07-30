-- ============================================================================
-- 0145: a job title beside the saved signature, and a way to list who has one
-- ============================================================================
-- Two gaps behind "what if the signature is the CEO, not the hiring manager?".
--
-- First, a signature block needs a designation. The letter model already carries
-- signatory_title (offer-letter.ts reads it), and the offer row already stores
-- it, but nothing ever filled it: the composer's name came from profiles and the
-- title came from nowhere, so every letter ended "Tara Jacklyn / Lazy Sdn Bhd"
-- with no indication of the authority signing it. profiles.offer_signature_title
-- is where a person records theirs, once, next to their signature.
--
-- Second, the offer screen needs to offer a choice of signatory. That means
-- reading other people's saved signature, which the profiles RLS policy rightly
-- does not allow in general, so it goes through a SECURITY DEFINER function
-- scoped to the caller's own company and to the three fields a letter needs.
--
-- Deliberately NOT here: any way to record a signature on someone else's behalf.
-- If the CEO must sign, they sign, and Shah's rule is that those offers go out
-- on the company's own letterhead through upload mode instead. A signatory can
-- only ever be someone who drew their own signature in Aster.

alter table public.profiles add column if not exists offer_signature_title text;

comment on column public.profiles.offer_signature_title is
  'Job title printed under this person''s signature on offer letters they sign off ("Chief Executive Officer"). Set by the person themselves alongside offer_signature.';

-- ---------------------------------------------------------------------------
-- Save my own signature and title together
-- ---------------------------------------------------------------------------
-- A separate name from set_my_offer_signature(text) rather than an overload with
-- a default: an overload would make set_my_offer_signature(text) ambiguous, and
-- the mobile app still calls the one-argument version.
create or replace function public.set_my_offer_signatory(p_sig text, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set offer_signature = p_sig,
         offer_signature_title = nullif(btrim(coalesce(p_title, '')), '')
   where id = auth.uid();
end;
$$;

revoke all on function public.set_my_offer_signatory(text, text) from public, anon;
grant execute on function public.set_my_offer_signatory(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who in my company can sign off an offer letter
-- ---------------------------------------------------------------------------
-- Only people who have actually drawn a signature. Returns the three fields the
-- letter needs and nothing else, so this is not a backdoor onto profiles.
create or replace function public.list_offer_signatories()
returns table (id uuid, name text, title text, signature text)
language sql
security definer
set search_path = public
as $$
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), p.email) as name,
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
