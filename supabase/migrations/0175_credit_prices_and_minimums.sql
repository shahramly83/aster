-- ============================================================================
-- Aster — new credit prices, and a minimum top-up per kind
-- ============================================================================
-- Two changes, both set by Shah on 2026-08-04.
--
-- 1. New prices. The targets were given in ringgit, but a price is stored once
--    as USD cents and every other currency is derived from it:
--
--        unit_minor = max(1, round(price_usd_cents * rate * plan_discount))
--
--    At the current MYR rate of 4.09 there is no whole number of US cents that
--    lands exactly on RM 2.85 or RM 0.40, so those two round DOWN: we would
--    rather charge a few sen under the quoted number than a sen over it.
--
--      kind                  cents    USD     MYR      SGD      target
--      resume_screen           69    $0.69   RM 2.82  S$0.89   RM 2.85 (-3 sen)
--      applicant_screen        69    $0.69   RM 2.82  S$0.89   RM 2.85 (-3 sen)
--      ai_rank                 60    $0.60   RM 2.45  S$0.77   RM 2.45 exact
--      ai_insight              60    $0.60   RM 2.45  S$0.77   matches AI Rank
--      interview_questions      9    $0.09   RM 0.37  S$0.12   RM 0.40 (-3 sen)
--      job_draft               55    $0.55   RM 2.25  S$0.71   RM 2.25 exact
--
--    job_draft was never seeded into this table (0166 predates 0170), so
--    buy-credits has been falling back to its hardcoded 50 cents. It gets a real
--    row here, which is also what makes it editable in /admin like the rest.
--
-- 2. A minimum top-up per kind, stored beside the price so an admin changes both
--    in the same place with no deploy. A one-credit purchase costs more in
--    Stripe fees and support than it earns.
--
-- Idempotent, and it deliberately OVERWRITES existing prices: unlike 0166's
-- seed, the whole point of this migration is to change them.
-- ============================================================================

alter table public.credit_prices
  add column if not exists min_qty integer not null default 10 check (min_qty >= 1);

comment on column public.credit_prices.min_qty is
  'Smallest number of credits that can be bought of this kind in one top-up.';

-- Prices and minimums together, so a half-applied migration cannot leave a kind
-- priced but unbounded.
insert into public.credit_prices (kind, price_usd_cents, label, min_qty) values
  ('resume_screen',       69, 'Resume screening',   10),
  ('applicant_screen',    69, 'Applicant screening', 10),
  ('ai_rank',             60, 'AI Rank',            10),
  ('ai_insight',          60, 'AI Insight',         10),
  ('interview_questions',  9, 'AI Questions',       50),
  ('job_draft',           55, 'Job draft',          10)
on conflict (kind) do update
  set price_usd_cents = excluded.price_usd_cents,
      min_qty         = excluded.min_qty,
      updated_at      = now();


-- The admin setter, so a minimum can be changed from the console like a price.
-- Same shape and same guards as set_credit_price.
create or replace function public.set_credit_min_qty(p_kind text, p_min integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_old integer;
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.credit_prices where kind = p_kind) then
    raise exception 'unknown credit kind' using errcode = '22023';
  end if;
  if p_min is null or p_min < 1 then
    raise exception 'minimum must be at least 1' using errcode = '22023';
  end if;
  -- buy-credits refuses anything over 10,000 in one go, so a minimum above that
  -- would make the kind impossible to buy at all.
  if p_min > 10000 then
    raise exception 'minimum cannot exceed the 10,000 per-order cap' using errcode = '22023';
  end if;

  select min_qty into v_old from public.credit_prices where kind = p_kind;
  update public.credit_prices
     set min_qty = p_min, updated_at = now(), updated_by = auth.uid()
   where kind = p_kind;

  perform public._admin_audit(
    'Set credit minimum',
    p_kind || ': ' || v_old || ' → ' || p_min || ' credits'
  );
  return p_min;
end $$;
revoke all on function public.set_credit_min_qty(text, integer) from public, anon;
grant execute on function public.set_credit_min_qty(text, integer) to authenticated;
