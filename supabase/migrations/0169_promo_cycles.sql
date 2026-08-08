-- ---------------------------------------------------------------------------
-- Which checkout cycles offer a promo code box.
--
-- This was one hardcoded line in create-checkout-session, so changing it took a
-- deploy. It now lives beside the advertised code, on the same one-row settings
-- table, and is set from /admin.
--
-- Read carefully, because it is easy to expect more of this than it can give:
-- it decides WHERE the box appears, not which codes are valid. A Stripe coupon
-- restricts by PRODUCT, and Aster's monthly and yearly prices sit on the same
-- three products, so a coupon cannot tell the two cycles apart. A promotion
-- code's minimum_amount cannot either: Elite monthly (MYR 999) costs more than
-- Launch yearly (MYR 950). So "yearly" is enforced by monthly checkout having
-- nowhere to type a code. Genuinely yearly-only coupons would need yearly split
-- onto its own Stripe products, which is deliberately not done here.
--
-- Defaults to 'yearly', the rule that held before 2026-08-07, so applying this
-- closes the monthly gap the moment it lands, without an admin doing anything.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------
alter table public.promo_banner
  add column if not exists promo_cycles text not null default 'yearly';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promo_banner_promo_cycles_check'
  ) then
    alter table public.promo_banner
      add constraint promo_banner_promo_cycles_check
      check (promo_cycles in ('yearly', 'both', 'none'));
  end if;
end $$;

-- Existing row predates the column and takes the default; say so explicitly so
-- a re-run on a database where someone already chose 'both' does not reset it.
update public.promo_banner set promo_cycles = 'yearly' where promo_cycles is null;

-- ---------------------------------------------------------------------------
-- Superseded signature: the three-argument version stays callable so a client
-- deployed before this migration keeps working, and simply leaves the cycles
-- rule alone.
-- ---------------------------------------------------------------------------
create or replace function public.set_promo_banner(p_code text, p_headline text, p_enabled boolean, p_cycles text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  if v_code is not null and v_code !~ '^[A-Za-z0-9_-]{3,40}$' then
    raise exception 'that does not look like a promo code' using errcode = '22023';
  end if;
  if p_cycles is not null and p_cycles not in ('yearly', 'both', 'none') then
    raise exception 'unknown promo cycle setting' using errcode = '22023';
  end if;

  update public.promo_banner
     set code = upper(v_code),
         headline = coalesce(nullif(btrim(p_headline), ''), headline),
         enabled = coalesce(p_enabled, enabled),
         promo_cycles = coalesce(p_cycles, promo_cycles),
         updated_at = now(),
         updated_by = auth.uid()
   where id;

  perform public._admin_audit(
    'Set promo banner',
    coalesce(upper(v_code), 'none')
      || (case when coalesce(p_enabled, true) then '' else ' (hidden)' end)
      || (case when p_cycles is null then '' else ' · codes on ' || p_cycles end)
  );
end $$;
revoke all on function public.set_promo_banner(text, text, boolean, text) from public, anon;
grant execute on function public.set_promo_banner(text, text, boolean, text) to authenticated;
