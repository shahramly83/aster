-- 0085_whatsapp_connections.sql
--
-- Per-company WhatsApp Business connection via Meta's Cloud API (WhatsApp
-- Business Platform). A company brings its own WhatsApp Business phone number:
-- we store the Cloud API phone-number id and a long-lived access token and send
-- template messages (interview confirmations / reminders) straight to Meta's
-- Graph API. Messages are billed to the company's own Meta account, not Aster.
--
-- This row holds an access token, so it is service_role only: NO client policies
-- at all, like login_codes / trusted_devices in 0084. The `whatsapp` edge
-- function (service_role) is the only thing that reads or writes it. It validates
-- credentials against the Graph API before saving, reads the token to send, and
-- returns only non-secret status fields to the client. Clients never see the token.

create table if not exists public.whatsapp_connections (
  company_id       uuid primary key references public.companies(id) on delete cascade,
  phone_number_id  text not null,                       -- Cloud API phone-number id (the send endpoint)
  waba_id          text,                                -- WhatsApp Business Account id (optional, for reference)
  display_phone    text,                                -- pretty number from Meta, e.g. +60 12-345 6789
  verified_name    text,                                -- business display name Meta has verified
  access_token     text not null,                       -- SENSITIVE: system-user / long-lived token
  status           text not null default 'connected',   -- 'connected'
  connected_by     uuid references auth.users(id),
  connected_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- RLS on, but no policies: PostgREST returns nothing to anon/authenticated. Only
-- the edge function (service_role, which bypasses RLS) ever touches this table.
alter table public.whatsapp_connections enable row level security;
revoke all on public.whatsapp_connections from anon, authenticated;
