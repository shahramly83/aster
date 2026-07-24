-- 0135_offer_company_signature.sql
-- Company sign-off on composed offer letters. Each user saves their signature
-- once (in Settings); it is snapshotted onto every offer they compose so the
-- letter is executed by the company before the candidate counter-signs.
--
--   profiles.offer_signature  — the user's saved signature. A PNG data URI for a
--                               drawn signature, or "typed:<Full Name>" for a
--                               script-font typed sign-off. Null = none saved.
--   offers.signatory_signature — the snapshot taken when the offer was sent, so
--                               later edits to the saved signature never alter an
--                               already-issued letter.

alter table public.profiles add column if not exists offer_signature text;
alter table public.offers   add column if not exists signatory_signature text;

-- Self-service setter (mirrors update_my_profile from 0044): a user can only ever
-- write their own signature.
create or replace function public.set_my_offer_signature(p_sig text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set offer_signature = p_sig where id = auth.uid();
end;
$$;

grant execute on function public.set_my_offer_signature(text) to authenticated;
