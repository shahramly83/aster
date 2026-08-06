-- ---------------------------------------------------------------------------
-- Where our customers are.
--
-- admin_company_detail already returns companies.region, which nothing has ever
-- written: it is free text from 0001 and is null on every row. The country a
-- customer actually gave us lives in companies.address_country (0032), set from
-- the structured address on their billing details. Return that instead of
-- guessing from a column nobody fills in.
--
-- Otherwise identical to the 0163 definition. Recreated rather than altered
-- because a plpgsql function's return type cannot be extended in place.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_company_detail();
create or replace function public.admin_company_detail()
returns table (
  id uuid, name text, plan plan_tier, status company_status, region text,
  user_count bigint, candidate_count bigint, active_jobs bigint,
  sub_status sub_status, cycle text, current_period_end date, created_at timestamptz,
  owner_name text, owner_email text,
  interview_count bigint, hired_count bigint, upcoming_interviews bigint,
  comped_at timestamptz, comped_note text,
  address_country text
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
           c.comped_at, c.comped_note,
           nullif(btrim(c.address_country), '')
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
