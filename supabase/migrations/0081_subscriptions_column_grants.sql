-- 0081_subscriptions_column_grants.sql
--
-- 0080 tried to hide the Stripe identifiers with a column-level REVOKE and did
-- nothing at all. A hiring manager could still read:
--
--   {"stripe_customer_id":"cus_...","plan":"elite","status":"active"}
--
-- Because `authenticated` holds SELECT on the whole TABLE, and a table-level grant
-- covers every column, present and future. Revoking a column from a role that has
-- the table is a no-op: the table grant still satisfies the check. The only way to
-- express "all columns except these" is to drop the table grant and hand back the
-- columns you do want.
--
-- Worth stating plainly because the 0080 migration APPLIED CLEANLY and changed
-- nothing. It looked like a fix. Only re-running the role suite showed it wasn't.

revoke select on public.subscriptions from authenticated, anon;

-- Grant back every column except the billing secrets. Enumerated from the catalog
-- rather than hand-listed, so a column added later is caught by the deny-list here
-- instead of being silently exposed by a stale list.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'subscriptions'
     and column_name not in ('stripe_customer_id', 'stripe_subscription_id', 'seats');

  execute format('grant select (%s) on public.subscriptions to authenticated', v_cols);
end $$;

-- The client reads only (status, cycle, current_period_end); the edge functions
-- read the ids as service_role, which is unaffected by any of this.
