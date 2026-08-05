-- ============================================================================
-- 0157: make "Last active" a real column instead of a permanent dash
-- ============================================================================
-- profiles.last_active_at has existed since 0001 and admin_list_users has
-- always returned it, but NOTHING in the app or the functions ever wrote to it.
-- Every row in the admin User management table therefore showed "—", which
-- reads as "this user has never signed in" rather than the truth: nobody is
-- recording it. It also blocks any dormant-workspace or churn-risk view, since
-- there is no signal to sort on.
--
-- Two changes:
--   touch_last_active()  -- a signed-in user stamps their OWN row, nobody else's
--   admin_list_users     -- also returns created_at, so the console can show
--                           when an account was created even before it has ever
--                           been active
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Stamp the caller's own profile. Security definer so it can write the column
-- without opening profiles to a general UPDATE policy, and hard-scoped to
-- auth.uid() so it can never touch another user's row whatever it is passed
-- (it takes no arguments at all).
--
-- Throttled to once an hour: this is called on every app load, and "last active"
-- does not need minute precision. Cheap no-op writes are avoided entirely.
-- ---------------------------------------------------------------------------
create or replace function public.touch_last_active()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles
     set last_active_at = now()
   where id = auth.uid()
     and (last_active_at is null or last_active_at < now() - interval '1 hour');
end $$;
revoke all on function public.touch_last_active() from public, anon;
grant execute on function public.touch_last_active() to authenticated;

-- ---------------------------------------------------------------------------
-- Add created_at to the admin user listing. A brand-new account has no activity
-- yet, and "joined 2 days ago" is the useful thing to show in that case.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, full_name text, email text, role profile_role, status profile_status,
  company_id uuid, company_name text, last_active_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, p.email, p.role, p.status, p.company_id, c.name,
           p.last_active_at, p.created_at
    from public.profiles p
    join public.companies c on c.id = p.company_id
    order by p.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
