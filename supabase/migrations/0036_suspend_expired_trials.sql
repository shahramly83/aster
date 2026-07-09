-- ============================================================================
-- 0036: Suspend + soft-delete accounts whose trial ended without subscribing
-- ============================================================================
-- The 14-day trial (subscriptions.status='trialing', current_period_end 14 days
-- out) grants Scale access. If the trial ends and the company hasn't subscribed
-- (still 'trialing', not 'active'), the account is suspended and enters the
-- 30-day soft-delete window (deleted_at + purge_after) — the same window used by
-- request_workspace_deletion — after which purge-workspaces removes it for good.
-- There is no free-tier fallback. Run daily by the purge-workspaces cron (service
-- role); not exposed to app users. Idempotent: only touches live trial rows.

create or replace function public.suspend_expired_trials()
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with expired as (
    update public.companies c
    set status      = 'suspended',
        deleted_at  = now(),
        purge_after = now() + interval '30 days'
    from public.subscriptions s
    where s.company_id = c.id
      and c.status = 'trial'                 -- not already active/suspended
      and c.deleted_at is null               -- not already soft-deleted
      and s.status = 'trialing'              -- never converted to a paid sub
      and s.current_period_end < current_date -- the 14-day trial has elapsed
    returning c.id
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

revoke all on function public.suspend_expired_trials() from public, anon, authenticated;
