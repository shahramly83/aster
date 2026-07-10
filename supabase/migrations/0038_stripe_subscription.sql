-- ============================================================================
-- 0038: Stripe subscription linkage
-- ============================================================================
-- Stripe customer + subscription ids on the company's subscription row so the
-- webhook can reconcile events (and a repeat checkout reuses the same customer).
-- status / plan / current_period_end already exist and are updated by the
-- stripe-webhook edge function.

alter table public.subscriptions
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

create index if not exists subscriptions_stripe_sub_idx
  on public.subscriptions (stripe_subscription_id);
