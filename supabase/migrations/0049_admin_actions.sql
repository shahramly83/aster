-- ============================================================================
-- 0049: real admin-portal actions (staff-only, server-enforced)
-- ============================================================================
-- The admin portal's four actions -- suspend/restore a company, deactivate a
-- user, change a subscription plan -- only mutated React state and appended a
-- client-side audit line. Nothing was written. A super-admin saw "success" and
-- the database was untouched.
--
-- These are POWERFUL cross-tenant operations, so every function below:
--   * checks current_admin_role() against the SAME matrix the client's PERMS
--     table uses (super / support / billing), server-side, on every call;
--   * is granted to `authenticated` but gated internally -- an admin is just a
--     signed-in user with an admin_users row, so is_admin() is the real gate;
--   * writes a row to audit_log with the acting admin's id/name/role, so the
--     audit trail is a real record and not client-side theatre.
--
-- Suspending a company reuses the existing soft-delete columns (deleted_at +
-- purge_after), so all the tenancy machinery that already keys off deleted_at
-- applies unchanged: the workspace locks out immediately on the members' next
-- request. Suspending a user flips profiles.status, which current_company_id()
-- already treats as no-access.

-- Append an audit row as the acting admin. SECURITY DEFINER so audit_log stays
-- append-only to everyone else.
create or replace function public._admin_audit(p_action text, p_target text)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, actor_name, actor_role, action, target)
  select a.id, a.full_name, a.role, p_action, p_target
  from public.admin_users a where a.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- company.suspend / company.restore  (super only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_company_status(p_company uuid, p_suspend boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if public.current_admin_role() <> 'super' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.companies where id = p_company;
  if v_name is null then raise exception 'no such company' using errcode = 'P0002'; end if;

  if p_suspend then
    update public.companies
       set status = 'suspended', deleted_at = coalesce(deleted_at, now()),
           purge_after = coalesce(purge_after, now() + interval '30 days')
     where id = p_company;
    perform public._admin_audit('Suspended company', v_name);
  else
    update public.companies
       set status = 'active', deleted_at = null, purge_after = null
     where id = p_company;
    perform public._admin_audit('Restored company', v_name);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- user.deactivate / reactivate  (super only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_status(p_profile uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_role profile_role; v_company uuid;
begin
  if public.current_admin_role() <> 'super' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select email, role, company_id into v_email, v_role, v_company
    from public.profiles where id = p_profile;
  if v_email is null then raise exception 'no such user' using errcode = 'P0002'; end if;

  -- Don't strand a workspace: never deactivate its sole active owner.
  if not p_active and v_role = 'owner'
     and (select count(*) from public.profiles
          where company_id = v_company and role = 'owner' and status = 'active') <= 1 then
    raise exception 'cannot deactivate the sole workspace owner' using errcode = 'P0001';
  end if;

  update public.profiles set status = case when p_active then 'active' else 'suspended' end
   where id = p_profile;
  perform public._admin_audit(case when p_active then 'Reactivated user' else 'Deactivated user' end, v_email);
end $$;

-- ---------------------------------------------------------------------------
-- subscription.change  (super or billing)
-- ---------------------------------------------------------------------------
-- Staff override only. Does NOT touch Stripe -- it corrects the local record
-- (comp, mistaken tier, manual enterprise deal). A real plan change still goes
-- through checkout + the webhook.
create or replace function public.admin_change_plan(p_company uuid, p_plan plan_tier)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if public.current_admin_role() not in ('super', 'billing') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.companies where id = p_company;
  if v_name is null then raise exception 'no such company' using errcode = 'P0002'; end if;

  update public.companies    set plan = p_plan where id = p_company;
  update public.subscriptions set plan = p_plan where company_id = p_company;
  perform public._admin_audit('Changed plan to ' || p_plan::text, v_name);
end $$;

revoke all on function public._admin_audit(text, text)                 from public, anon, authenticated;
revoke all on function public.admin_set_company_status(uuid, boolean)  from public, anon;
revoke all on function public.admin_set_user_status(uuid, boolean)     from public, anon;
revoke all on function public.admin_change_plan(uuid, plan_tier)       from public, anon;
grant execute on function public.admin_set_company_status(uuid, boolean) to authenticated;
grant execute on function public.admin_set_user_status(uuid, boolean)    to authenticated;
grant execute on function public.admin_change_plan(uuid, plan_tier)      to authenticated;

-- ---------------------------------------------------------------------------
-- Company listing extended for the portal (plan + status + subscription join).
-- admin_company_overview already exists and is is_admin()-gated; this adds the
-- subscription cycle / period end the billing table needs.
-- ---------------------------------------------------------------------------
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.status, c.region,
           (select count(*) from public.profiles p where p.company_id = c.id),
           (select count(*) from public.candidates ca where ca.company_id = c.id),
           (select count(*) from public.jobs j where j.company_id = c.id and j.status = 'open'),
           s.status, s.cycle, s.current_period_end, c.created_at
    from public.companies c
    left join public.subscriptions s on s.company_id = c.id
    order by c.created_at desc;
end $$;
revoke all on function public.admin_company_detail() from public, anon;
grant execute on function public.admin_company_detail() to authenticated;

-- ---------------------------------------------------------------------------
-- Company-user listing for the portal (staff-only). These are workspace team
-- members (owner/admin/interviewer), never candidates -- candidate PII is never
-- exposed to staff, and this selects no candidate data.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid, full_name text, email text, role profile_role, status profile_status,
  company_id uuid, company_name text, last_active_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, p.email, p.role, p.status, p.company_id, c.name, p.last_active_at
    from public.profiles p
    join public.companies c on c.id = p.company_id
    order by p.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
