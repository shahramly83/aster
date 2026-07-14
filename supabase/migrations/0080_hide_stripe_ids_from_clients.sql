-- 0080_hide_stripe_ids_from_clients.sql
--
-- Fix: a hiring manager could read the company's Stripe identifiers out of the
-- database, straight past the billing functions that had just been locked down.
--
-- 0051 narrowed subs_customer_select to owner+admin, which keeps interviewers out.
-- But a hiring manager IS 'admin', so a plain PostgREST select returned:
--
--   {"stripe_customer_id":"cus_...","plan":"elite","status":"active"}
--
-- We have just made billing owner-only in create-checkout-session,
-- create-portal-session and list-invoices. Leaving the identifiers readable in the
-- table underneath makes that a front-door lock on an open window.
--
-- Do NOT drop the row from them: a hiring manager still needs status, cycle and
-- current_period_end for the trial countdown and the past-due banner. What they
-- have no use for is the Stripe ids, and neither does any other client. Nothing in
-- the app selects them: the client reads only (status, cycle, current_period_end),
-- and the edge functions read the ids as service_role, which column grants do not
-- restrict.
--
-- So revoke the columns rather than the row. RLS decides WHICH rows you see;
-- column privileges decide WHICH FIELDS, and PostgREST enforces both.

revoke select (stripe_customer_id, stripe_subscription_id)
  on public.subscriptions from authenticated, anon;

-- seats is an add-on count nobody outside billing needs either (0078).
revoke select (seats) on public.subscriptions from authenticated, anon;
