-- ============================================================================
-- 0173: ending a comp locks the workspace behind the paywall
-- ============================================================================
-- 0163 deliberately made withdrawing a comp a no-op on status: "it only removes
-- the protection, so the workspace goes back to being an ordinary trial and the
-- expiry job decides from there."
--
-- That reasoning has a hole. suspend_expired_trials only touches rows with
-- status = 'trial' and a trialing subscription already past its period end. A
-- comped workspace is typically status = 'active' on a granted plan with no
-- Stripe subscription at all, so nothing downstream ever evaluates it. Ending
-- the comp removed the note and left the free access running indefinitely,
-- which is the opposite of what "end comp" means to the person clicking it.
--
-- So withdrawing now suspends, but only when there is genuinely nothing else
-- entitling the workspace to be open:
--
--   * an active or past_due subscription  -> leave alone. They are paying. A
--     comp on top of a paid plan is a discount, not their entitlement, and
--     past_due is Stripe dunning, not a decision to stop paying.
--   * a trial that has not run out yet    -> leave alone. This is 0163's
--     original intent and it is right: they fall back to being an ordinary
--     trial and the expiry job takes it from there.
--   * anything else                       -> suspend.
--
-- The suspension is written in exactly the shape suspend_expired_trials uses
-- (status, deleted_at, purge_after) so the paywall the customer already sees
-- for a lapsed trial works here with no client change. That screen offers the
-- plan picker, which is the requirement: blocked, and must choose a plan.
--
-- NOTE this starts the same 30-day purge clock a lapsed trial starts. Nothing
-- is deleted on day one and subscribing clears it (stripe-webhook resets
-- deleted_at), but it is a real consequence and the admin console warns before
-- calling this.
--
-- Returns true when it suspended, so the console can say which of the two
-- things happened instead of guessing.
--
-- Idempotent: safe to re-run.

drop function if exists public.admin_set_comped(uuid, boolean, text);

create or replace function public.admin_set_comped(
  p_company uuid,
  p_comped  boolean,
  p_note    text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_plan text;
  v_status company_status;
  v_deleted timestamptz;
  v_paying boolean;
  v_live_trial boolean;
  v_suspended boolean := false;
begin
  if public.current_admin_role() not in ('super', 'billing') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select name, plan::text, status, deleted_at
    into v_name, v_plan, v_status, v_deleted
    from public.companies where id = p_company;
  if v_name is null then raise exception 'no such company' using errcode = 'P0002'; end if;

  update public.companies
     set comped_at   = case when p_comped then coalesce(comped_at, now()) else null end,
         comped_note = case when p_comped then nullif(btrim(p_note), '') else null end,
         comped_by   = case when p_comped then auth.uid() else null end
   where id = p_company;

  if not p_comped then
    -- Paying, in any form Stripe still considers open.
    select exists (
      select 1 from public.subscriptions s
       where s.company_id = p_company and s.status in ('active', 'past_due')
    ) into v_paying;

    -- A trial with time left on it. 0163's fallback, preserved.
    select exists (
      select 1 from public.subscriptions s
       where s.company_id = p_company
         and s.status = 'trialing'
         and s.current_period_end > current_date
    ) into v_live_trial;

    -- Already inside the soft-delete window: leave the existing clock alone
    -- rather than pushing the purge date out by another 30 days.
    if not v_paying and not v_live_trial and v_deleted is null then
      update public.companies
         set status      = 'suspended',
             deleted_at  = now(),
             purge_after = now() + interval '30 days'
       where id = p_company;
      v_suspended := true;
    end if;
  end if;

  perform public._admin_audit(
    case
      when p_comped then 'Comped workspace on ' || v_plan
      when v_suspended then 'Ended comp and suspended workspace'
      else 'Ended comp'
    end,
    v_name || coalesce(' (' || nullif(btrim(p_note), '') || ')', ''));

  return v_suspended;
end $$;

revoke all on function public.admin_set_comped(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_comped(uuid, boolean, text) to authenticated;

comment on function public.admin_set_comped(uuid, boolean, text) is
  'Grant or withdraw a free plan. Withdrawing suspends the workspace unless it is paying or still inside a live trial. Returns true when it suspended.';
