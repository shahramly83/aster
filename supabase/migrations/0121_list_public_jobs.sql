-- ============================================================================
-- 0121: Public list of a company's open roles, by workspace slug
-- ============================================================================
-- The apply endpoint (parse-application) and get_public_job (0088) both work on a
-- role you already know the id of. This adds the missing piece for an embeddable
-- job board on a customer's own website: given a workspace slug, return every
-- role that is currently OPEN and still accepting, so their site can render the
-- live list with no hardcoded job ids and new roles appear automatically.
--
-- Same safety envelope as workspace_by_slug (0069) and get_public_job (0088):
--   * security definer, but it only ever exposes public posting data (title +
--     the `details` already shown on the public apply page), never anything
--     sensitive, and only for an ACTIVE (not soft-deleted) workspace.
--   * drafts and closed roles are excluded; expired roles are filtered out live.
--   * `accepting` is the same credit-derived flag get_public_job returns, so a
--     board can grey out a role whose company is out of screening credits without
--     mutating the job row.
-- Slug is normalised exactly as the availability check / provisioning / login
-- lookups normalise it (lowercase alphanumerics only).

create or replace function public.list_public_jobs(p_slug text)
returns table (
  id uuid,
  title text,
  details jsonb,
  expires_at date,
  created_at timestamptz,
  accepting boolean
)
language sql security definer set search_path = public stable as $$
  with norm as (
    select regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]', '', 'g') as s
  )
  select j.id, j.title, j.details, j.expires_at, j.created_at,
         public._company_accepting_applicants(j.company_id)
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where c.slug = (select s from norm)
    and (select s from norm) <> ''
    and c.deleted_at is null
    and j.status = 'open'
    -- Past its closing date: intake has stopped, so it should not appear on the
    -- board even though the row is still 'open' (mirrors parse-application).
    and (j.expires_at is null or j.expires_at >= (now() at time zone 'utc')::date)
  order by j.created_at desc;
$$;

revoke all on function public.list_public_jobs(text) from public;
grant execute on function public.list_public_jobs(text) to anon, authenticated;
