-- ============================================================================
-- 0041: security hardening  ***PROPOSED — NOT YET APPLIED. READ §4 FIRST.***
-- ============================================================================
-- Four defects found in the production audit. (1) and (2) are unambiguous and
-- safe. (3) changes who can promote an owner. (4) LOCKS OUT cancelled customers
-- and is a deliberate product decision — it is commented out below. Decide it
-- explicitly rather than letting it ride.
--
-- See ASTER_PRODUCTION_AUDIT.md findings #10, #11, #12, #13.

-- ---------------------------------------------------------------------------
-- 1. HIGH — two SECURITY DEFINER functions are callable by anyone, on any company
-- ---------------------------------------------------------------------------
-- 0034 created resume_parse_usage_for(uuid) and bump_resume_parse_for(uuid) as
-- SECURITY DEFINER (so they bypass RLS), taking the company as a *parameter*,
-- with no auth.uid() ownership check. It then granted execute on a third
-- function and forgot these two. Postgres defaults EXECUTE to PUBLIC.
--
-- Result: anon or any signed-in user can call
--     rpc('bump_resume_parse_for', { p_company: '<any company uuid>' })
-- in a loop and burn a competitor's monthly resume-parsing allowance to zero.
-- resume_parse_usage_for likewise discloses any company's usage and plan limit.
-- Company UUIDs are semi-public: they appear in apply-page URLs and logo paths.
--
-- These are only ever called by the service-role `parse-resume` edge function,
-- which resolves the company from the authenticated user's own profile. Lock
-- them to service_role, matching how 0018/0036/0039 treat their internal RPCs.
revoke all on function public.resume_parse_usage_for(uuid) from public, anon, authenticated;
revoke all on function public.bump_resume_parse_for(uuid)  from public, anon, authenticated;
grant execute on function public.resume_parse_usage_for(uuid) to service_role;
grant execute on function public.bump_resume_parse_for(uuid)  to service_role;

-- Same omission, lower impact: lets anyone probe whether an email or domain has
-- already consumed its free trial. Only the definer signup path needs it.
revoke all on function public._free_trial_used(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. MEDIUM — get_public_job serves unpublished drafts
-- ---------------------------------------------------------------------------
-- 0012 returns a job for ANY id, whatever its status, and whatever the state of
-- the owning workspace. A draft that was never published — salary and full
-- description inside `details` — is readable by anyone holding or guessing its
-- UUID. So is a job belonging to a soft-deleted (suspended / lapsed) workspace,
-- which keeps happily accepting applications.
--
-- Closed and expired roles must still resolve: the apply page reads `status` and
-- `expires_at` to render "this role has closed" rather than a 404. Only drafts
-- are excluded, because a draft was never public in the first place.
--
-- The signature is preserved exactly (p_job_id, and the same six OUT columns);
-- `create or replace` cannot change a function's return type, and the client
-- calls it by the named parameter p_job_id.
create or replace function public.get_public_job(p_job_id uuid)
returns table (id uuid, title text, status text, details jsonb, expires_at date, company_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select j.id, j.title, j.status, j.details, j.expires_at, c.name
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id
      and j.status <> 'draft'      -- was: no status filter at all
      and c.deleted_at is null;    -- was: a suspended workspace kept taking applications
end $$;

-- ---------------------------------------------------------------------------
-- 3. MEDIUM — a company admin can promote themselves to owner
-- ---------------------------------------------------------------------------
-- profiles_company_manage (0001) has:
--     using  (company_id = current_company_id() and caller is owner/admin)
--     with check (company_id = current_company_id())
-- The WITH CHECK never constrains the NEW role. A recruiter or interviewer is
-- correctly blocked by USING, so the important case already holds. But an
-- *admin* passes USING and may then set role = 'owner' on themselves or anyone,
-- gaining workspace deletion and billing. protect_owner (0021) only stops the
-- LAST owner being removed; it does not stop new owners being minted.
--
-- Ownership transfer should be an explicit owner-only action, not a side effect
-- of an UPDATE. SECURITY DEFINER RPCs (invite/accept/assign) run as the function
-- owner and bypass RLS, so tightening this policy does not break them.
create or replace function public.is_company_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner' and p.status = 'active'
  );
$$;
grant execute on function public.is_company_owner() to authenticated;

drop policy if exists profiles_company_manage on public.profiles;
create policy profiles_company_manage on public.profiles for update
  using (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
  )
  with check (
    company_id = public.current_company_id()
    -- Only an existing owner may mint another owner.
    and (role <> 'owner' or public.is_company_owner())
  );

-- ---------------------------------------------------------------------------
-- 4. CRITICAL — cancelling a subscription does not revoke access  *** DECISION ***
-- ---------------------------------------------------------------------------
-- stripe-webhook sets companies.status = 'churned' on cancellation and nothing
-- else. But the entire tenancy layer keys off deleted_at, never status:
--
--   current_company_id():  where p.status = 'active' and c.deleted_at is null
--
-- companies.status is referenced by ZERO policies. So a customer who cancels
-- keeps full read/write access to their workspace, forever, for free. Contrast
-- suspend_expired_trials(), which DOES set deleted_at — a lapsed trial is locked
-- out, but a lapsed paying customer is not.
--
-- The fix below locks a churned workspace out immediately. That is almost
-- certainly right, but it is a product decision with real consequences:
--   * Stripe fires customer.subscription.deleted at PERIOD END for a normal
--     "cancel at period end", so the customer keeps access until they've used
--     what they paid for. Good.
--   * But an involuntary churn (final dunning failure) locks them out with no
--     grace period and no data-export window.
--   * There is no 30-day soft-delete window on churn, unlike trial lapse, so
--     nothing schedules their data for purge either.
--
-- RECOMMENDED: instead of the blunt lockout below, make the webhook set
-- deleted_at + purge_after on churn (reusing the trial-lapse path), so a
-- cancelled customer lands on the existing suspended paywall, keeps 30 days to
-- resubscribe, and is then purged. That reuses code that already works and
-- gives the customer a way back.
--
-- Uncomment ONLY if you want the immediate hard lockout instead:
--
-- create or replace function public.current_company_id()
-- returns uuid language sql stable security definer set search_path = public as $$
--   select p.company_id
--   from public.profiles p
--   join public.companies c on c.id = p.company_id
--   where p.id = auth.uid()
--     and p.status = 'active'
--     and c.deleted_at is null
--     and c.status <> 'churned';
-- $$;
