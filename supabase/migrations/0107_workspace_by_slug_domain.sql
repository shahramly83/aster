-- ============================================================================
-- 0107: workspace_by_slug also returns the company's email domain
-- ============================================================================
-- The subdomain login page pre-fills the email with the company's own domain
-- (e.g. @onlazy.com), so a person just types their username. The domain is the
-- most common non-free email domain among the company's active members. Public
-- (anon) read, like the rest of this function.
drop function if exists public.workspace_by_slug(text);
create or replace function public.workspace_by_slug(p_slug text)
returns table (slug text, name text, logo_url text, domain text)
language sql security definer set search_path = public stable as $$
  with norm as (select regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g') as s)
  select c.slug, c.name, c.logo_url,
    (select split_part(lower(p.email), '@', 2) as dom
       from public.profiles p
      where p.company_id = c.id and p.email is not null and p.status = 'active'
        and split_part(lower(p.email), '@', 2) not in
          ('gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','hotmail.com',
           'outlook.com','live.com','icloud.com','me.com','proton.me','protonmail.com','aol.com')
      group by dom
      order by count(*) desc, dom limit 1) as domain
  from public.companies c
  where c.slug = (select s from norm)
    and (select s from norm) <> ''
    and (c.deleted_at is null or c.purge_after is null or c.purge_after > now());
$$;
revoke all on function public.workspace_by_slug(text) from public;
grant execute on function public.workspace_by_slug(text) to anon, authenticated;
