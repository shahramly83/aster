-- ============================================================================
-- Aster — editable transactional email templates (two-tier)
-- ============================================================================
-- Backs the two email tiers:
--
--   * TIER 1 — platform templates (scope = 'platform'): Aster → Company system
--     mail (billing, teammate invites, account notices). Edited ONLY by active
--     Aster staff (super/support) in /admin. Companies can never see or edit
--     these rows — there is deliberately no company policy that matches them.
--
--   * TIER 2 — company templates (scope = 'company'): a company's own hiring
--     lifecycle mail to applicants/candidates (application received, interview
--     invite, offer, hired, ...). Each row belongs to one company; owners/admins
--     of that company edit their own rows.
--
-- A row is an OVERRIDE, not the source of truth: the edge functions ship a
-- hardcoded default for every template key and only reach for a row when one
-- exists and is enabled. So a company that never customises still gets sane
-- default copy, and new companies need no seeding. Only the dynamic {{tokens}}
-- and the row's subject/body vary.
--
-- Edge functions read templates with the service role, which bypasses RLS, so
-- the policies below govern only interactive (customer/admin) access.
-- ============================================================================

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('platform','company')),
  company_id  uuid references public.companies(id) on delete cascade,
  key         text not null,           -- e.g. 'application_received'
  subject     text not null,
  -- The editable body. For company templates this is plain text with {{tokens}}
  -- (the edge function converts newlines to paragraphs and wraps it in the
  -- company-branded shell). For platform templates it is raw HTML.
  body        text not null,
  enabled     boolean not null default true,
  updated_by  uuid,                     -- auth.uid() of the last editor (admin or profile)
  updated_at  timestamptz not null default now(),
  -- platform rows carry no company; company rows must name one.
  constraint email_templates_scope_company_ck check (
    (scope = 'platform' and company_id is null) or
    (scope = 'company'  and company_id is not null)
  ),
  -- One row per key per company. Platform rows have company_id = null, and NULLs
  -- are distinct, so this never collides across platform rows; platform-key
  -- uniqueness is enforced by the partial index below. Naming the constraint
  -- lets the client upsert on (company_id, key).
  constraint uq_email_templates_company_key unique (company_id, key)
);

-- Exactly one platform row per key.
create unique index if not exists uq_email_templates_platform
  on public.email_templates (key) where scope = 'platform';
create index if not exists idx_email_templates_company
  on public.email_templates (company_id);

-- keep updated_at fresh (reuses the trigger fn from 0001)
drop trigger if exists trg_email_templates_touch on public.email_templates;
create trigger trg_email_templates_touch before update on public.email_templates
  for each row execute function public.touch_updated_at();

-- ---------- grants (RLS restricts rows; the grant enables the verb) ----------
grant select, insert, update, delete on public.email_templates to authenticated;

-- ---------- RLS ----------
alter table public.email_templates enable row level security;

-- TIER 1: platform templates are Aster-staff only (super/support). Invisible to
-- every company session (no company policy matches scope = 'platform').
drop policy if exists email_templates_platform_admin on public.email_templates;
create policy email_templates_platform_admin on public.email_templates for all
  using      (scope = 'platform' and public.current_admin_role() in ('super','support'))
  with check (scope = 'platform' and public.current_admin_role() in ('super','support'));

-- TIER 2: any member of the company may read its own templates (for preview)...
drop policy if exists email_templates_company_read on public.email_templates;
create policy email_templates_company_read on public.email_templates for select
  using (scope = 'company' and company_id = public.current_company_id());

-- ...but only owners/admins may create/update/delete them, and only for their
-- own company (with check pins scope + company_id so they can't spoof either).
drop policy if exists email_templates_company_write on public.email_templates;
create policy email_templates_company_write on public.email_templates for all
  using (
    scope = 'company' and company_id = public.current_company_id()
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('owner','admin'))
  )
  with check (
    scope = 'company' and company_id = public.current_company_id()
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('owner','admin'))
  );

-- ---------- admin-only upsert of a platform (Tier 1) template ----------
-- Company templates upsert directly (client, RLS-scoped) on the (company_id,key)
-- constraint. Platform rows key on a PARTIAL unique index the client can't name
-- in an upsert, and must be admin-gated, so they go through this definer RPC —
-- mirroring set_platform_flag.
create or replace function public.set_platform_email_template(
  p_key text, p_subject text, p_body text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_admin_role() not in ('super','support') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.email_templates (scope, company_id, key, subject, body, updated_by, updated_at)
    values ('platform', null, p_key, p_subject, p_body, auth.uid(), now())
  on conflict (key) where scope = 'platform'
    do update set subject = excluded.subject, body = excluded.body,
                  updated_by = auth.uid(), updated_at = now();
end $$;

revoke all on function public.set_platform_email_template(text, text, text) from public, anon;
grant execute on function public.set_platform_email_template(text, text, text) to authenticated;
