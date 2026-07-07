-- ============================================================================
-- Aster — public apply page + job-posting view analytics
-- ============================================================================
-- Records a view each time a candidate opens a job's public apply page, so the
-- recruiter can see total views, unique visitors, and a breakdown by link
-- source (LinkedIn, careers site, database invite, …). Views are recorded via
-- an anon SECURITY DEFINER function (the apply page has no login); the company
-- reads its own stats through get_job_view_stats().

create table if not exists public.job_views (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  visitor    text,        -- random id kept in the visitor's browser, for unique counts
  source     text,        -- ?source= on the link (linkedin, careers, database, …)
  viewed_at  timestamptz not null default now()
);
create index if not exists idx_job_views_job on public.job_views(job_id);

alter table public.job_views enable row level security;

-- The company can read its own views (backs get_job_view_stats + any direct read).
-- No insert/update/delete policy: writes only ever happen through track_job_view.
drop policy if exists job_views_company_select on public.job_views;
create policy job_views_company_select on public.job_views
  for select using (company_id = public.current_company_id());

-- Public-safe job details for the apply page (anon can read one job by id).
create or replace function public.get_public_job(p_job_id uuid)
returns table (id uuid, title text, status text, details jsonb, expires_at date, company_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select j.id, j.title, j.status, j.details, j.expires_at, c.name
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id;
end $$;
grant execute on function public.get_public_job(uuid) to anon, authenticated;

-- Record a view. Anon-callable. Ignores unknown jobs and de-dupes so one
-- visitor refreshing the page on the same day counts once.
create or replace function public.track_job_view(p_job_id uuid, p_visitor text default null, p_source text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.jobs where id = p_job_id;
  if v_company is null then return; end if;

  if p_visitor is not null and p_visitor <> '' and exists (
    select 1 from public.job_views
    where job_id = p_job_id and visitor = p_visitor and viewed_at::date = current_date
  ) then
    return;  -- same visitor, same day → already counted
  end if;

  insert into public.job_views (company_id, job_id, visitor, source)
    values (v_company, p_job_id, nullif(p_visitor, ''), nullif(p_source, ''));
end $$;
grant execute on function public.track_job_view(uuid, text, text) to anon, authenticated;

-- Per-job view stats for the signed-in company: total, unique visitors, and a
-- {source: count} map. One row per job that has at least one view.
create or replace function public.get_job_view_stats()
returns table (job_id uuid, total bigint, uniques bigint, sources jsonb)
language sql security definer set search_path = public as $$
  with base as (
    select job_id, coalesce(source, 'direct') as source, visitor, id
    from public.job_views
    where company_id = public.current_company_id()
  ),
  per_source as (
    select job_id, source, count(*)::int as cnt
    from base group by job_id, source
  )
  select b.job_id,
         count(*)::bigint                                        as total,
         count(distinct coalesce(b.visitor, b.id::text))::bigint as uniques,
         (select coalesce(jsonb_object_agg(ps.source, ps.cnt), '{}'::jsonb)
            from per_source ps where ps.job_id = b.job_id)       as sources
  from base b
  group by b.job_id;
$$;
grant execute on function public.get_job_view_stats() to authenticated;
