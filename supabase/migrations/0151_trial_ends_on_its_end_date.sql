-- ============================================================================
-- Aster — a 14-day trial lasts 14 days
-- ============================================================================
-- A trial is created with current_period_end = (now() + interval '14 days')::date,
-- so signing up on 21 July gives an end date of 4 August. suspend_expired_trials
-- then suspended only when
--
--     s.current_period_end < current_date
--
-- which keeps the workspace alive THROUGH 4 August: 21 July to 4 August inclusive
-- is fifteen days. Every trial has been running a day longer than advertised, and
-- the billing screen inherited the same off-by-one.
--
-- The end date is the day the trial ends, not the last day it works.
-- ============================================================================

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
      and c.status = 'trial'
      and c.deleted_at is null
      and s.status = 'trialing'
      and s.current_period_end <= current_date   -- was <, which granted a 15th day
    returning c.id
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;
