-- ============================================================================
-- Aster — prune the industry taxonomy when a candidate is deleted
-- ============================================================================
-- Skills and seniority in Candidate search are derived live from the remaining
-- candidates (candidates.parsed.skills / years_of_experience), so deleting a
-- profile already drops its unique skills/seniority while shared ones stay.
--
-- The `industries` taxonomy, however, is a persisted per-company table (filled
-- by the parse-application function). Without cleanup it would keep an industry
-- tag even after the last candidate carrying it is gone. This trigger removes
-- any industry that no remaining candidate in the same company still has, and
-- keeps the ones another profile shares. Runs for every delete path (SQL, a
-- future in-app delete, bulk cleanup) — not just one code path.

create or replace function public._prune_industries_after_candidate_delete()
returns trigger
language plpgsql

security definer

set search_path = public
as $$
declare
  -- Copy the field into a local so the DELETE below references a plpgsql
  -- variable, not `old.…` inside a SQL statement (which errors as an unknown
  -- table). jsonb_exists() is used instead of the `?` operator, which
  -- plpgsql can misparse as a bind placeholder.
  v_company uuid;
begin
  v_company := old.company_id;

  -- Skip during a full company teardown (industries cascade-delete anyway).
  if not exists (select 1 from public.companies where id = v_company) then
    return old;
  end if;

  delete from public.industries i
  where i.company_id = v_company
    and not exists (
      -- Any remaining candidate in this company whose parsed industries still
      -- include this tag keeps it alive.
      select 1 from public.candidates c
      where c.company_id = v_company
        and jsonb_typeof(c.parsed -> 'industries') = 'array'
        and jsonb_exists(c.parsed -> 'industries', i.name)
    );

  return old;
end $$;

drop trigger if exists trg_prune_industries on public.candidates;
create trigger trg_prune_industries
after delete on public.candidates
for each row execute function public._prune_industries_after_candidate_delete();
