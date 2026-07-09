-- ============================================================================
-- Aster — 30-day soft delete for workspaces + free-grant ledger
-- ============================================================================
-- "Delete my workspace" does NOT wipe data immediately. It schedules deletion:
--   * companies.deleted_at is stamped and purge_after = now() + 30 days
--   * current_company_id() stops resolving the workspace, so the account is
--     locked out at once (no access, no further credit usage) but every row
--     (candidates, jobs, usage/credits, subscription) is retained untouched
--   * the owner can restore within 30 days and everything comes back exactly as
--     it was (nothing is reset), so active credits / trial days survive a restore
--   * after 30 days, purge_expired_workspaces() hard-deletes the company row,
--     which cascades to all child tables
--
-- A one-way hash of the owner's email is recorded in free_grant_ledger so that
-- deleting and signing up again cannot reset the free trial / free credits. The
-- hash is computed in the edge function with a server secret; the DB only stores
-- and matches it.

-- ---------------------------------------------------------------------------
-- 1. Soft-delete window on companies
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists deleted_at  timestamptz;
alter table public.companies add column if not exists purge_after timestamptz;

create index if not exists companies_purge_idx
  on public.companies (purge_after)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Tenancy resolver excludes soft-deleted workspaces
-- ---------------------------------------------------------------------------
-- Every RLS policy keys off current_company_id(). Returning NULL for a
-- soft-deleted workspace suspends all data access for its members immediately,
-- while the SECURITY DEFINER RPCs below (which use auth.uid() directly) can
-- still read/restore it. Behaviour is unchanged for live workspaces.
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.company_id
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid() and c.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 3. Free-grant ledger (survives the workspace; blocks re-signup abuse)
-- ---------------------------------------------------------------------------
create table if not exists public.free_grant_ledger (
  email_hash         text primary key,           -- HMAC(normalized email), from the edge function
  free_trial_used_at timestamptz not null default now(),
  workspaces_deleted int not null default 1,
  last_deleted_at    timestamptz not null default now()
);
alter table public.free_grant_ledger enable row level security;
-- No policies: only the service role (edge function) reads/writes this.

-- ---------------------------------------------------------------------------
-- 4. request_workspace_deletion — owner-only, schedules the 30-day soft delete
-- ---------------------------------------------------------------------------
create or replace function public.request_workspace_deletion(p_email_hash text default null)
returns timestamptz                              -- the purge_after timestamp
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_purge   timestamptz := now() + interval '30 days';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Only the workspace owner may delete it.
  select company_id into v_company
  from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can delete it' using errcode = '42501';
  end if;

  update public.companies
     set deleted_at = now(), purge_after = v_purge
   where id = v_company and deleted_at is null;
  if not found then
    raise exception 'workspace is already scheduled for deletion' using errcode = 'P0001';
  end if;

  -- Record that this identity has used its free grant, so a re-signup with the
  -- same email cannot reset the free trial / credits.
  if p_email_hash is not null and length(p_email_hash) > 0 then
    insert into public.free_grant_ledger (email_hash) values (p_email_hash)
      on conflict (email_hash) do update
        set workspaces_deleted = public.free_grant_ledger.workspaces_deleted + 1,
            last_deleted_at     = now();
  end if;

  return v_purge;
end;
$$;
revoke all on function public.request_workspace_deletion(text) from public, anon;
grant execute on function public.request_workspace_deletion(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. my_deletion_status — lets a locked-out owner see the restore window
-- ---------------------------------------------------------------------------
-- current_company_id() hides a soft-deleted workspace, so the app needs a
-- definer path to read "you are scheduled for deletion, restore by <date>".
create or replace function public.my_deletion_status()
returns table (company_id uuid, company_name text, deleted_at timestamptz, purge_after timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.deleted_at, c.purge_after
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid();
$$;
grant execute on function public.my_deletion_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. restore_workspace — owner-only, within the 30-day window
-- ---------------------------------------------------------------------------
create or replace function public.restore_workspace()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select company_id into v_company
  from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can restore it' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 7. purge_expired_workspaces — hard-delete past the 30-day window
-- ---------------------------------------------------------------------------
-- Deleting the company row cascades to profiles, jobs, candidates, applications,
-- interviews, scorecards, subscriptions, usage_counters, industries, job_views.
-- NOT covered by the cascade (handle in the scheduled edge function that calls
-- this): resume files in the `resumes` storage bucket, orphaned support_tickets
-- (company_id set null), and the auth.users rows (delete via the auth admin API).
-- Service-role only; call from a daily cron / scheduled edge function.
create or replace function public.purge_expired_workspaces()
returns table (purged_company_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  delete from public.companies
   where deleted_at is not null and purge_after is not null and purge_after < now()
  returning id;
end;
$$;
revoke all on function public.purge_expired_workspaces() from public, anon, authenticated;
grant execute on function public.purge_expired_workspaces() to service_role;
