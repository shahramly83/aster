-- ============================================================================
-- 0159: interviews and hires in the admin overview
-- ============================================================================
-- The console counts workspaces, users, jobs and candidates, but not the two
-- numbers that say whether Aster is actually working: how many interviews are
-- happening, and how many people got hired. Both are already in the schema
-- (public.interviews, applications.stage = 'hired'); nothing surfaced them.
--
-- Added to admin_company_detail rather than a new RPC, so the dashboard totals
-- and the Companies table both get them from the one call they already make.
-- Counts only, never candidate rows: the admin portal must not be able to read
-- who was interviewed or hired, only how many.
--
-- Idempotent: safe to re-run.

drop function if exists public.admin_company_detail();
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz,
  owner_name text, owner_email text,
  interview_count bigint, hired_count bigint, upcoming_interviews bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.status, c.region,
           (select count(*) from public.profiles p where p.company_id = c.id),
           (select count(*) from public.candidates ca where ca.company_id = c.id),
           (select count(*) from public.jobs j where j.company_id = c.id and j.status = 'open'),
           s.status, s.cycle, s.current_period_end, c.created_at,
           o.full_name, o.email,
           -- Every interview ever booked, and the ones still ahead.
           (select count(*) from public.interviews i where i.company_id = c.id),
           (select count(*) from public.applications a
             where a.company_id = c.id and a.stage = 'hired'),
           (select count(*) from public.interviews i2
             where i2.company_id = c.id
               and i2.scheduled_at >= now()
               and coalesce(i2.status, '') <> 'cancelled')
    from public.companies c
    left join public.subscriptions s on s.company_id = c.id
    left join lateral (
      select p.full_name, p.email
        from public.profiles p
       where p.company_id = c.id and p.role = 'owner'
       order by p.created_at
       limit 1
    ) o on true
    order by c.created_at desc;
end $$;
revoke all on function public.admin_company_detail() from public, anon;
grant execute on function public.admin_company_detail() to authenticated;
