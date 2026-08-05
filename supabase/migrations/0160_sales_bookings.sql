-- ============================================================================
-- 0160: 1:1 sales bookings as records, not prose in a ticket body
-- ============================================================================
-- A booking on /contact-sales files a support ticket whose BODY contains the
-- requested slot as free text ("Preferred date: Thursday, 14 August 2026").
-- Nothing stores the date or time as data, so there is no way to answer "what
-- is in my calendar on Thursday", spot two people asking for the same slot, or
-- mark a call as done. The only booking-shaped table in the schema is
-- booking_blocked_dates, which records the days you are NOT available.
--
-- This stores the request itself. The ticket stays exactly as it is: it remains
-- the conversation and the email trail, and this row links to it.
--
-- Idempotent: safe to re-run.

create table if not exists public.sales_bookings (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  text references public.support_tickets(id) on delete set null,
  -- The requested slot, as data. day + slot are what the visitor picked; the
  -- slot list is fixed in the UI (CONTACT_SLOTS) so it is stored as its label
  -- rather than a time, which keeps "2:30 PM" meaning the same thing whatever
  -- timezone the admin views it from.
  day        date not null,
  slot       text not null,
  name       text not null,
  email      text not null,
  phone      text,
  company    text,
  message    text,
  -- requested -> confirmed | done | cancelled. Free text rather than an enum so
  -- a new state does not need a migration before it can be used.
  status     text not null default 'requested',
  note       text,                      -- admin's own note, never emailed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_bookings_day on public.sales_bookings(day, slot);

alter table public.sales_bookings enable row level security;

-- Staff only, both ways. Visitors never read this back; the edge function writes
-- it with the service role, which bypasses RLS.
drop policy if exists sales_bookings_admin_read on public.sales_bookings;
create policy sales_bookings_admin_read on public.sales_bookings
  for select using (public.is_admin());

revoke all on table public.sales_bookings from public, anon;
grant select on table public.sales_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Move a booking along. Admin-gated, audited like every other admin action, and
-- the only way the status changes.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_status(p_booking uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('requested', 'confirmed', 'done', 'cancelled') then
    raise exception 'unknown booking status: %', p_status;
  end if;
  update public.sales_bookings
     set status = p_status,
         note = coalesce(p_note, note),
         updated_at = now()
   where id = p_booking
   returning name || ' on ' || to_char(day, 'DD Mon YYYY') || ' ' || slot into v_who;
  if v_who is null then raise exception 'no such booking'; end if;
  perform public._admin_audit('Set booking to ' || p_status, v_who);
end $$;
revoke all on function public.set_booking_status(uuid, text, text) from public, anon;
grant execute on function public.set_booking_status(uuid, text, text) to authenticated;
