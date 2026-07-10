-- ============================================================================
-- 0039: A trial suspension is a paywall, not a restorable deletion
-- ============================================================================
-- Two different things set companies.deleted_at:
--   * request_workspace_deletion()  — the owner chose to delete. Restorable for
--     30 days, free, via restore_workspace().
--   * suspend_expired_trials()      — the 14-day trial lapsed without a
--     subscription (status = 'suspended'). The ONLY way back is to subscribe;
--     stripe-webhook clears deleted_at/purge_after when the payment lands.
--
-- Before this migration both landed on the same "Restore workspace" screen, so a
-- lapsed trial could click Restore and keep Scale access for free forever. Here
-- we (1) expose companies.status so the app can tell them apart, (2) make
-- restore_workspace() refuse a suspended workspace, and (3) add end_trial_now()
-- so the owner can end their own trial (mirrors the nightly cron for one row).

-- ---------------------------------------------------------------------------
-- 1. my_deletion_status — now also returns status
-- ---------------------------------------------------------------------------
-- Return type changes, so create-or-replace won't do; drop and recreate.
drop function if exists public.my_deletion_status();

create function public.my_deletion_status()
returns table (company_id uuid, company_name text, status company_status, deleted_at timestamptz, purge_after timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.status, c.deleted_at, c.purge_after
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid();
$$;
revoke all on function public.my_deletion_status() from public, anon;
grant execute on function public.my_deletion_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. restore_workspace — refuses a suspended (trial-expired) workspace
-- ---------------------------------------------------------------------------
create or replace function public.restore_workspace()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_status  company_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select company_id into v_company
  from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can restore it' using errcode = '42501';
  end if;

  select status into v_status from public.companies where id = v_company;
  if v_status = 'suspended' then
    raise exception 'subscribe to restore this workspace' using errcode = '42501';
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
-- 3. end_trial_now — the owner ends their own trial ahead of the cron
-- ---------------------------------------------------------------------------
-- Same end state as suspend_expired_trials(), scoped to the caller's company and
-- without the elapsed-date check. Returns the purge deadline.
create or replace function public.end_trial_now()
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_purge   timestamptz := now() + interval '30 days';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select company_id into v_company
  from public.profiles where id = v_uid and role = 'owner';
  if v_company is null then
    raise exception 'only the workspace owner can end the trial' using errcode = '42501';
  end if;

  update public.companies c
     set status = 'suspended', deleted_at = now(), purge_after = v_purge
   where c.id = v_company
     and c.status = 'trial'
     and c.deleted_at is null
     and exists (
       select 1 from public.subscriptions s
       where s.company_id = c.id and s.status = 'trialing'
     );
  if not found then
    raise exception 'no active trial to end' using errcode = 'P0001';
  end if;

  return v_purge;
end;
$$;
revoke all on function public.end_trial_now() from public, anon;
grant execute on function public.end_trial_now() to authenticated;
