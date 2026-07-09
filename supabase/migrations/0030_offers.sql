-- ============================================================================
-- Aster — offers (public candidate accept / decline)
-- ============================================================================
-- Makes the offer stage real. When HR sends an offer the app inserts an offers
-- row with a public token; the candidate opens /offer/<token> (no login),
-- previews it via offer_preview, and accepts or declines. The response + the
-- resulting emails (offer-accepted → company, welcome → candidate) run in the
-- respond-offer edge function (service role), so the public page never touches
-- the offers table directly. Mirrors the interview-booking design (0029).
-- ============================================================================

create table if not exists public.offers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  token        uuid not null default gen_random_uuid(),
  status       text not null default 'sent',   -- 'sent' | 'accepted' | 'declined'
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_offers_token   on public.offers (token);
create index if not exists idx_offers_company        on public.offers (company_id);
create index if not exists idx_offers_candidate      on public.offers (candidate_id);

grant select, insert, update, delete on public.offers to authenticated;

alter table public.offers enable row level security;

-- Company-only, like the other candidate-adjacent tables (no admin policy).
drop policy if exists offers_company on public.offers;
create policy offers_company on public.offers for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Public preview of a pending offer, so /offer/<token> can render without a
-- login. SECURITY DEFINER (offers is company-only under RLS); the job title is
-- resolved from the candidate's most recent application. Zero rows for an
-- unknown token.
create or replace function public.offer_preview(p_token uuid)
returns table (company_name text, logo_url text, job_title text, status text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url,
    (select j.title
       from public.applications a
       join public.jobs j on j.id = a.job_id
      where a.candidate_id = o.candidate_id and a.company_id = o.company_id
      order by a.created_at desc limit 1),
    o.status
  from public.offers o
  join public.companies c on c.id = o.company_id
  where o.token = p_token;
$$;

revoke all on function public.offer_preview(uuid) from public;
grant execute on function public.offer_preview(uuid) to anon, authenticated;
