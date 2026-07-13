-- ============================================================================
-- 0071: job posting is a concurrent OPEN-role limit, not a per-cycle credit
-- ============================================================================
-- Product decision update: the plan's job allowance (launch 1, scale 5, elite 10,
-- enterprise unlimited) is the number of roles a workspace may have OPEN at once,
-- not the number it may post per 30-day cycle. Closing a role frees a slot;
-- reopening one takes a slot again. There is no monthly reset for jobs. (AI Rank,
-- resume parses and AI Insights stay as monthly credits, unchanged.)
--
-- 0047 enforced the stricter `greatest(posted_this_cycle, open_now) >= limit` and
-- skipped the check for an already-charged row, so a reopen never counted. Replace
-- the trigger so it enforces the live open-role count only, and re-checks on every
-- publish/reopen. usage_counters.jobs_posted and jobs.post_charged are left in
-- place (harmless) but no longer gate anything.

create or replace function public.charge_job_post()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit int;
  v_live  int;
begin
  -- Only an open (published) role takes a slot. Drafts and closed roles are free.
  if new.status <> 'open' then return new; end if;
  -- Already open and staying open (a title/description edit): no slot change.
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if;

  v_limit := public._job_post_limit((select plan from public.companies where id = new.company_id));
  if v_limit is null then return new; end if;  -- enterprise / unlimited

  -- Serialise concurrent publishes for this company so two tabs can't both slip
  -- past the cap (replaces the old FOR UPDATE lock on the cycle counter).
  perform pg_advisory_xact_lock(hashtext('job_post:' || new.company_id::text));

  select count(*)::int into v_live
  from public.jobs
  where company_id = new.company_id and status = 'open' and id <> new.id;

  if v_live >= v_limit then
    raise exception 'open role limit reached'
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;

  -- Keep the historical counter/flag current (analytics only; not enforced).
  new.post_charged := true;
  return new;
end $$;

-- Same trigger wiring as 0047 (before insert / update of status).
drop trigger if exists trg_charge_job_post on public.jobs;
create trigger trg_charge_job_post
  before insert or update of status on public.jobs
  for each row execute function public.charge_job_post();
