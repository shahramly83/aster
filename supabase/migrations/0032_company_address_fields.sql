-- ============================================================================
-- Aster — structured company billing address
-- ============================================================================
-- Upgrades the single freeform `address` column (0022) to standard, discrete
-- fields so the Profile → Billing details form round-trips exactly:
--   * address_street   — unit / building / street line
--   * address_city     — city / town
--   * address_state    — state / province / region
--   * address_postcode — postal / ZIP code
--   * address_country  — country
--
-- The legacy `address` column stays and becomes a SERVER-DERIVED, display-ready
-- block (street / "city, state postcode" / country) computed from the parts on
-- every write. That keeps invoices (BillingScreen) and the {{company_address}}
-- email placeholder working unchanged — they still read `address` verbatim.
--
-- Existing rows keep their freeform `address` until the owner next saves via the
-- new form, at which point the structured columns populate and `address` is
-- rewritten from them. The app parses the legacy string best-effort to pre-fill
-- the form in the meantime.
--
-- Writes still go through update_company_details() (SECURITY DEFINER, owner/admin
-- only). The old 4-arg signature is dropped and replaced with the 8-arg one, so
-- the RPC keeps touching ONLY branding + billing columns.
-- ============================================================================

alter table public.companies
  add column if not exists address_street   text,
  add column if not exists address_city     text,
  add column if not exists address_state    text,
  add column if not exists address_postcode text,
  add column if not exists address_country  text;

-- Old signature is superseded by the structured one below.
drop function if exists public.update_company_details(text, text, text, text);

-- ---------- owner/admin self-service update of branding + billing ----------
create or replace function public.update_company_details(
  p_name            text,
  p_street          text,
  p_city            text,
  p_state           text,
  p_postcode        text,
  p_country         text,
  p_registration_no text,
  p_logo_url        text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company    uuid := public.current_company_id();
  v_role       profile_role;
  v_street     text := nullif(btrim(p_street), '');
  v_city       text := nullif(btrim(p_city), '');
  v_state      text := nullif(btrim(p_state), '');
  v_postcode   text := nullif(btrim(p_postcode), '');
  v_country    text := nullif(btrim(p_country), '');
  v_city_state text;
  v_locality   text;
  v_address    text;
begin
  if v_company is null then
    raise exception 'no company for this session' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins can edit company details' using errcode = '42501';
  end if;

  -- Build the display-ready block, matching the client's serializeAddress():
  --   street
  --   city, state postcode
  --   country
  -- concat_ws skips NULLs; empties were already nullif'd above.
  v_city_state := nullif(concat_ws(', ', v_city, v_state), '');
  v_locality   := nullif(concat_ws(' ', v_city_state, v_postcode), '');
  v_address    := nullif(concat_ws(E'\n', v_street, v_locality, v_country), '');

  update public.companies
     set name             = coalesce(nullif(btrim(p_name), ''), name),
         address_street   = v_street,
         address_city     = v_city,
         address_state    = v_state,
         address_postcode = v_postcode,
         address_country  = v_country,
         address          = v_address,
         registration_no  = nullif(btrim(p_registration_no), ''),
         logo_url         = nullif(btrim(p_logo_url), '')
   where id = v_company;
end $$;

grant execute on function public.update_company_details(text, text, text, text, text, text, text, text) to authenticated;
