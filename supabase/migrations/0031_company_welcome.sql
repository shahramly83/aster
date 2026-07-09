-- ============================================================================
-- Aster — welcome-email guard
-- ============================================================================
-- One nullable stamp so the "welcome to Aster" email (Tier 1, sent by the
-- send-welcome edge function when a new company is provisioned) goes out exactly
-- once, no matter which auth path created the company (password signup, email
-- confirmation, or SSO). The edge function sets it via the service role; there
-- is deliberately no customer write path to companies.
-- ============================================================================

alter table public.companies
  add column if not exists welcomed_at timestamptz;
