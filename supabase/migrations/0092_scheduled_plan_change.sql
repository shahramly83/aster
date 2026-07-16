-- 0092_scheduled_plan_change.sql
--
-- Deferred downgrades. A downgrade (yearly -> monthly, or a tier drop) must NOT
-- take effect immediately: the customer keeps the plan they already paid for until
-- the current period ends, then a Stripe subscription schedule switches them to the
-- lower plan and bills it normally (a full new-cycle charge, no proration, no
-- credit). Upgrades stay immediate and leave these columns null.
--
-- These fields let the Billing page show "Changing to X on DATE" and offer a
-- "Cancel scheduled change". stripe_schedule_id is the server-only handle on the
-- Stripe subscription schedule, kept secret like the other stripe ids.
alter table public.subscriptions
  add column if not exists scheduled_plan      public.plan_tier,
  add column if not exists scheduled_cycle     text,
  add column if not exists scheduled_effective date,
  add column if not exists stripe_schedule_id  text;

-- Re-run the 0081 column grant so the three client-safe fields become readable by
-- the app, while stripe_schedule_id stays server-only alongside the other stripe
-- ids. Enumerated from the catalog so the deny-list is the single source of truth
-- (a column added later is denied by default, never silently exposed).
revoke select on public.subscriptions from authenticated, anon;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'subscriptions'
     and column_name not in ('stripe_customer_id', 'stripe_subscription_id', 'seats', 'stripe_schedule_id');

  execute format('grant select (%s) on public.subscriptions to authenticated', v_cols);
end $$;
