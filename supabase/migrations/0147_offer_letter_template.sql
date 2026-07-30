-- ============================================================================
-- 0147: a company's own offer letter, written once and reused
-- ============================================================================
-- The letter body was composed from a template hard-coded in the app, so every
-- company sent Aster's wording. A hiring manager could edit any single letter,
-- but the edit died with that offer: the next one started from Aster's text
-- again, and there was no way to say "this is how we word an offer".
--
-- companies.offer_letter_template holds that wording once. It is stored with
-- tokens, {{role}} {{company}} {{joining_date}} {{salary}} {{expiry_date}},
-- which the app fills per offer, so a saved letter still says the right salary
-- and dates for each candidate rather than freezing one offer's numbers.
--
-- Null means "use Aster's default", which is what every existing company gets,
-- so nothing changes until someone deliberately saves their own.

alter table public.companies add column if not exists offer_letter_template text;

comment on column public.companies.offer_letter_template is
  'The company''s own offer letter body, with {{role}} {{company}} {{joining_date}} {{salary}} {{expiry_date}} tokens filled per offer. Null uses the built-in default.';

-- ---------------------------------------------------------------------------
-- Save it
-- ---------------------------------------------------------------------------
-- Owner/admin only: this is the wording every future offer from this workspace
-- goes out with, which is not a hiring manager's call to make for everyone.
-- Passing null restores the built-in default.
create or replace function public.set_offer_letter_template(p_tpl text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_company_admin() then
    raise exception 'Only an owner or admin can change the offer letter template'
      using errcode = '42501';
  end if;
  update public.companies
     set offer_letter_template = nullif(btrim(coalesce(p_tpl, '')), '')
   where id = public.current_company_id();
end;
$$;

revoke all on function public.set_offer_letter_template(text) from public, anon;
grant execute on function public.set_offer_letter_template(text) to authenticated;
