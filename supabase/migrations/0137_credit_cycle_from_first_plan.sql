-- ============================================================================
-- 0137: the 30-day credit cycle starts when the plan is PAID for, not at signup
-- ============================================================================
-- 0008 anchored the rolling 30-day AI-credit cycle on companies.created_at. That
-- is wrong in two places the customer actually looks at:
--
--   * On the 14-day trial the dashboard promised "Resets in 27d" — a refresh that
--     can never arrive, because the trial ends on day 14 and day 30 never comes.
--   * A workspace that lapses and resubscribes weeks later kept counting from the
--     original signup, so its first paid cycle could be two days long before the
--     credits it just paid for reset.
--
-- The anchor is now companies.credit_anchor_at: the moment the current paid plan
-- started. stripe-webhook stamps it on the first payment and again whenever a
-- suspended/churned workspace comes back (a late renewal starts a fresh 30 days).
--
-- Null means "never paid": trials keep the existing signup-based behaviour, and
-- every workspace already paying keeps its current cycle until its next
-- activation event. Nothing shifts under a live customer on deploy.

alter table public.companies add column if not exists credit_anchor_at timestamptz;

comment on column public.companies.credit_anchor_at is
  'Start of the rolling 30-day AI credit cycle: when the current paid plan began. Null until the first payment (trial), stamped by stripe-webhook.';

-- ---------------------------------------------------------------------------
-- The period helper resolves the anchor itself
-- ---------------------------------------------------------------------------
-- Roughly 28 metering RPCs (get_/bump_/consume_/refund_ per feature, across 0010
-- to 0126) all resolve their period the same way: read companies.created_at, pass
-- it to _ai_rank_period(). Re-anchoring at those call sites would mean re-issuing
-- every one of them, and any that got missed would key its counter to a different
-- period than the rest — split counters, and a credit spendable twice. Resolving
-- the anchor HERE keeps all of them consistent by construction, with one function
-- changed instead of twenty-eight.
--
-- Callers only hand us a timestamp, so the company is identified by its
-- created_at. That column defaults to now() at microsecond resolution, so it is
-- unique in practice; `order by c.id` keeps even a freak collision deterministic,
-- and the coalesce falls back to the old signup behaviour when no row matches.
--
-- security definer so the lookup behaves identically from a trial user's session,
-- from the anon apply page (get_public_job), and from service-role edge functions.
create or replace function public._ai_rank_period(p_created timestamptz)
returns table (period text, resets_at date)
language sql stable security definer set search_path = public as $$
  with a as (
    select coalesce(
             (select c.credit_anchor_at
                from public.companies c
               where c.created_at = p_created
                 and c.credit_anchor_at is not null
               order by c.id
               limit 1),
             p_created) as anchor
  ), c as (
    select (select anchor from a) as anchor,
           greatest(0, floor(extract(epoch from (now() - (select anchor from a))) / 86400 / 30))::int as idx
  )
  select to_char((select anchor from c) + ((select idx from c) * 30) * interval '1 day', 'YYYY-MM-DD'),
         ((select anchor from c) + (((select idx from c) + 1) * 30) * interval '1 day')::date;
$$;

-- Only the metering functions (all security definer, so they run as the owner)
-- need this. Nothing in the app calls it directly, and it now reads companies, so
-- keep it off the client roles — same rule as the helpers hardened in 0041.
revoke all on function public._ai_rank_period(timestamptz) from public, anon, authenticated;
