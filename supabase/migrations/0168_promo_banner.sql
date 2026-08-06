-- ---------------------------------------------------------------------------
-- Which promo code the app advertises.
--
-- PROMO_CODE = "YEARLY10" was a constant in the customer app, so switching a
-- promotion off in Stripe left the trial banner cheerfully advertising a code
-- that fails at checkout. The banner now reads this table: promote a different
-- code and it follows, promote nothing and it disappears.
--
-- One row, enforced by a fixed primary key. A table with a single row is odd
-- until you consider the alternative: a settings blob nobody can put a check
-- constraint on.
--
-- The promotion codes themselves live in Stripe, which owns the discount, the
-- expiry, the redemption count and who may use them. Nothing here duplicates
-- that; this only says which of them we are shouting about.
--
-- Idempotent: safe to re-run. Seeds the code already live, so applying this
-- changes nothing on the site.
-- ---------------------------------------------------------------------------
create table if not exists public.promo_banner (
  id          boolean primary key default true check (id),
  code        text,
  headline    text not null default 'Extra 10% off yearly with',
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.promo_banner enable row level security;
-- World-readable: the banner shows on the trial screen and the pricing page,
-- and a promo code is an advertisement. There is nothing to protect.
drop policy if exists promo_banner_read on public.promo_banner;
create policy promo_banner_read on public.promo_banner for select using (true);

insert into public.promo_banner (id, code, headline, enabled)
values (true, 'YEARLY10', 'Extra 10% off yearly with', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Changing this changes what every visitor is told, immediately. Audited for
-- the same reason the feature flags are.
--
-- Deliberately does NOT verify the code exists in Stripe: this function has no
-- network. The admin screen checks that before calling, and promoting a code
-- that is off is a mistake worth being able to make and then correct, not one
-- worth a failed save.
-- ---------------------------------------------------------------------------
create or replace function public.set_promo_banner(p_code text, p_headline text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  -- Stripe codes are uppercase alphanumerics in practice; refusing anything
  -- else stops a stray space or a pasted URL becoming the advertised code.
  if v_code is not null and v_code !~ '^[A-Za-z0-9_-]{3,40}$' then
    raise exception 'that does not look like a promo code' using errcode = '22023';
  end if;

  update public.promo_banner
     set code = upper(v_code),
         headline = coalesce(nullif(btrim(p_headline), ''), headline),
         enabled = coalesce(p_enabled, enabled),
         updated_at = now(),
         updated_by = auth.uid()
   where id;

  perform public._admin_audit(
    'Set promo banner',
    coalesce(upper(v_code), 'none') || (case when coalesce(p_enabled, true) then '' else ' (hidden)' end)
  );
end $$;
revoke all on function public.set_promo_banner(text, text, boolean) from public, anon;
grant execute on function public.set_promo_banner(text, text, boolean) to authenticated;
