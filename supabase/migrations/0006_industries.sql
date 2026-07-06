-- ============================================================================
-- Aster — industry taxonomy
-- ============================================================================
-- A per-company registry of industries. Every time the resume parser tags a
-- candidate's role with an industry, that industry is recorded here (added if
-- it's new), so each workspace builds up a controlled list it can browse,
-- filter or standardise on later. Keyed by a normalised form so casing /
-- whitespace don't create duplicates.

create table if not exists public.industries (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name       text not null,                 -- as tagged, e.g. "Fintech"
  key        text not null,                 -- lower(trim(name)) for de-duplication
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

create index if not exists industries_company_idx on public.industries (company_id);

alter table public.industries enable row level security;

-- Company members can read and manage their own taxonomy. The parser writes via
-- the service role, so it isn't bound by this policy.
drop policy if exists "industries own company" on public.industries;
create policy "industries own company" on public.industries for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
