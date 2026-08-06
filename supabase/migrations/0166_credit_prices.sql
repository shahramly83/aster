-- ---------------------------------------------------------------------------
-- What we CHARGE for a top-up credit, in one place.
--
-- Until now this number lived twice, hardcoded, and the two copies had to be
-- kept in step by hand:
--   * CREDIT_USD in src/resume-ai-preview.jsx  — the price the buyer is shown
--   * BASE_USD in supabase/functions/buy-credits — the price Stripe charges
-- Whenever they drift, a customer is quoted one figure and billed another. This
-- table is the single source both read, exactly as currency_rates (0105)
-- already does for the exchange rate applied on top.
--
-- Not to be confused with ai_unit_costs (0155), which is what a model call
-- costs US and only feeds margin reporting. This one is revenue.
--
-- Stored in USD minor units because that is the base every other multiplier
-- hangs off: final price = price_usd_cents x currency rate x plan discount.
--
-- Idempotent: safe to re-run. Seeds today's live prices, so applying this
-- changes nothing until an admin edits a row.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_prices (
  kind             text primary key,
  price_usd_cents  integer not null check (price_usd_cents >= 0),
  label            text not null,
  updated_at       timestamptz not null default now(),
  -- No foreign key, for the same reason as ai_unit_costs: the editor is an
  -- Aster admin (admin_users), not a customer (profiles), and the audit log is
  -- the real record. A key here would only add ways for a save to fail.
  updated_by       uuid
);

alter table public.credit_prices enable row level security;
-- World-readable on purpose. The pricing page and the buy-credits modal quote
-- from it before anyone signs in, the same as currency_rates. There is nothing
-- private in a price list, and hiding it would only mean the app shows a stale
-- hardcoded number to signed-out visitors.
drop policy if exists credit_prices_read on public.credit_prices;
create policy credit_prices_read on public.credit_prices for select using (true);

insert into public.credit_prices (kind, price_usd_cents, label) values
  ('resume_screen',       100, 'Resume screening'),
  ('applicant_screen',    100, 'Applicant screening'),
  ('ai_rank',              40, 'AI Rank'),
  ('ai_insight',           40, 'AI Insight'),
  ('interview_questions',  40, 'AI Questions')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- Setting a price changes what real customers are charged on their next
-- top-up, with no deploy in between. Audited like the currency rate and the
-- feature flags, which are the other two switches with that property.
-- ---------------------------------------------------------------------------
create or replace function public.set_credit_price(p_kind text, p_cents integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_old integer;
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  -- Only the kinds that exist. An unknown key would insert a row the app never
  -- reads and quietly do nothing, which is worse than refusing.
  if not exists (select 1 from public.credit_prices where kind = p_kind) then
    raise exception 'unknown credit kind' using errcode = '22023';
  end if;
  if p_cents is null or p_cents < 0 then
    raise exception 'price must be zero or more' using errcode = '22023';
  end if;
  -- A ceiling, not a judgement about what it should be worth: it stops a
  -- fat-fingered extra zero from reaching Stripe. USD 1,000 per credit.
  if p_cents > 100000 then
    raise exception 'price looks wrong (over USD 1000 per credit)' using errcode = '22023';
  end if;

  select price_usd_cents into v_old from public.credit_prices where kind = p_kind;
  update public.credit_prices
     set price_usd_cents = p_cents, updated_at = now(), updated_by = auth.uid()
   where kind = p_kind;

  -- Both numbers in the entry: "set to $0.60" is only meaningful next to what
  -- it was before.
  perform public._admin_audit(
    'Set credit price',
    p_kind || ': $' || to_char(v_old / 100.0, 'FM999990.00') || ' → $' || to_char(p_cents / 100.0, 'FM999990.00')
  );
  return p_cents;
end $$;
revoke all on function public.set_credit_price(text, integer) from public, anon;
grant execute on function public.set_credit_price(text, integer) to authenticated;
