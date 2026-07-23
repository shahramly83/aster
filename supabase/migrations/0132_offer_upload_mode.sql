-- ============================================================================
-- 0132: "Upload our letter" mode for offers
-- ============================================================================
-- Offers gain two send modes:
--   'compose' (default / null) — Aster generates the letter from structured terms
--                                and the candidate signs it (existing behaviour).
--   'upload'                    — HR uploads their own finished offer PDF (their
--                                letterhead, wording, company signature already
--                                printed), places one "candidate signs here" box,
--                                and the candidate signs into that box. No terms.
-- The uploaded source PDF lives in the existing private 'offer-letters' bucket
-- alongside the signed output.
alter table public.offers add column if not exists offer_mode      text;   -- 'compose' | 'upload' ; null ⇒ 'compose'
alter table public.offers add column if not exists source_pdf_path text;   -- storage path of the HR-uploaded source PDF
alter table public.offers add column if not exists sign_field      jsonb;  -- { page:int (0-based), x,y,w,h : 0..1, origin:'top-left' }

-- Surface the mode on the public preview so /offer/<token> knows whether to
-- render the composed letter or fetch the uploaded PDF. Terms columns already
-- return NULL for upload offers, so the tuple only grows by offer_mode.
drop function if exists public.offer_preview(uuid);
create or replace function public.offer_preview(p_token uuid)
returns table (
  company_name text, logo_url text, job_title text, status text,
  base_salary numeric, salary_currency text, employment_type text,
  start_date date, expires_at date, esign_provider text, esign_status text,
  offer_mode text
)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url,
    coalesce(o.offer_job_title, (
      select j.title
        from public.applications a
        join public.jobs j on j.id = a.job_id
       where a.candidate_id = o.candidate_id and a.company_id = o.company_id
       order by a.created_at desc limit 1)),
    o.status,
    o.base_salary, o.salary_currency, o.employment_type,
    o.start_date, o.expires_at, o.esign_provider, o.esign_status,
    o.offer_mode
  from public.offers o
  join public.companies c on c.id = o.company_id
  where o.token = p_token;
$$;
revoke all on function public.offer_preview(uuid) from public;
grant execute on function public.offer_preview(uuid) to anon, authenticated;

-- Storage policies for the source upload. The bucket had no client policies
-- (only the service role touched it). HR needs to (a) upload their source PDF
-- into their company folder and (b) read it back while placing the signature
-- box. Reads are scoped to '*-source.pdf' so the SIGNED PDFs stay reachable
-- only through the service-role 'offer-signed-url' function, unchanged.
create policy "offer-letters write own company" on storage.objects for insert
  with check (
    bucket_id = 'offer-letters'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );
create policy "offer-letters read own source" on storage.objects for select
  using (
    bucket_id = 'offer-letters'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and name like '%-source.pdf'
  );
