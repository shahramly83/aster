-- ============================================================================
-- 0170: AI job drafting, sold only as top-up credits
-- ============================================================================
-- Writes a whole job posting from its title. Unlike every other AI feature here
-- it carries NO monthly allowance on any plan: the limit is 0 everywhere, so
-- consume_job_draft always falls straight through to the purchased balance.
-- That is the whole mechanism behind "top-up only" — no special casing in the
-- edge function, no new branch in charge(); a limit of zero simply means the
-- monthly pool is never available.
--
-- The counter column still exists and still increments for the record, so usage
-- reporting and the admin AI-cost screen see these calls like any other.
--
-- purchased_credits.kind is free text with no check constraint, so 'job_draft'
-- needs no schema change there.
--
-- Idempotent: safe to re-run.

alter table public.usage_counters
  add column if not exists job_drafts integer not null default 0;

-- Zero on every plan, by design. Kept as a function to match the other limits,
-- so if a plan ever includes drafts there is one place to change.
create or replace function public._job_draft_limit(p_plan plan_tier)
returns integer language sql immutable as $$
  select 0;
$$;

-- ---------------------------------------------------------------------------
-- Spend: monthly first (always empty here), then purchased. Reports which pool
-- paid so the edge function can refund the right one when the model call fails.
-- ---------------------------------------------------------------------------
create or replace function public.consume_job_draft()
returns table (used int, monthly_limit int, resets_at date, charged boolean, source text)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date; v_limit int; v_used int; v_bal int;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._job_draft_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period) values (v_company, v_period)
    on conflict (company_id, period) do nothing;
  select job_drafts into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set job_drafts = job_drafts + 1
      where company_id = v_company and period = v_period returning job_drafts into v_used;
    return query select v_used, v_limit, v_reset, true, 'monthly'::text;
    return;
  end if;

  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = v_company and kind = 'job_draft' and balance > 0 returning balance into v_bal;
  if v_bal is not null then
    -- Count it even though a purchased credit paid: the counter is the record
    -- of what was used, not of what the allowance covered.
    update public.usage_counters set job_drafts = job_drafts + 1
      where company_id = v_company and period = v_period returning job_drafts into v_used;
    return query select v_used, v_limit, v_reset, true, 'purchased'::text;
    return;
  end if;

  return query select v_used, v_limit, v_reset, false, 'none'::text;
end $$;
grant execute on function public.consume_job_draft() to authenticated;

-- ---------------------------------------------------------------------------
-- Give it back when OUR call failed. Never refunds below zero.
-- ---------------------------------------------------------------------------
create or replace function public.refund_job_draft_for(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text;
begin
  if p_company is null then return; end if;
  select created_at into v_created from public.companies where id = p_company;
  select p.period into v_period from public._ai_rank_period(v_created) p;
  update public.usage_counters
     set job_drafts = greatest(job_drafts - 1, 0)
   where company_id = p_company and period = v_period;
end $$;
revoke all on function public.refund_job_draft_for(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- What the meter on the job form reads.
-- ---------------------------------------------------------------------------
create or replace function public.get_job_draft_usage()
returns table (used integer, monthly_limit integer, resets_at date, purchased integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz; v_period text; v_reset date;
begin
  if v_company is null then return; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  return query
    select coalesce((select job_drafts from public.usage_counters
                      where company_id = v_company and period = v_period), 0),
           public._job_draft_limit((select plan from public.companies where id = v_company)),
           v_reset,
           coalesce((select balance from public.purchased_credits
                      where company_id = v_company and kind = 'job_draft'), 0);
end $$;
grant execute on function public.get_job_draft_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- Sold at USD 0.50 a draft. Opus costs more per call than the Haiku the other
-- features run on, so the margin here is thinner than on a 40-cent AI Rank
-- credit, but it is still comfortably above cost.
-- ---------------------------------------------------------------------------
insert into public.credit_prices (kind, price_usd_cents, label)
values ('job_draft', 50, 'AI job drafting')
on conflict (kind) do nothing;
