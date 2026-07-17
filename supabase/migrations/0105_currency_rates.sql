-- ============================================================================
-- 0105: editable currency rates (drives credit top-up prices from /admin)
-- ============================================================================
-- Credit top-ups are priced from a fixed USD base per credit, multiplied by the
-- currency's rate (USD = 1). An Aster admin sets the MYR/SGD rate in /admin, so
-- pricing tracks FX without a deploy. Public read (the app + buy-credits use it);
-- writes only through set_currency_rate (admin-gated), mirroring set_platform_flag.
create table if not exists public.currency_rates (
  currency   text primary key,        -- 'usd' | 'myr' | 'sgd'
  rate       numeric not null,        -- multiplier vs the USD base price (usd = 1)
  updated_at timestamptz not null default now()
);

alter table public.currency_rates enable row level security;
drop policy if exists currency_rates_read on public.currency_rates;
create policy currency_rates_read on public.currency_rates for select using (true);

insert into public.currency_rates (currency, rate) values
  ('usd', 1), ('myr', 4.09), ('sgd', 1.29)
on conflict (currency) do nothing;

-- Admin-only rate setter. Rejects anyone who isn't an active admin_users row.
create or replace function public.set_currency_rate(p_currency text, p_rate numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  if lower(p_currency) not in ('usd', 'myr', 'sgd') then
    raise exception 'unknown currency' using errcode = '22023';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'rate must be positive' using errcode = '22023';
  end if;
  insert into public.currency_rates (currency, rate, updated_at)
    values (lower(p_currency), p_rate, now())
    on conflict (currency) do update set rate = excluded.rate, updated_at = now();
  return p_rate;
end $$;
revoke all on function public.set_currency_rate(text, numeric) from public, anon;
grant execute on function public.set_currency_rate(text, numeric) to authenticated;
