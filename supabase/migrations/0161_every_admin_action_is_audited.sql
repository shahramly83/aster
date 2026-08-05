-- ============================================================================
-- 0161: the audit log finally covers every administrative action
-- ============================================================================
-- The Audit logs screen says "every administrative action". Until now that was
-- true of three: admin_set_company_status, admin_set_user_status and
-- admin_change_plan, which call _admin_audit (0049). Everything else wrote
-- nothing. Changing a currency rate, flipping a feature flag in production,
-- rewriting a customer-facing email or blocking a booking date all left no
-- trace: the console showed a local echo that vanished on the next refresh.
--
-- Postgres has no "append a line" for a function, so each body below is
-- REPRODUCED VERBATIM from the migration that introduced it, with one
-- `perform public._admin_audit(...)` added before the end. Sources:
--   set_currency_rate            0105_currency_rates.sql
--   set_platform_flag            (platform flags)
--   set_platform_email_template  (email templates)
--   add/remove_booking_blocked_date  0065 booking dates
-- Signatures, return types, error codes and permission checks are unchanged.
-- set_currency_rate returns numeric and validates its currency list; both are
-- preserved exactly, because getting either wrong breaks credit pricing.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Currency rates. Returns numeric, so the audit call goes before the return.
-- ---------------------------------------------------------------------------
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
  perform public._admin_audit('Set currency rate', upper(p_currency) || ' = ' || p_rate::text);
  return p_rate;
end $$;
revoke all on function public.set_currency_rate(text, numeric) from public, anon;
grant execute on function public.set_currency_rate(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Feature flags. These take effect in the customer app immediately, which makes
-- them the single most important thing here to have a record of.
-- ---------------------------------------------------------------------------
create or replace function public.set_platform_flag(p_key text, p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  insert into public.platform_flags (key, enabled, updated_at)
    values (p_key, p_enabled, now())
    on conflict (key) do update set enabled = excluded.enabled, updated_at = now();
  perform public._admin_audit(
    case when p_enabled then 'Enabled feature flag' else 'Disabled feature flag' end, p_key);
  return p_enabled;
end $$;
revoke all on function public.set_platform_flag(text, boolean) from public, anon;
grant execute on function public.set_platform_flag(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform email templates. Editing one changes what every customer receives.
-- ---------------------------------------------------------------------------
create or replace function public.set_platform_email_template(
  p_key text, p_subject text, p_body text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_admin_role() not in ('super','support') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.email_templates (scope, company_id, key, subject, body, updated_by, updated_at)
    values ('platform', null, p_key, p_subject, p_body, auth.uid(), now())
  on conflict (key) where scope = 'platform'
    do update set subject = excluded.subject, body = excluded.body,
                  updated_by = auth.uid(), updated_at = now();
  perform public._admin_audit('Edited platform email template', p_key);
end $$;
revoke all on function public.set_platform_email_template(text, text, text) from public, anon;
grant execute on function public.set_platform_email_template(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Booking dates. These change what the public site offers, so they belong in
-- the record too.
-- ---------------------------------------------------------------------------
create or replace function public.add_booking_blocked_date(p_day date, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  insert into public.booking_blocked_dates (day, reason, updated_at)
    values (p_day, nullif(btrim(p_reason), ''), now())
    on conflict (day) do update set reason = excluded.reason, updated_at = now();
  perform public._admin_audit('Blocked booking date',
    to_char(p_day, 'DD Mon YYYY') || coalesce(' (' || nullif(btrim(p_reason), '') || ')', ''));
end $$;

create or replace function public.remove_booking_blocked_date(p_day date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  delete from public.booking_blocked_dates where day = p_day;
  perform public._admin_audit('Unblocked booking date', to_char(p_day, 'DD Mon YYYY'));
end $$;

revoke all on function public.add_booking_blocked_date(date, text) from public, anon;
revoke all on function public.remove_booking_blocked_date(date) from public, anon;
grant execute on function public.add_booking_blocked_date(date, text) to authenticated;
grant execute on function public.remove_booking_blocked_date(date) to authenticated;
