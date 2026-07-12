-- ============================================================================
-- Aster — blocked dates for the public "book a 1:1" calendar (/contact-sales)
-- ============================================================================
-- An Aster admin can block specific dates (holidays, team off-sites) so the
-- marketing booking calendar greys them out. Public select so the anon marketing
-- page can read them; writes go only through the admin-gated RPCs below (same
-- pattern as platform_flags / set_platform_flag in 0025).

create table if not exists public.booking_blocked_dates (
  day        date primary key,
  reason     text,
  updated_at timestamptz not null default now()
);

alter table public.booking_blocked_dates enable row level security;

drop policy if exists booking_blocked_read on public.booking_blocked_dates;
create policy booking_blocked_read on public.booking_blocked_dates for select using (true);
-- No write policy: writes go only through the definer RPCs or the service role.

-- Block a date (upsert). Rejects anyone who is not an active Aster admin.
create or replace function public.add_booking_blocked_date(p_day date, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  insert into public.booking_blocked_dates (day, reason, updated_at)
    values (p_day, nullif(btrim(p_reason), ''), now())
    on conflict (day) do update set reason = excluded.reason, updated_at = now();
end $$;

-- Unblock a date. Same admin gate.
create or replace function public.remove_booking_blocked_date(p_day date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  delete from public.booking_blocked_dates where day = p_day;
end $$;

revoke all on function public.add_booking_blocked_date(date, text) from public, anon;
revoke all on function public.remove_booking_blocked_date(date) from public, anon;
grant execute on function public.add_booking_blocked_date(date, text) to authenticated;
grant execute on function public.remove_booking_blocked_date(date) to authenticated;
