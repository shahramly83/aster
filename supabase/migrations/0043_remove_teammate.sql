-- ============================================================================
-- 0043: actually remove a teammate
-- ============================================================================
-- The "Remove" button in the Interviewers screen ran:
--
--     setInterviewers((prev) => prev.filter((x) => x.id !== removing.id));
--
-- and nothing else. No write, no revocation. The person you just "removed" kept
-- full workspace access, and reappeared on the next page load — while the UI
-- told you they were gone. Someone you fired could still read every candidate.
--
-- Removal is a suspension, not a delete: profiles rows anchor scorecards,
-- interviews and audit history, so deleting them would orphan real records. And
-- suspension is enough, because every tenancy helper already re-checks liveness
-- on each query:
--
--     current_company_id():  where p.id = auth.uid() and p.status = 'active'
--     is_company_admin():    same
--     assigned_job_ids():    same
--
-- So flipping status to 'suspended' revokes access on their very next request.
-- No session invalidation needed; RLS simply stops resolving a company for them.
--
-- profiles has no self-UPDATE policy and profiles_company_manage's WITH CHECK
-- does not constrain the role column (see 0041 §3), so we route this through a
-- definer RPC with explicit checks rather than let the client UPDATE directly.

create or replace function public.remove_teammate(p_profile uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_target  public.profiles%rowtype;
  v_caller_role public.profile_role;
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_profile = auth.uid() then
    raise exception 'you cannot remove yourself' using errcode = 'P0001';
  end if;

  select * into v_target from public.profiles
   where id = p_profile and company_id = v_company;
  if not found then
    -- Same message whether the row is missing or belongs to another company, so
    -- this cannot be used to probe for profile ids across tenants.
    raise exception 'no such teammate' using errcode = 'P0002';
  end if;
  if v_target.status = 'suspended' then
    return;  -- idempotent: a double-click must not error
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_target.role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'only an owner can remove another owner' using errcode = '42501';
  end if;

  -- trg_protect_owner still refuses to suspend the sole remaining owner.
  update public.profiles set status = 'suspended' where id = p_profile;

  -- Drop their interview assignments so closed access doesn't leave dangling
  -- rows that would silently re-grant reads if they were ever reactivated.
  delete from public.job_assignments where profile_id = p_profile;
end;
$$;
revoke all on function public.remove_teammate(uuid) from public, anon;
grant execute on function public.remove_teammate(uuid) to authenticated;
