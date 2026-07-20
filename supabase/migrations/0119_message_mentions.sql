-- ============================================================================
-- 0119: @mentions in the candidate discussion thread
-- ============================================================================
-- A message can tag one or more teammates ("@Priya") to pull them into the
-- thread. We store the tagged profile ids on the message so the client can
-- highlight them and the notify-message function can send those people a
-- distinct "mentioned you" push instead of the generic new-message one.
--
-- Just a column: mention targets are always a subset of the thread's existing
-- recipients (managers + the role's assigned interviewers), which RLS already
-- gates on read/insert, so no new policy is needed. Defaults to an empty array
-- so every existing row and any client that doesn't send the field stays valid.
alter table public.candidate_messages
  add column if not exists mentioned_ids uuid[] not null default '{}';
