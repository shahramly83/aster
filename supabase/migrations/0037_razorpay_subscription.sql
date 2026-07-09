-- ============================================================================
-- 0037: Razorpay subscription linkage
-- ============================================================================
-- Stores the Razorpay subscription + customer ids on the company's subscription
-- row so the webhook can reconcile events back to the workspace, and so a repeat
-- checkout reuses the same customer. Status/plan/current_period_end already
-- exist on the table and are updated by the razorpay-webhook edge function.

alter table public.subscriptions
  add column if not exists razorpay_subscription_id text,
  add column if not exists razorpay_customer_id     text;

create index if not exists subscriptions_rzp_sub_idx
  on public.subscriptions (razorpay_subscription_id);
