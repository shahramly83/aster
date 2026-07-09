-- ============================================================================
-- Aster — global platform feature flags (drives /admin toggles into the app)
-- ============================================================================
-- A tiny key/value table of platform-wide switches. The customer app and the
-- marketing site read it (public select) to gate capabilities at runtime, so an
-- admin flipping a flag in /admin takes effect without a deploy. Only active
-- Aster admins may change a flag, via set_platform_flag (SECURITY DEFINER).
--
-- Seeded flags (both OFF by default, per the locked pricing decision):
--   sso_login   — customer sign-in via Google/Microsoft SSO
--   white_label — custom company branding (logo) across the product & careers site

create table if not exists public.platform_flags (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.platform_flags enable row level security;

-- Readable by everyone (including anon) so the app + marketing can gate features.
drop policy if exists platform_flags_read on public.platform_flags;
create policy platform_flags_read on public.platform_flags for select using (true);
-- No write policy: writes go only through set_platform_flag (definer) or the
-- service role. Direct client writes are denied by RLS.

insert into public.platform_flags (key, enabled) values
  ('sso_login',   false),
  ('white_label', false)
on conflict (key) do nothing;

-- Admin-only toggle. Upserts the flag and returns its new state. Rejects anyone
-- who is not an active row in admin_users.
create or replace function public.set_platform_flag(p_key text, p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid() and status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  insert into public.platform_flags (key, enabled, updated_at)
    values (p_key, p_enabled, now())
    on conflict (key) do update set enabled = excluded.enabled, updated_at = now();
  return p_enabled;
end $$;

revoke all on function public.set_platform_flag(text, boolean) from public, anon;
grant execute on function public.set_platform_flag(text, boolean) to authenticated;
