-- ============================================================================
-- 0044: let a user save their own profile
-- ============================================================================
-- ProfileScreen edits a first name, last name, phone number and avatar; Settings
-- edits notification preferences and a calendar provider. None of it was ever
-- written anywhere. handleSave() set React state, showed "All changes saved.",
-- and every field reverted on the next page load.
--
-- Three of those fields had no column to live in, and there was no avatar bucket.
-- This adds them.
--
-- Why an RPC rather than a plain UPDATE: profiles has no self-UPDATE policy. The
-- only one is profiles_company_manage (owner/admin), whose WITH CHECK does not
-- constrain the role column — see 0041 §3. Adding a broad self-update policy
-- would let any user rewrite their own `role` and `company_id`. A definer RPC
-- with an explicit column list cannot.

alter table public.profiles
  add column if not exists phone            text,
  add column if not exists avatar_path      text,
  add column if not exists notify_prefs     jsonb not null default '{}'::jsonb,
  add column if not exists calendar_provider text;

-- Updates only the caller's own row, and only these five columns. role,
-- company_id and status are unreachable from here by construction.
create or replace function public.update_my_profile(
  p_full_name         text default null,
  p_phone             text default null,
  p_avatar_path       text default null,
  p_notify_prefs      jsonb default null,
  p_calendar_provider text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.profiles set
    full_name         = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone             = coalesce(nullif(trim(p_phone), ''), phone),
    avatar_path       = coalesce(p_avatar_path, avatar_path),
    notify_prefs      = coalesce(p_notify_prefs, notify_prefs),
    calendar_provider = coalesce(p_calendar_provider, calendar_provider)
  where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text, text, text, jsonb, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Avatars: private, company-folder scoped, read via signed URL.
-- ---------------------------------------------------------------------------
-- Same shape as the `resumes` bucket (0002), NOT `logos` (0022): a logo is meant
-- to be world-readable on the public careers page. A teammate's headshot is not.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "avatars read own company"   on storage.objects;
drop policy if exists "avatars write own company"  on storage.objects;
drop policy if exists "avatars update own company" on storage.objects;
drop policy if exists "avatars delete own company" on storage.objects;

create policy "avatars read own company"   on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "avatars write own company"  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "avatars update own company" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "avatars delete own company" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_company_id()::text);
