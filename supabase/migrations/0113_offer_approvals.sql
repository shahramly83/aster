-- ============================================================================
-- 0113: sequential offer-approval workflow
-- ============================================================================
-- Before an offer is sent to the candidate, it can require internal sign-off from
-- one or more approvers, IN ORDER. The hiring manager adds approver emails; each
-- approver receives the offer letter and Approves or Declines (with a reason).
-- On approval the next approver is emailed; on the final approval the offer is
-- sent to the candidate (Aster Sign). A decline halts the chain and the manager
-- can revise + resubmit, or close the offer. Approval applies to offers only.

-- Pre-send state on the offer. null = no approval needed (sent directly).
alter table public.offers add column if not exists approval_status text;   -- null | pending | approved | declined

-- One row per approver in the sequence.
create table if not exists public.offer_approvals (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.offers(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  step           int  not null,                              -- 1-based order
  approver_email text not null,
  approver_name  text,
  token          uuid not null default gen_random_uuid(),    -- public approval-page link
  status         text not null default 'pending',            -- pending | approved | declined
  reason         text,                                        -- decline reason
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists uq_offer_approvals_token   on public.offer_approvals (token);
create index        if not exists idx_offer_approvals_offer  on public.offer_approvals (offer_id);
create index        if not exists idx_offer_approvals_company on public.offer_approvals (company_id);

grant select, insert, update, delete on public.offer_approvals to authenticated;
alter table public.offer_approvals enable row level security;

-- Company-scoped, like the offers table. The public approval page never reads
-- this directly; the offer-approval edge function (service role) does.
drop policy if exists offer_approvals_company on public.offer_approvals;
create policy offer_approvals_company on public.offer_approvals for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
