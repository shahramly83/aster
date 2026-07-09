-- ============================================================================
-- Aster — rate limit for the public marketing-chat edge function
-- ============================================================================
-- The "Ask Aster" chat endpoint is public (anon) and every message costs an
-- Anthropic call, so it needs a per-IP throttle. Edge functions are stateless
-- and load-balanced across isolates, so an in-memory counter does not hold; the
-- limit lives in Postgres and is incremented atomically per fixed time bucket.
--
-- Only the edge function (service role) touches this via chat_rate_hit(); the
-- table is not exposed to anon/authenticated. The RPC returns TRUE when the
-- request is allowed and FALSE once the caller is over the limit for the bucket.

create table if not exists public.chat_rate_limit (
  key    text   not null,             -- client IP (or "unknown")
  bucket bigint not null,             -- floor(epoch / window_seconds)
  count  int    not null default 0,
  primary key (key, bucket)
);

alter table public.chat_rate_limit enable row level security;
-- No policies: anon/authenticated get no access. The SECURITY DEFINER function
-- below runs as owner, and the service role bypasses RLS anyway.

create or replace function public.chat_rate_hit(
  p_key            text,
  p_max            int,
  p_window_seconds int
) returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  b bigint := floor(extract(epoch from now()) / greatest(p_window_seconds, 1));
  c int;
begin
  insert into public.chat_rate_limit (key, bucket, count)
    values (p_key, b, 1)
    on conflict (key, bucket)
    do update set count = public.chat_rate_limit.count + 1
    returning count into c;

  -- opportunistic cleanup of buckets older than ~1 hour, so the table stays tiny
  delete from public.chat_rate_limit
    where bucket < b - (3600 / greatest(p_window_seconds, 1));

  return c <= p_max;
end;
$$;

-- The edge function calls this with the service role key.
grant execute on function public.chat_rate_hit(text, int, int) to service_role;
