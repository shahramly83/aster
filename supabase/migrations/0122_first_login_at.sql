-- ============================================================================
-- 0122: profiles.first_login_at — stamp the first time a teammate signs in
-- ============================================================================
-- An invite being redeemed is not the same as the person actually turning up:
-- accept-invite-create runs at signup, but an interviewer may not open the app
-- for days. The owner wants to know when the seat is genuinely in use.
--
-- Written once, by notify-first-login (service role), which claims the stamp
-- with `where first_login_at is null` so two tabs racing produce one
-- notification. Never written by the client: a self-set flag could be replayed
-- to spam the owner's bell.
alter table public.profiles add column if not exists first_login_at timestamptz;

comment on column public.profiles.first_login_at is
  'First time this teammate opened the app. Set once by notify-first-login; null means never signed in.';

-- Existing teammates predate the column. Backfill them as "already seen" so
-- applying this migration does not fire a burst of first-login notifications
-- for people who have been using the workspace for months. Only accounts
-- created from here on can trigger the notification.
update public.profiles set first_login_at = coalesce(created_at, now())
where first_login_at is null;
