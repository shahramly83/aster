-- 0084_email_two_factor.sql
--
-- Email-code two-factor for customer accounts, as an alternative to the TOTP
-- authenticator app. After a correct password, we email a 6-digit code and hold
-- the app until it is entered. A verified device is trusted for 30 days so a person
-- is not asked on every sign-in from their own laptop.
--
-- Supabase's native MFA is TOTP or SMS only, so this is app-level: the code is
-- checked by the send/verify edge functions running as service_role, and the tables
-- below are NOT client-readable. The customer app gates the workspace behind a valid
-- trusted-device token; the token is meaningless without the server row it maps to.

-- Per-account switch. Readable by the owner (so Settings can show its state), never
-- writable from the client: only the verify edge function turns it on, after proving
-- the person can receive a code.
alter table public.profiles
  add column if not exists email_2fa_enabled boolean not null default false;

-- One-time login codes. code_hash is sha-256(code + user_id), never the raw code.
-- Short expiry, capped attempts, single use.
create table if not exists public.login_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  purpose     text not null default 'login',   -- 'login' | 'enable'
  attempts    int  not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists login_codes_user_idx on public.login_codes (user_id, created_at desc);

-- Devices that have cleared 2FA, so we don't prompt every time. token_hash is
-- sha-256 of a random token the client keeps in localStorage.
create table if not exists public.trusted_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null,
  label       text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists trusted_devices_user_idx on public.trusted_devices (user_id);
create unique index if not exists trusted_devices_token_idx on public.trusted_devices (token_hash);

-- RLS: these hold security material. No client policies at all, so PostgREST returns
-- nothing to anon/authenticated. Only the edge functions (service_role, which bypasses
-- RLS) ever touch them.
alter table public.login_codes enable row level security;
alter table public.trusted_devices enable row level security;
revoke all on public.login_codes from anon, authenticated;
revoke all on public.trusted_devices from anon, authenticated;
