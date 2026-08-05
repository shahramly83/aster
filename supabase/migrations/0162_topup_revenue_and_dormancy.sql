-- ============================================================================
-- 0162: credit top-ups are revenue, and a workspace can go quiet
-- ============================================================================
-- Two blind spots in the console's commercial picture.
--
-- 1. MRR counts subscriptions only. When a workspace runs out of monthly
--    credits and buys a top-up, that is real money (credit_purchase_log has the
--    amount and currency Stripe charged) and the console ignores it entirely.
--    So a workspace can look marginal on plan revenue while actually paying
--    well, and the margin view understates what it is worth.
--
-- 2. Nothing surfaces a workspace that has stopped showing up. profiles
--    .last_active_at only started recording in 0157, so this will be thin at
--    first and fill in as people sign in. Reported as a raw timestamp rather
--    than a "dormant" verdict, so the UI decides what counts as quiet.
--
-- credit_purchase_log is revoked from authenticated and RLS-enabled, so the
-- admin cannot read it directly. Both of these go through is_admin()-gated
-- RPCs, and neither returns a candidate row.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Top-up revenue for one month, per company AND per currency. Amounts are NOT
-- converted: they are returned in the currency Stripe actually charged, so the
-- caller can sum its own base and show the rest separately rather than have a
-- conversion silently baked in at whatever today's rate happens to be.
--
-- p_period is 'YYYY-MM'; null means the current month.
-- ---------------------------------------------------------------------------
create or replace function public.admin_credit_revenue(p_period text default null)
returns table (
  company_id uuid,
  company_name text,
  currency text,
  amount_cents bigint,
  credits bigint,
  purchases bigint,
  period text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, to_char(now(), 'YYYY-MM'));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select l.company_id,
           c.name,
           lower(coalesce(l.currency, 'myr')),
           sum(coalesce(l.amount_cents, 0))::bigint,
           sum(l.quantity)::bigint,
           count(*)::bigint,
           v_period
      from public.credit_purchase_log l
      join public.companies c on c.id = l.company_id
     where to_char(l.created_at, 'YYYY-MM') = v_period
     group by l.company_id, c.name, lower(coalesce(l.currency, 'myr'))
     order by 4 desc;
end $$;
revoke all on function public.admin_credit_revenue(text) from public, anon;
grant execute on function public.admin_credit_revenue(text) to authenticated;

-- ---------------------------------------------------------------------------
-- When each workspace was last touched by anyone on its team, and how many of
-- its people have ever been seen. Counts and timestamps only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_workspace_activity()
returns table (
  company_id uuid,
  company_name text,
  status company_status,
  last_active_at timestamptz,
  seats bigint,
  seen_seats bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.status,
           max(p.last_active_at),
           count(p.id)::bigint,
           count(p.last_active_at)::bigint
      from public.companies c
      left join public.profiles p on p.company_id = c.id
     group by c.id, c.name, c.status
     order by max(p.last_active_at) asc nulls first;
end $$;
revoke all on function public.admin_workspace_activity() from public, anon;
grant execute on function public.admin_workspace_activity() to authenticated;
