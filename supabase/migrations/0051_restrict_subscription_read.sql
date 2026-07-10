-- 0051_restrict_subscription_read.sql
--
-- RBAC: hide billing/plan details from interviewers.
--
-- Until now any company member could SELECT the workspace's subscription row
-- (`subs_customer_select` USING company_id = current_company_id()), so an
-- interviewer could read the plan tier, seat count, and renewal date even though
-- they have no billing role. Confirmed live: an interviewer session read
-- `{plan: scale, status: trialing, seats: 3}`.
--
-- Tighten the customer read to owner/admin only. `is_company_admin()` is true for
-- both owner and admin; interviewers are excluded. Admin staff policies
-- (`subs_admin_select`/`subs_admin_update`) are unchanged. This complements the
-- UI change that hides the Billing screen from interviewers.

drop policy if exists subs_customer_select on public.subscriptions;
create policy subs_customer_select on public.subscriptions
  for select using (
    company_id = public.current_company_id()
    and public.is_company_admin()
  );
