-- ---------------------------------------------------------------------------
-- 0174: The fields Google needs to show a role in Google for Jobs
--
-- Google reads JobPosting structured data off the public apply page and shows
-- matching roles in a dedicated jobs panel above the ordinary results. It is
-- free, needs no partner approval, and reaches more candidates than the whole
-- aggregator list combined, but it validates strictly: a posting missing
-- datePosted or a country is not shown at all rather than shown imperfectly.
--
-- get_public_job (0088) returns what the apply page renders, which is less than
-- that. This adds the four missing pieces:
--   * created_at    -> datePosted, which Google requires
--   * address_*     -> jobLocation, which needs a country to be eligible
--   * slug          -> the employer's own careers URL on the posting
--
-- Additive only. Both callers (api/apply.js and the apply screen) read fields
-- by name, so the new columns cannot disturb them. Recreated rather than
-- altered because a function's return type cannot be extended in place.
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_job(uuid);
create function public.get_public_job(p_job_id uuid)
returns table (id uuid, title text, status text, details jsonb, expires_at date,
               company_name text, logo_url text, accepting boolean,
               created_at timestamptz, company_slug text,
               address_city text, address_state text, address_country text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select j.id, j.title, j.status, j.details, j.expires_at, c.name, c.logo_url,
           public._company_accepting_applicants(j.company_id),
           j.created_at, c.slug,
           nullif(btrim(coalesce(c.address_city, '')), ''),
           nullif(btrim(coalesce(c.address_state, '')), ''),
           nullif(btrim(coalesce(c.address_country, '')), '')
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id
      and j.status <> 'draft'
      and c.deleted_at is null;
end $$;
grant execute on function public.get_public_job(uuid) to anon, authenticated;
