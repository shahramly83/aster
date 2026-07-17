-- ============================================================================
-- 0108: device_tokens — push-notification tokens for the mobile app
-- ============================================================================
-- One row per (user, device). The mobile app upserts its Expo push token on
-- launch and deletes it on sign-out. Edge functions (service role) read these to
-- fan a notification out to a user's devices. A user may only see and manage
-- their OWN tokens; nobody can read anyone else's.
create table if not exists public.device_tokens (
  token       text primary key,               -- Expo push token (globally unique per install)
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'ios',    -- ios | android
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_device_tokens_user on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- A user manages only their own device rows.
drop policy if exists device_tokens_select on public.device_tokens;
create policy device_tokens_select on public.device_tokens for select
  using (user_id = auth.uid());

drop policy if exists device_tokens_insert on public.device_tokens;
create policy device_tokens_insert on public.device_tokens for insert
  with check (user_id = auth.uid());

drop policy if exists device_tokens_update on public.device_tokens;
create policy device_tokens_update on public.device_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists device_tokens_delete on public.device_tokens;
create policy device_tokens_delete on public.device_tokens for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.device_tokens to authenticated;

-- Keep updated_at fresh on upsert so stale tokens can be pruned later.
create or replace function public.touch_device_token() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_touch_device_token on public.device_tokens;
create trigger trg_touch_device_token before update on public.device_tokens
  for each row execute function public.touch_device_token();
