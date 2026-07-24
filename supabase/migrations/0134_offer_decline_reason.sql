-- 0134_offer_decline_reason.sql
-- Capture the candidate's own words when they decline an offer on the public
-- /offer/<token> page. Optional free text, shown to the hiring team on the
-- candidate's Decision panel (web + mobile). Nullable so existing offers and
-- accepts are unaffected.

alter table public.offers
  add column if not exists decline_reason text;
