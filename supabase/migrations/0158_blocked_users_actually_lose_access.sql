-- ============================================================================
-- 0158: a blocked user can still sign in and use the workspace
-- ============================================================================
-- The admin console's Deactivate button writes profiles.status = 'suspended'
-- (admin_set_user_status, 0049) and remove_teammate does the same (0043). But
-- NOTHING reads that column: not one RLS policy, not current_company_id(), not
-- the app's session bootstrap. A "deactivated" person keeps full access to every
-- candidate, job and offer in the workspace. The button has only ever changed a
-- label.
--
-- current_company_id() is the fix point. Every tenant policy in the schema is
-- built on it, so returning NULL for a non-active profile removes access
-- everywhere at once rather than policy by policy.
--
-- 'invited' is treated as active on purpose. A profile row is only created when
-- an invite is ACCEPTED (0059 inserts it at acceptance), so an invited row
-- belongs to someone who has already joined; excluding it would lock out real
-- users. Only 'suspended' loses access, which is exactly what the button means.
--
-- NOTE ON 0041. A version of this sits commented out in 0041_security_hardening
-- and was deliberately left disabled. Read that comment before widening this:
-- the objection there was to the CHURN gate it bundled in (c.status <> 'churned'
-- would hard-lock a cancelled paying customer with no grace period and no data
-- export window), not to the per-user check. This migration takes only the
-- per-user part and touches nothing about companies, so that objection does not
-- apply. It also uses status <> 'suspended' rather than 0041's status = 'active',
-- which keeps 'invited' profiles working.
--
-- Idempotent: safe to re-run.

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles
   where id = auth.uid()
     and status <> 'suspended';
$$;

-- Unchanged grants, restated because the function was replaced.
grant execute on function public.current_company_id() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Audit the AI cost rates. Only this one function is touched here: it was
-- introduced in 0155, so its body is known exactly and replacing it is safe.
--
-- set_currency_rate, set_platform_flag, set_platform_email_template and the
-- booking-date functions still record nothing. Adding their audit calls means
-- re-emitting each body verbatim (Postgres has no "append a line" for a
-- function), and set_currency_rate in particular returns numeric and validates
-- its currency list, so a careless replacement would change its signature and
-- drop validation. Left for a migration that reproduces each one deliberately.
-- ---------------------------------------------------------------------------
create or replace function public.set_ai_unit_cost(p_kind text, p_cost_sen numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_cost_sen is null or p_cost_sen < 0 then raise exception 'cost must be zero or more'; end if;
  update public.ai_unit_costs
     set cost_sen = p_cost_sen, updated_at = now(), updated_by = auth.uid()
   where kind = p_kind;
  if not found then raise exception 'unknown AI action: %', p_kind; end if;
  perform public._admin_audit('Set AI unit cost', p_kind || ' = ' || p_cost_sen::text || ' sen');
end $$;
revoke all on function public.set_ai_unit_cost(text, numeric) from public, anon;
grant execute on function public.set_ai_unit_cost(text, numeric) to authenticated;
