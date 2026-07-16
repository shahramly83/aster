-- ============================================================================
-- 0101: fix save_match_scores — match_reasons is a JSONB column, but the function
-- assigned it text (nullif(r->>'reasons','')), which Postgres rejects with
-- "42804 column match_reasons is of type jsonb but expression is of type text".
-- The old client path worked only because PostgREST auto-encodes text into jsonb;
-- plpgsql doesn't, so every RPC-routed save (all of them once 0100 created the fn)
-- failed silently. Wrap the reason in to_jsonb so it stores as a jsonb string, the
-- same value the direct-update path produced.
create or replace function public.save_match_scores(p_job_id uuid, p_scores jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id(); r jsonb;
begin
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.jobs where id = p_job_id and company_id = v_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.is_company_admin() and p_job_id not in (select public.assigned_job_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select value from jsonb_array_elements(p_scores) loop
    update public.applications
       set match_score   = least(100, greatest(0, coalesce((r->>'score')::int, 0))),
           match_reasons = to_jsonb(nullif(r->>'reasons', ''))
     where company_id = v_company and job_id = p_job_id
       and candidate_id = (r->>'candidate_id')::uuid;
  end loop;
end $$;
grant execute on function public.save_match_scores(uuid, jsonb) to authenticated;
