-- ---------------------------------------------------------------------------
-- Credit top-up takings for the admin overview, bucketed today / this month /
-- this year.
--
-- admin_credit_revenue (0162) already answers "one named month" and drives the
-- billing table. It cannot express a day or a year, which is the reason this
-- exists rather than another p_period argument.
--
-- Buckets are Asia/Kuala_Lumpur. Local midnight is 16:00 UTC the day before, so
-- a UTC "today" would file a whole Malaysian morning under yesterday, which is
-- exactly the figure someone opens this page to check.
--
-- Returned per currency and never converted: a rate picked today would restate
-- takings from ten months ago.
--
-- Total revenue on the same screen comes from Stripe (admin-revenue), because
-- subscriptions leave no row behind here. This function is deliberately only
-- the top-ups, so the two tiles do not quietly double-count each other.
-- ---------------------------------------------------------------------------
create or replace function public.admin_topup_revenue_totals()
returns table (
  bucket text,
  currency text,
  amount_cents bigint,
  purchases bigint
) language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with p as (
    select lower(coalesce(l.currency, 'myr'))                     as cur,
           coalesce(l.amount_cents, 0)::bigint                    as cents,
           (l.created_at at time zone 'Asia/Kuala_Lumpur')::date  as d
      from public.credit_purchase_log l
  )
  select 'today'::text, p.cur, sum(p.cents)::bigint, count(*)::bigint
    from p where p.d = v_today
   group by p.cur
  union all
  select 'month'::text, p.cur, sum(p.cents)::bigint, count(*)::bigint
    from p where date_trunc('month', p.d) = date_trunc('month', v_today)
   group by p.cur
  union all
  select 'year'::text, p.cur, sum(p.cents)::bigint, count(*)::bigint
    from p where date_trunc('year', p.d) = date_trunc('year', v_today)
   group by p.cur;
end $$;
revoke all on function public.admin_topup_revenue_totals() from public, anon;
grant execute on function public.admin_topup_revenue_totals() to authenticated;
