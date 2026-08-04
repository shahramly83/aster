-- ============================================================================
-- Aster — my_deletion_status says whether the workspace ever paid
-- ============================================================================
-- The mobile lapsed-workspace screen branched on companies.status alone, and
-- only 'churned' got subscription wording. Everything else fell through to
-- "your trial has finished".
--
-- That is fine for a lapsed trial, which is the only thing suspend_expired_trials
-- produces. It is wrong for admin_set_company_suspended (0049), which sets
-- status = 'suspended' on ANY company, paying or not. A customer eighteen months
-- into a subscription would have been told their trial had finished.
--
-- companies.status cannot tell the two apart: both are 'suspended'. The
-- distinguishing fact lives on subscriptions, and stripe_subscription_id is
-- revoked from clients (0080), so the answer has to be derived in here and
-- returned as a boolean rather than handing the id out.
--
-- Additive: existing callers that ignore the new column keep working unchanged.
-- ============================================================================

drop function if exists public.my_deletion_status();

create or replace function public.my_deletion_status()
returns table (
  company_id         uuid,
  company_name       text,
  status             company_status,
  deleted_at         timestamptz,
  purge_after        timestamptz,
  preferred_currency text,
  ever_paid          boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.status, c.deleted_at, c.purge_after,
         coalesce(c.preferred_currency, 'myr'),
         exists (
           select 1 from public.subscriptions s
           where s.company_id = c.id
             -- Went through Stripe checkout at least once. A trial is created
             -- locally and never carries a Stripe id, so this stays false for
             -- every workspace that only ever trialled.
             and (s.stripe_subscription_id is not null or s.status <> 'trialing')
         )
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid();
$$;

grant execute on function public.my_deletion_status() to authenticated;
