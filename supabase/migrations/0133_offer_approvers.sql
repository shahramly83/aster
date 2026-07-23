-- ============================================================================
-- 0133: standalone offer approvers (no account, no login)
-- ============================================================================
-- A managed list of people who can approve offers WITHOUT being workspace users.
-- HR adds them by email; they confirm once via an emailed link (no sign-up), and
-- from then on they can be picked as approvers on an offer and receive only the
-- approve/decline emails. Distinct from team members (profiles) and from the
-- per-offer approval chain (offer_approvals), which this list feeds into.
create table if not exists public.offer_approvers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  email         text not null,
  name          text,
  status        text not null default 'pending',              -- 'pending' | 'confirmed'
  confirm_token uuid not null default gen_random_uuid(),       -- emailed opt-in link
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);
-- One row per email per company (case-insensitive), so re-adding updates in place.
create unique index if not exists uq_offer_approvers_company_email
  on public.offer_approvers (company_id, lower(email));
create index if not exists idx_offer_approvers_confirm_token
  on public.offer_approvers (confirm_token);

alter table public.offer_approvers enable row level security;
drop policy if exists offer_approvers_company on public.offer_approvers;
create policy offer_approvers_company on public.offer_approvers for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- The confirm step is done by the approver-confirm edge function using the
-- service role (the approver has no session), so no public policy is needed.
