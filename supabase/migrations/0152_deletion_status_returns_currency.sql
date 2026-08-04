-- ============================================================================
-- Aster — my_deletion_status also returns the workspace's billing currency
-- ============================================================================
-- The subscribe-to-unlock screen is the one place a locked-out owner sees prices,
-- and it showed them in USD to a workspace that bills in MYR: the companies row
-- does not resolve under RLS once soft-deleted, so the screen had no way to know
-- the preference. It came straight from this RPC's caller, so return it here.
-- ============================================================================

drop function if exists public.my_deletion_status();

create or replace function public.my_deletion_status()
returns table (
  company_id         uuid,
  company_name       text,
  status             company_status,
  deleted_at         timestamptz,
  purge_after        timestamptz,
  preferred_currency text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.status, c.deleted_at, c.purge_after,
         coalesce(c.preferred_currency, 'myr')
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid();
$$;

grant execute on function public.my_deletion_status() to authenticated;
