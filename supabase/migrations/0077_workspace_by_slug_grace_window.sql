-- ============================================================================
-- Aster — a workspace in its grace window must still resolve at its subdomain
-- ============================================================================
-- 0069 refused any company with deleted_at set, so a soft-deleted workspace's
-- subdomain rendered "Workspace not found".
--
-- That quietly locked customers out of paying us. Both of these stamp deleted_at:
--
--   * a lapsed free trial (0036)      -> companies.status = 'suspended'
--   * a cancelled subscription (webhook) -> companies.status = 'churned'
--
-- In both cases the app already has the right screen waiting: DeletedWorkspaceScreen
-- paywalls them, and a payment clears deleted_at and restores everything. But the
-- owner could never GET there. <slug>.hireaster.com resolved to no workspace, so
-- the branded login would not even render and there was no route back to billing.
-- A trial that ran out was therefore unrecoverable, which is precisely the moment
-- we most want them to subscribe.
--
-- Resolve a workspace while it still exists and is inside its purge window. Once
-- purge_after passes, purge-workspaces hard-deletes the row and the subdomain 404s
-- on its own, so nothing here keeps a dead workspace alive.
--
-- Still only public branding (name, slug, logo_url), the same fields the careers
-- page already shows the world. Nothing sensitive is exposed by letting a churned
-- workspace render its own login.

create or replace function public.workspace_by_slug(p_slug text)
returns table (slug text, name text, logo_url text)
language sql security definer set search_path = public stable as $$
  with norm as (select regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g') as s)
  select c.slug, c.name, c.logo_url
  from public.companies c
  where c.slug = (select s from norm)
    and (select s from norm) <> ''
    -- Live, or soft-deleted but not yet purged: they can still sign in and pay.
    and (c.deleted_at is null or c.purge_after is null or c.purge_after > now());
$$;

revoke all on function public.workspace_by_slug(text) from public;
grant execute on function public.workspace_by_slug(text) to anon, authenticated;
