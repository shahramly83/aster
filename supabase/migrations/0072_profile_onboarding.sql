-- ============================================================================
-- 0072: persist onboarding / tour completion per USER (not per browser)
-- ============================================================================
-- The guided coach marks and tours (complete-profile, post-a-job, the jobs tour
-- and the applicants tour) stored their "done"/"skip" flag only in localStorage,
-- so the SAME account saw them all over again in a new browser or an incognito
-- window. Persist a small per-user map of which onboarding keys are done, keyed
-- the same way the client keys them, so a "skip" sticks to the account anywhere.
-- (Mirrors how activities_seen_at already lives per-user on the profile.)

alter table public.profiles
  add column if not exists onboarding jsonb not null default '{}'::jsonb;

-- Mark one onboarding/tour key as done for the calling user. Idempotent and
-- additive: it merges the flag into the existing map so each tour accumulates
-- independently and re-calling is harmless.
create or replace function public.mark_onboarding(p_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_key is null or length(trim(p_key)) = 0 then return; end if;
  update public.profiles
     set onboarding = coalesce(onboarding, '{}'::jsonb) || jsonb_build_object(trim(p_key), true)
   where id = auth.uid();
end $$;

revoke all on function public.mark_onboarding(text) from public, anon;
grant execute on function public.mark_onboarding(text) to authenticated;
