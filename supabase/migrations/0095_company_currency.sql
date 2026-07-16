-- 0095_company_currency.sql
--
-- A workspace-level billing currency preference (RM default). Every subscription
-- checkout and one-off credit top-up bills in the currency the owner picks here,
-- and the pricing/billing screens display it by default. Stripe still cannot switch
-- a LIVE subscription's currency, so this governs FRESH subscriptions and credit
-- purchases; an existing subscription keeps the currency it was created with.
alter table public.companies
  add column if not exists preferred_currency text not null default 'myr'
    check (preferred_currency in ('usd','myr','sgd'));

-- Owner-only self-service update of the billing currency. Billing belongs to the
-- account owner alone (same rule as plan changes), so an admin or interviewer can't
-- change it. SECURITY DEFINER so it can write past RLS after the role check.
create or replace function public.set_company_currency(p_currency text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_role    profile_role;
  v_cur     text := lower(btrim(p_currency));
begin
  if v_company is null then
    raise exception 'no company for this session' using errcode = '42501';
  end if;
  if v_cur not in ('usd','myr','sgd') then
    raise exception 'unsupported currency' using errcode = '22023';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'owner' then
    raise exception 'only the account owner can change the billing currency' using errcode = '42501';
  end if;
  update public.companies set preferred_currency = v_cur where id = v_company;
end $$;

grant execute on function public.set_company_currency(text) to authenticated;
