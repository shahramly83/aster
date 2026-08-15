-- ============================================================================
-- 0176: AI Rank history, so a run survives a refresh
-- ============================================================================
-- A Candidate Search role match has never had anywhere to go. save_match_scores
-- (0100/0101) writes applications.match_score, which needs the candidate to have
-- an application row for that job -- and the Matches tab deliberately excludes
-- anyone who has applied, because its whole purpose is inviting people who have
-- not. So those scores only ever lived in a React ref: refresh the page and the
-- ranking the customer just paid for was gone.
--
-- That was survivable while a run cost one credit. Now that a run scores the
-- whole database (1 credit per 50 candidates, so hundreds of credits on a large
-- one), losing it to a reload or a closed tab is losing real money. Runs are
-- written batch by batch as they land, so the work is durable the moment it is
-- paid for, not only if the recruiter waits for the end.
--
-- Both AI Rank surfaces write here: the Matches tab (source 'search') and the
-- Applicants board (source 'applicants'). The Applicants board keeps writing
-- applications.match_score as well -- that is what its own list sorts on. This
-- is the history, not the source of truth for either screen.

create table if not exists public.rank_runs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  -- Nulled rather than cascaded when a job goes: the run still happened, and the
  -- customer paid for it. job_title carries the name so history stays readable
  -- after the posting is renamed or deleted.
  job_id          uuid references public.jobs(id) on delete set null,
  job_title       text not null,
  -- 'search' (Candidate Search > Matches) | 'applicants' (Applicants board).
  -- Free text with a check rather than an enum, so a third surface can be added
  -- without a type migration.
  source          text not null default 'search' check (source in ('search', 'applicants')),
  actor_id        uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Maintained by the RPC from the scores actually stored, not trusted from the
  -- client, so a half-finished run reports what it really scored.
  candidate_count int not null default 0,
  credits_used    int not null default 0
);

create index if not exists rank_runs_company_time
  on public.rank_runs (company_id, created_at desc);

create table if not exists public.rank_run_scores (
  run_id       uuid not null references public.rank_runs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  score        int  not null check (score between 0 and 100),
  -- The model's two sentences. Kept only for the top RUN_REASON_KEEP of each run
  -- (see prune below): every candidate keeps a score and stays in the ranked
  -- list, but nobody reads the rationale for the 4,000th best fit, and storing
  -- 400 characters for each of them is megabytes per run.
  reason       text,
  primary key (run_id, candidate_id)
);

-- Serves both the ranked read-back and the top-N reason prune.
create index if not exists rank_run_scores_by_score
  on public.rank_run_scores (run_id, score desc);

alter table public.rank_runs       enable row level security;
alter table public.rank_run_scores enable row level security;

-- Readable by the workspace it belongs to. Interviewers can read a run for a job
-- they are assigned to, which matches who is allowed to trigger one.
drop policy if exists rank_runs_read on public.rank_runs;
create policy rank_runs_read on public.rank_runs
  for select using (
    company_id = public.current_company_id()
    and (public.is_company_admin() or job_id in (select public.assigned_job_ids()))
  );

drop policy if exists rank_run_scores_read on public.rank_run_scores;
create policy rank_run_scores_read on public.rank_run_scores
  for select using (
    run_id in (select id from public.rank_runs)  -- rank_runs RLS does the scoping
  );

-- No insert/update policy on either table: writes go through save_rank_run()
-- below, which is SECURITY DEFINER. A client cannot forge a run, backdate one,
-- or edit the scores it was given.

-- ---------------------------------------------------------------------------
-- Record (or extend) a run
-- ---------------------------------------------------------------------------
-- Called once per batch. The first call passes p_run_id => null and gets an id
-- back; every later batch of the same run passes that id, so a 100-batch run is
-- one history entry that grows, not 100 entries.
--
-- Re-running the same batch is harmless: scores upsert on (run_id, candidate_id).
create or replace function public.save_rank_run(
  p_run_id    uuid,
  p_job_id    uuid,
  p_job_title text,
  p_source    text,
  p_scores    jsonb,
  p_credits   int default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_id      uuid := p_run_id;
  v_keep    constant int := 100;  -- reasons retained per run
  v_runs    constant int := 20;   -- runs retained per company
begin
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- The job must be this company's, and an interviewer may only rank a job they
  -- are assigned to. Same rule as save_match_scores, so the two cannot disagree
  -- about who is allowed to run a ranking.
  if p_job_id is not null then
    if not exists (select 1 from public.jobs where id = p_job_id and company_id = v_company) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not public.is_company_admin() and p_job_id not in (select public.assigned_job_ids()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.rank_runs (company_id, job_id, job_title, source, actor_id)
    values (v_company, p_job_id, coalesce(nullif(p_job_title, ''), 'Untitled role'),
            case when p_source in ('search', 'applicants') then p_source else 'search' end,
            auth.uid())
    returning id into v_id;
  else
    -- An id from another workspace must not be extendable.
    if not exists (select 1 from public.rank_runs where id = v_id and company_id = v_company) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  insert into public.rank_run_scores (run_id, candidate_id, score, reason)
  select v_id,
         (r->>'candidate_id')::uuid,
         least(100, greatest(0, coalesce((r->>'score')::int, 0))),
         nullif(r->>'reason', '')
    from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) as r
   where r->>'candidate_id' is not null
     -- A candidate deleted between the run starting and this batch landing would
     -- otherwise fail the whole insert on the foreign key.
     and exists (select 1 from public.candidates c
                  where c.id = (r->>'candidate_id')::uuid and c.company_id = v_company)
  on conflict (run_id, candidate_id) do update
    set score = excluded.score, reason = excluded.reason;

  -- Keep the written reasons for the top scorers only. Runs long enough for this
  -- to matter are exactly the ones where nobody reads past the first screen.
  update public.rank_run_scores s
     set reason = null
   where s.run_id = v_id
     and s.reason is not null
     and s.candidate_id not in (
       select candidate_id from public.rank_run_scores
        where run_id = v_id order by score desc, candidate_id limit v_keep
     );

  update public.rank_runs
     set candidate_count = (select count(*) from public.rank_run_scores where run_id = v_id),
         credits_used    = credits_used + greatest(0, coalesce(p_credits, 0)),
         updated_at      = now()
   where id = v_id;

  -- Trim to the most recent runs for this company. The run just written is the
  -- newest, so it is never the one pruned. Scores cascade with the run.
  delete from public.rank_runs r
   where r.company_id = v_company
     and r.id not in (
       select id from public.rank_runs
        where company_id = v_company order by created_at desc limit v_runs
     );

  return v_id;
end $$;

grant execute on function public.save_rank_run(uuid, uuid, text, text, jsonb, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Delete a run the customer no longer wants in their history
-- ---------------------------------------------------------------------------
create or replace function public.delete_rank_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.rank_runs where id = p_run_id and company_id = v_company;
end $$;

grant execute on function public.delete_rank_run(uuid) to authenticated;
