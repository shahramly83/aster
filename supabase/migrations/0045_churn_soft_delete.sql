-- ============================================================================
-- 0045: cancelling a subscription actually revokes access (decision D1)
-- ============================================================================
-- stripe-webhook set companies.status = 'churned' on cancellation and nothing
-- else. But the tenancy layer keys off deleted_at, never status:
--
--   current_company_id():  where p.status = 'active' and c.deleted_at is null
--
-- companies.status is referenced by ZERO policies. So a customer could cancel and
-- keep full read/write access to their workspace, forever, for free. A lapsed
-- *trial* was locked out (suspend_expired_trials sets deleted_at); a lapsed
-- *paying customer* was not.
--
-- Chosen fix (D1): reuse the trial-lapse path rather than a hard lockout. The
-- webhook now stamps deleted_at + purge_after on churn, so a cancelled customer
-- lands on the paywall that already exists, keeps 30 days to resubscribe, and is
-- purged after. stripe-webhook already clears deleted_at/purge_after and sets
-- status='active' when a payment lands, so the way back is wired.
--
-- Timing note: for an ordinary "cancel at period end", Stripe fires
-- customer.subscription.deleted at PERIOD END, not at the click. The customer
-- keeps the access they paid for. Only an involuntary churn (final dunning
-- failure) locks them out immediately, which is the intended behaviour.
--
-- THIS MIGRATION IS THE OTHER HALF. Without it, stamping deleted_at on a
-- 'churned' company drops the user on DeletedWorkspaceScreen's *restorable*
-- branch, whose "Restore workspace" button calls restore_workspace() — which
-- refuses only 'suspended'. A cancelled customer would click one button and get
-- the workspace back for nothing. Exactly the hole 0039 closed for trials.

create or replace function public.restore_workspace()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_status  company_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select company_id into v_company
  from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can restore it' using errcode = '42501';
  end if;

  select status into v_status from public.companies where id = v_company;
  -- 'suspended' = trial lapsed. 'churned' = subscription cancelled. Neither is
  -- restorable by clicking a button; both are restored by paying, which the
  -- stripe-webhook does by clearing deleted_at.
  if v_status in ('suspended', 'churned') then
    raise exception 'subscribe to restore this workspace' using errcode = '42501';
  end if;

  update public.companies
     set deleted_at = null, purge_after = null
   where id = v_company and deleted_at is not null and purge_after > now();
  if not found then
    raise exception 'nothing to restore, or the restore window has passed' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.restore_workspace() from public, anon;
grant execute on function public.restore_workspace() to authenticated;
