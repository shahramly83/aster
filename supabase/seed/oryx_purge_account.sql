-- ============================================================================
-- Aster: HARD PURGE of the "Oryx Digital Sdn Bhd" account
-- ============================================================================
-- ⚠️  IRREVERSIBLE. This is NOT the same as oryx_wipe.sql.
--
--   oryx_wipe.sql        clears candidates + jobs, KEEPS the company, team,
--                        subscription and settings (workspace stays usable).
--   oryx_purge_account   deletes the COMPANY ROW and the AUTH USERS, so the
--   (this file)          account no longer exists and the email is free to
--                        register again from scratch.
--
-- Use this only when you want to sign up fresh and get a new 14-day trial.
--
-- Why a hard delete is required for a fresh signup:
--   * The in-app "delete account" path SOFT-deletes: it stamps companies.deleted_at
--     and opens a 30-day purge window (0018 / 0045). A soft-deleted workspace still
--     occupies the row.
--   * one_workspace_per_domain (0082) refuses a second workspace for an email
--     domain that already has one, so the old row must be genuinely gone.
--   * Signup provisioning grants the trial as (now + interval '14 days'), so a
--     clean signup lands on a full 14-day trial.
--
-- What gets removed: deleting the company cascades every company-scoped table
-- (jobs, candidates, applications, interviews, scorecards, offers, polls,
-- activity_log, usage counters, purchased credits, email templates, invitations,
-- job assignments, subscriptions...). Deleting the auth users then frees the
-- email addresses so they can sign up again.
--
-- ⚠️  BILLING: this only removes DATABASE rows. It does NOT cancel a Stripe
--     subscription. If the workspace has an active paid plan, cancel it in
--     Stripe FIRST, or you will keep being charged for a workspace that no
--     longer exists.
--
-- Run in the Supabase SQL editor (executes as owner, bypassing RLS on purpose).
-- No other company is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — BILLING CHECK. Run this FIRST.
--   If `status` is 'active' (or anything other than trialing/canceled) and
--   processor_sub_id is not null, there is a live Stripe subscription. Cancel it
--   in the Stripe dashboard BEFORE purging, otherwise Stripe keeps charging you
--   for a workspace that no longer exists in the database.
--   Look the id up at: Stripe Dashboard -> Subscriptions -> search processor_sub_id
-- ----------------------------------------------------------------------------
select
  c.name,
  c.plan            as company_plan,
  c.status          as company_status,
  s.status          as subscription_status,
  s.cycle,
  s.seats,
  s.current_period_end,
  s.processor_customer_id,
  s.processor_sub_id,
  case
    when s.id is null then 'No subscription row — nothing to cancel'
    when s.processor_sub_id is null then 'No Stripe subscription id — nothing to cancel'
    when s.status in ('trialing', 'canceled') then 'Not billing — safe to purge'
    else '*** LIVE STRIPE SUBSCRIPTION — CANCEL IN STRIPE FIRST ***'
  end as billing_verdict
from public.companies c
left join public.subscriptions s on s.company_id = c.id
where c.name = 'Oryx Digital Sdn Bhd';


-- ----------------------------------------------------------------------------
-- STEP 1 — DRY RUN. Run this on its own first and read the output.
--          It changes nothing; it only shows you exactly what STEP 2 will delete.
-- ----------------------------------------------------------------------------
do $$
declare
  co        record;
  found_co  boolean := false;
  n_prof int; n_cand int; n_jobs int; n_apps int; n_iv int; n_off int; n_act int;
begin
for co in
  select id, name, slug, plan, status, created_at, deleted_at
  from public.companies
  where name = 'Oryx Digital Sdn Bhd'
loop
  found_co := true;
  select count(*) into n_prof from public.profiles     where company_id = co.id;
  select count(*) into n_cand from public.candidates   where company_id = co.id;
  select count(*) into n_jobs from public.jobs         where company_id = co.id;
  select count(*) into n_apps from public.applications where company_id = co.id;
  select count(*) into n_iv   from public.interviews   where company_id = co.id;
  select count(*) into n_off  from public.offers       where company_id = co.id;
  select count(*) into n_act  from public.activity_log where company_id = co.id;

  raise notice '--------------------------------------------------------------';
  raise notice 'WILL DELETE company % (%)', co.name, co.id;
  raise notice '  slug=%  plan=%  status=%  created=%  deleted_at=%',
    co.slug, co.plan, co.status, co.created_at, co.deleted_at;
  raise notice '  profiles=%  candidates=%  jobs=%  applications=%',
    n_prof, n_cand, n_jobs, n_apps;
  raise notice '  interviews=%  offers=%  activity_log=%', n_iv, n_off, n_act;
  raise notice '  AND the auth.users behind those % profile(s).', n_prof;
  raise notice '--------------------------------------------------------------';
end loop;
if not found_co then
  raise notice 'No company named "Oryx Digital Sdn Bhd" found. Nothing would be deleted.';
  raise notice 'Run:  select id, name, deleted_at from public.companies order by name;';
end if;
end $$;

-- Emails that will be freed for re-registration (review this list):
select p.id as auth_user_id, p.email, p.role, p.status
from public.profiles p
join public.companies c on c.id = p.company_id
where c.name = 'Oryx Digital Sdn Bhd'
order by (p.role = 'owner') desc, p.email;


-- ----------------------------------------------------------------------------
-- STEP 2 — THE ACTUAL PURGE.
--          Only run this after STEP 1 shows exactly what you expect.
--          Uncomment the block below (remove the /* and */) and run it.
-- ----------------------------------------------------------------------------
/*
do $$
declare
  co_id    uuid;
  user_ids uuid[];
  n int;
begin
  select id into co_id from public.companies where name = 'Oryx Digital Sdn Bhd';
  if co_id is null then
    raise notice 'No company named "Oryx Digital Sdn Bhd" found. Nothing purged.';
    return;
  end if;

  -- Capture the auth users BEFORE the company delete cascades their profiles away.
  select array_agg(id) into user_ids from public.profiles where company_id = co_id;

  -- Deleting the company cascades every company-scoped table.
  delete from public.companies where id = co_id;
  raise notice 'Deleted company % and all its workspace data.', co_id;

  -- Free the login emails so they can sign up again from scratch.
  if user_ids is not null then
    delete from auth.users where id = any(user_ids);
    get diagnostics n = row_count;
    raise notice 'Deleted % auth user(s); those emails can now register again.', n;
  end if;

  raise notice 'Done. Sign up fresh at hireaster.com to start a new 14-day trial.';
end $$;
*/
