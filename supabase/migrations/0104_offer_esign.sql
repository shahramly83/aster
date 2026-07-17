-- ============================================================================
-- 0104: e-signature (DocuSign) tracking on offers
-- ============================================================================
-- When HR sends an offer for signature, we create a DocuSign envelope and track
-- it on the offer. The DocuSign Connect webhook flips esign_status as the
-- candidate views/signs, and stores the completed PDF in a private bucket.
alter table public.offers add column if not exists esign_provider   text;   -- 'docusign'
alter table public.offers add column if not exists esign_envelope_id text;
alter table public.offers add column if not exists esign_status      text;   -- 'sent' | 'delivered' | 'completed' | 'declined' | 'voided'
alter table public.offers add column if not exists signed_pdf_path   text;   -- storage path of the completed signed PDF

create index if not exists idx_offers_envelope on public.offers (esign_envelope_id);

-- Private bucket for signed offer letters. Only the service role (edge functions)
-- reads/writes it; the app hands out short-lived signed URLs when HR downloads.
insert into storage.buckets (id, name, public)
values ('offer-letters', 'offer-letters', false)
on conflict (id) do nothing;

-- Surface the e-sign status on the public preview so /offer/<token> can reflect
-- "signature requested" instead of the plain accept/decline buttons.
drop function if exists public.offer_preview(uuid);
create or replace function public.offer_preview(p_token uuid)
returns table (
  company_name text, logo_url text, job_title text, status text,
  base_salary numeric, salary_currency text, employment_type text,
  start_date date, expires_at date, esign_provider text, esign_status text
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
    o.start_date, o.expires_at, o.esign_provider, o.esign_status
  from public.offers o
  join public.companies c on c.id = o.company_id
  where o.token = p_token;
$$;
revoke all on function public.offer_preview(uuid) from public;
grant execute on function public.offer_preview(uuid) to anon, authenticated;
