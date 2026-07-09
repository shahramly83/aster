-- ============================================================================
-- Aster — public preview of a pending teammate invitation
-- ============================================================================
-- The accept-invite landing (/?invite=<token>) needs to greet the invitee and
-- lock the email field to the invited address BEFORE they authenticate. The
-- invitations table is admin-only under RLS, so this SECURITY DEFINER function
-- exposes just enough to render that landing: the invited email, the company
-- name, and the role. It reveals only what the token holder already knows (the
-- token was emailed to that address), and returns zero rows for an unknown,
-- already-accepted, or expired token.
-- ============================================================================

create or replace function public.invite_preview(p_token uuid)
returns table (email text, company_name text, role profile_role)
language sql stable security definer set search_path = public as $$
  select i.email, c.name, i.role
  from public.invitations i
  join public.companies c on c.id = i.company_id
  where i.token = p_token
    and i.accepted_at is null
    and i.expires_at > now();
$$;

revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
