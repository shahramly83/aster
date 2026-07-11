-- 0055_auth_uid_for_email.sql
--
-- Helper for the accept-invite-create edge function: resolve the auth user id
-- for an email so the function can tell an abandoned/incomplete signup (no
-- workspace membership) from a real member, and self-heal the former.
--
-- supabase-js has no getUserByEmail, and PostgREST does not expose the auth
-- schema, so this SECURITY DEFINER function reads auth.users. It is locked to
-- the service_role (the edge function's key); no client role can call it, so it
-- cannot be used to probe which emails have accounts.

create or replace function public.auth_uid_for_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.auth_uid_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_uid_for_email(text) to service_role;
