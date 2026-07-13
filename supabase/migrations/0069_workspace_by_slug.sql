-- ============================================================================
-- Aster — public lookup of a workspace's branding by its subdomain slug
-- ============================================================================
-- Multi-tenant sign-in: each workspace lives at <slug>.hireaster.com. The login
-- page on a subdomain needs the company's name + logo to render "Sign in to
-- {Company}" before anyone authenticates, so this must be callable by anon.
--
-- It exposes only public branding (name, slug, logo_url) for an ACTIVE workspace,
-- never anything sensitive. Suspended / soft-deleted workspaces resolve to no row
-- so their branded login can't be spoofed. Slug is normalised the same way the
-- availability check and provisioning RPC normalise it (lowercase alphanumerics).

create or replace function public.workspace_by_slug(p_slug text)
returns table (slug text, name text, logo_url text)
language sql security definer set search_path = public stable as $$
  with norm as (select regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g') as s)
  select c.slug, c.name, c.logo_url
  from public.companies c
  where c.slug = (select s from norm)
    and (select s from norm) <> ''
    and c.deleted_at is null;
$$;

revoke all on function public.workspace_by_slug(text) from public;
grant execute on function public.workspace_by_slug(text) to anon, authenticated;
