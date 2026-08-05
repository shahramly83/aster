-- ============================================================================
-- 0163: a workspace can be given a plan without being billed for it
-- ============================================================================
-- There was no way to say "this workspace has Scale, pays nothing, and does not
-- expire". A demo account for a partner out selling had to be run as a trial,
-- which suspend_expired_trials() kills on its end date, mid-pitch, with no
-- warning. The only workaround was pushing the trial date out by hand forever.
--
-- comped_at makes the intent explicit and durable:
--   trial     -- evaluating, SHOULD expire
--   comped    -- we granted it, must NOT expire, bills nothing
--   active    -- paying
--
-- The plan itself still lives in companies.plan, so a comped workspace uses the
-- same allowance lookup as everyone else and needs no special case in the app.
--
-- Idempotent: safe to re-run.

alter table public.companies add column if not exists comped_at    timestamptz;
alter table public.companies add column if not exists comped_note  text;
alter table public.companies add column if not exists comped_by    uuid;   -- admin_users.id, no FK: informational

comment on column public.companies.comped_at is
  'Set when an admin grants this workspace its plan for free. Non-null means never expire it and never bill it.';

-- ---------------------------------------------------------------------------
-- The expiry job must leave comped workspaces alone. Reproduced verbatim from
-- 0151 with one added condition: a comped workspace is not an expiring trial.
-- ---------------------------------------------------------------------------
create or replace function public.suspend_expired_trials()
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with expired as (
    update public.companies c
    set status      = 'suspended',
        deleted_at  = now(),
        purge_after = now() + interval '30 days'
    from public.subscriptions s
    where s.company_id = c.id
      and c.status = 'trial'
      and c.deleted_at is null
      and c.comped_at is null                    -- granted, not evaluating
      and s.status = 'trialing'
      and s.current_period_end <= current_date
    returning c.id
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Grant or withdraw. Withdrawing does NOT suspend: it only removes the
-- protection, so the workspace goes back to being an ordinary trial and the
-- expiry job decides from there. Suspending is a separate, deliberate action.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_comped(p_company uuid, p_comped boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_plan text;
begin
  if public.current_admin_role() not in ('super', 'billing') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name, plan::text into v_name, v_plan from public.companies where id = p_company;
  if v_name is null then raise exception 'no such company' using errcode = 'P0002'; end if;

  update public.companies
     set comped_at   = case when p_comped then coalesce(comped_at, now()) else null end,
         comped_note = case when p_comped then nullif(btrim(p_note), '') else null end,
         comped_by   = case when p_comped then auth.uid() else null end
   where id = p_company;

  perform public._admin_audit(
    case when p_comped then 'Comped workspace on ' || v_plan else 'Ended comp' end,
    v_name || coalesce(' (' || nullif(btrim(p_note), '') || ')', ''));
end $$;
revoke all on function public.admin_set_comped(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_comped(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Surface it wherever the console reads companies. Reproduced from 0159 with
-- the two comp columns added.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_company_detail();
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz,
  owner_name text, owner_email text,
  interview_count bigint, hired_count bigint, upcoming_interviews bigint,
  comped_at timestamptz, comped_note text
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
           (select count(*) from public.interviews i where i.company_id = c.id),
           (select count(*) from public.applications a
             where a.company_id = c.id and a.stage = 'hired'),
           (select count(*) from public.interviews i2
             where i2.company_id = c.id
               and i2.scheduled_at >= now()
               and coalesce(i2.status, '') <> 'cancelled'),
           c.comped_at, c.comped_note
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
