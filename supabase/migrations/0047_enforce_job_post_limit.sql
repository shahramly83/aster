-- ============================================================================
-- 0047: enforce the job-posting limit in the database (decision W1)
-- ============================================================================
-- The jobs_admin RLS policy permits any insert by a company admin. There is no
-- count check and no trigger. bump_job_post() exists and is correct, but the
-- *browser* calls it, after the fact. So this, pasted into any customer's
-- console with the anon key that ships in the bundle, creates unlimited open
-- roles on a $19 plan:
--
--     supabase.from('jobs').insert({ status: 'open', ... })
--
-- The limit belongs in a trigger, where it fires whoever does the insert.
--
-- Semantics (confirmed with the product owner): the allowance is jobs POSTED per
-- 30-day cycle, not jobs open at once. Closing a job does not give the credit
-- back — jobs_posted never decreases. bump_job_post() already worked this way,
-- and additionally floors on the live-job count, so neither "post 6 this cycle"
-- nor "keep 6 open" is possible on a 5-job plan. That floor is preserved here.
--
-- Re-opening a job that already paid must not charge again, so the charge is
-- recorded on the row itself.

alter table public.jobs
  add column if not exists post_charged boolean not null default false;

-- Backfill: every job that has ever been published already consumed its credit
-- (or predates metering). Without this, closing and re-opening an old job would
-- charge for it a second time.
update public.jobs set post_charged = true where status <> 'draft' and not post_charged;

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because usage_counters has no customer UPDATE policy: the
-- counter must not be writable by the user directly, only through a bump.
-- ---------------------------------------------------------------------------
create or replace function public.charge_job_post()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz;
  v_period  text;
  v_limit   int;
  v_stored  int;
  v_live    int;
begin
  -- Drafts are free. Only publishing costs a credit.
  if new.status <> 'open' then return new; end if;
  -- Already open, or already paid for (a re-open, or an edit that touches status).
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if;
  if new.post_charged then return new; end if;

  select created_at into v_created from public.companies where id = new.company_id;
  if v_created is null then return new; end if;  -- company vanished; RLS will reject anyway
  select p.period into v_period from public._ai_rank_period(v_created) p;
  v_limit := public._job_post_limit((select plan from public.companies where id = new.company_id));

  insert into public.usage_counters (company_id, period)
    values (new.company_id, v_period)
    on conflict (company_id, period) do nothing;

  -- FOR UPDATE serialises concurrent publishes, so two tabs cannot both slip
  -- past the cap. This is the lock the client-side check never had.
  select jobs_posted into v_stored from public.usage_counters
    where company_id = new.company_id and period = v_period for update;

  select count(*)::int into v_live from public.jobs
    where company_id = new.company_id and status = 'open' and id <> new.id;

  -- null limit = enterprise = unlimited.
  if v_limit is not null and greatest(v_stored, v_live) >= v_limit then
    raise exception 'job post limit reached for this cycle'
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;

  update public.usage_counters set jobs_posted = jobs_posted + 1
    where company_id = new.company_id and period = v_period;

  new.post_charged := true;
  return new;
end $$;

-- BEFORE, so the exception blocks the write and so post_charged lands on the row.
-- `update of status` means an ordinary title/description edit never charges.
drop trigger if exists trg_charge_job_post on public.jobs;
create trigger trg_charge_job_post
  before insert or update of status on public.jobs
  for each row execute function public.charge_job_post();
