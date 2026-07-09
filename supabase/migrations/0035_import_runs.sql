-- ============================================================================
-- 0035: Persistent bulk-import history (Recent imports)
-- ============================================================================
-- The Bulk Resume Upload screen shows a "Recent imports" log of past batches,
-- each reopenable read-only. It was client-only (lost on every reload). This
-- stores each finished run so the history persists across sessions. The whole
-- UI run object (label, counts, per-file rows) is kept in `run` jsonb; file_count
-- is duplicated out for quick display/sorting.

create table if not exists public.import_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  file_count  int not null default 0,
  run         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.import_runs enable row level security;

-- Scoped to the caller's company (any member of the company). Reads/writes go
-- through the signed-in user, so no service-role path is needed.
create policy import_runs_company on public.import_runs for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create index if not exists import_runs_company_created
  on public.import_runs (company_id, created_at desc);
