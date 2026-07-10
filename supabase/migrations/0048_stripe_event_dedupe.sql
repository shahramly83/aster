-- ============================================================================
-- 0048: Stripe webhook replay protection (B5 / S4)
-- ============================================================================
-- Two holes in stripe-webhook's verify():
--
--   1. `t` (the signed timestamp) is parsed out of the Stripe-Signature header
--      and then thrown away. Stripe's own libraries enforce a 300-second
--      tolerance precisely to stop replay. Without it, a captured
--      (body, signature) pair verifies forever.
--
--   2. No event-id dedupe. Stripe retries any non-2xx for up to 3 days -- which
--      is exactly what we want now that failed writes return 500 -- but a retry
--      of an event we already handled is indistinguishable from a fresh one.
--
-- Every write in the handler is an idempotent UPDATE to a fixed value, so a
-- replay cannot double-credit. What it CAN do is re-flip companies.status to
-- 'active' and clear deleted_at/purge_after, resurrecting a workspace that was
-- suspended for a lapsed trial or cancelled subscription. That is the real risk.
--
-- This table is the dedupe ledger. Service-role only: nothing in the app touches
-- it, so there are no policies and RLS simply denies everyone else.

create table if not exists public.stripe_events (
  id          text primary key,          -- Stripe's evt_… id
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Deliberately no policies: only the service_role client (which bypasses RLS)
-- may read or write this.

-- Stripe retries for up to 3 days, so anything older than that can never be a
-- duplicate worth guarding against. Keeps the table from growing forever.
create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at);

create or replace function public.prune_stripe_events()
returns int language sql security definer set search_path = public as $$
  with gone as (
    delete from public.stripe_events where received_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke all on function public.prune_stripe_events() from public, anon, authenticated;
grant execute on function public.prune_stripe_events() to service_role;
