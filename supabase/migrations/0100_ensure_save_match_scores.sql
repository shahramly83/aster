-- ============================================================================
-- 0100: (re)create save_match_scores — it was added to 0098's FILE after 0098 had
-- already been applied, so the migration ledger says 0098 is done but the DB never
-- got this function. Result: an interviewer's AI Rank run locked the job
-- (stamp_job_ranked exists) but never persisted the scores (this RPC was missing, so
-- the client fell back to a direct UPDATE that applications RLS blocks for
-- interviewers). Recreating it here, idempotently, makes interviewer runs persist.
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
           match_reasons = nullif(r->>'reasons', '')
     where company_id = v_company and job_id = p_job_id
       and candidate_id = (r->>'candidate_id')::uuid;
  end loop;
end $$;
grant execute on function public.save_match_scores(uuid, jsonb) to authenticated;
