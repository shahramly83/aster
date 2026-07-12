-- ============================================================================
-- Aster — expose the company logo on the public apply page
-- ============================================================================
-- The public apply page (/apply/<jobId>) already renders the company's uploaded
-- logo when it has one, falling back to a generic mark + name. But get_public_job
-- never returned logo_url, so every public page showed the fallback even for
-- companies that had uploaded a logo.
--
-- Add logo_url to the return type. A function's return type can't be changed with
-- create or replace, so we drop and recreate. Signature (p_job_id) and every
-- existing behaviour (drafts excluded, suspended workspaces excluded, closed and
-- expired roles still resolve) are preserved.

drop function if exists public.get_public_job(uuid);

create function public.get_public_job(p_job_id uuid)
returns table (id uuid, title text, status text, details jsonb, expires_at date, company_name text, logo_url text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select j.id, j.title, j.status, j.details, j.expires_at, c.name, c.logo_url
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id
      and j.status <> 'draft'
      and c.deleted_at is null;
end $$;

grant execute on function public.get_public_job(uuid) to anon, authenticated;
