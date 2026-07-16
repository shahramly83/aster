-- ============================================================================
-- 0098: Per-job AI Rank lock + interviewer-triggered runs
-- ============================================================================
-- AI Rank on a job is now a shared, once-until-new-candidate action: after ANY
-- run it's locked for everyone (interviewers, hiring managers, tenant) until a
-- genuinely new candidate applies, so the workspace pool isn't drained by repeat
-- runs on an unchanged pipeline. `ai_ranked_at` records when a job was last ranked;
-- the client unlocks the button when an application arrived after it.
--
-- Interviewers can trigger a run too (rank-candidates already meters against the
-- workspace pool via the caller's JWT), but jobs RLS blocks their direct update,
-- so the stamp goes through a SECURITY DEFINER RPC gated to admins OR an
-- interviewer assigned to that job.
alter table public.jobs add column if not exists ai_ranked_at timestamptz;

create or replace function public.stamp_job_ranked(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- The job must belong to the caller's company.
  if not exists (select 1 from public.jobs where id = p_job_id and company_id = v_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Admins/tenant may stamp any job; an interviewer only one they're assigned to.
  if not public.is_company_admin() and p_job_id not in (select public.assigned_job_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.jobs set ai_ranked_at = now() where id = p_job_id and company_id = v_company;
end $$;
grant execute on function public.stamp_job_ranked(uuid) to authenticated;

-- Persist AI Rank scores for a job. Admins/tenant can update applications directly,
-- but an assigned interviewer can't (applications RLS is read-only for them) — and
-- they can now trigger AI Rank — so route the write through a definer RPC gated the
-- same way. p_scores: [{ "candidate_id": uuid, "score": 0-100 int, "reasons": text }].
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
