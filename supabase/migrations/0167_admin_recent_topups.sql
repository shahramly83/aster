-- ---------------------------------------------------------------------------
-- The top-ups behind the number.
--
-- admin_topup_revenue_totals (0166... 0164) answers "how much", and the overview
-- card showed exactly that: RM 29.40, one purchase, and no way to tell whose it
-- was without opening the database. A figure nobody can attribute is a figure
-- nobody trusts.
--
-- admin_credit_revenue (0162) is close but groups by company for one named
-- month, so it cannot say which credit was bought, or show a purchase from
-- earlier in the year next to this month's.
--
-- Newest first, capped by the caller. Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------
create or replace function public.admin_recent_topups(p_limit integer default 6)
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  kind text,
  quantity bigint,
  amount_cents bigint,
  currency text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select l.id,
           l.company_id,
           c.name,
           l.kind,
           coalesce(l.quantity, 0)::bigint,
           coalesce(l.amount_cents, 0)::bigint,
           lower(coalesce(l.currency, 'myr')),
           l.created_at
      from public.credit_purchase_log l
      join public.companies c on c.id = l.company_id
     order by l.created_at desc
     limit greatest(1, least(coalesce(p_limit, 6), 50));
end $$;
revoke all on function public.admin_recent_topups(integer) from public, anon;
grant execute on function public.admin_recent_topups(integer) to authenticated;
