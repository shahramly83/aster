-- ============================================================================
-- 0042: real unread state for the notification bell
-- ============================================================================
-- The activity feed is derived on the client from real rows (applications, jobs,
-- interviews), which is fine — it needs no table of its own. What was fake was
-- the *unread* state:
--
--     return list.map((it, i) => ({ id: `a${i+1}`, read: i >= 2, ...it }));
--
-- The first two items were hardcoded unread, so the bell always showed "2",
-- forever, for every workspace including an empty one. markActivitiesRead() only
-- set React state, so the badge came back on every reload.
--
-- One timestamp per user is all this needs: everything created after it is
-- unread. No notifications table, no fan-out, no rows to garbage-collect.
--
-- profiles has no self-UPDATE policy (only profiles_company_manage, for
-- owner/admin), so a plain update from the client would be denied. A definer RPC
-- scoped to auth.uid() is the narrowest way to let a user mark their own bell read.

alter table public.profiles
  add column if not exists activities_seen_at timestamptz;

-- Marks everything up to now as seen, for the calling user only. Returns the new
-- watermark so the client doesn't have to guess the server clock.
create or replace function public.mark_activities_seen()
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.profiles set activities_seen_at = v_now where id = auth.uid();
  return v_now;
end;
$$;
revoke all on function public.mark_activities_seen() from public, anon;
grant execute on function public.mark_activities_seen() to authenticated;
