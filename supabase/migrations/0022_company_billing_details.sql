-- ============================================================================
-- Aster — company branding + billing details
-- ============================================================================
-- Turns the Profile → Company details card from a mock into a real, persisted
-- surface:
--   * logo_url        — public URL of the uploaded logo (public `logos` bucket)
--   * address         — billing address, shown on invoices
--   * registration_no — company / business registration number, for billing
--
-- Writes go through update_company_details(), a SECURITY DEFINER RPC that only
-- owners and admins may call. That RPC touches ONLY these four columns, so a
-- customer can never escalate their own plan/status by writing companies
-- directly — which is why there is deliberately no customer UPDATE policy on
-- public.companies (the admin-super policy from 0001 still governs plan/status).
-- ============================================================================

alter table public.companies
  add column if not exists logo_url        text,
  add column if not exists address         text,
  add column if not exists registration_no text;

-- ---------- owner/admin self-service update of branding + billing ----------
create or replace function public.update_company_details(
  p_name            text,
  p_address         text,
  p_registration_no text,
  p_logo_url        text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_role    profile_role;
begin
  if v_company is null then
    raise exception 'no company for this session' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins can edit company details' using errcode = '42501';
  end if;

  update public.companies
     set name            = coalesce(nullif(btrim(p_name), ''), name),
         address         = nullif(btrim(p_address), ''),
         registration_no = nullif(btrim(p_registration_no), ''),
         logo_url        = nullif(btrim(p_logo_url), '')
   where id = v_company;
end $$;

grant execute on function public.update_company_details(text, text, text, text) to authenticated;

-- ---------- public logos bucket ----------
-- Logos render on the sidebar, the mobile header AND the public careers/apply
-- page (no session), so read must be public. Files live under a per-company
-- folder so the first path segment is the tenant boundary for writes:
--   logos/{company_id}/logo
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "logos public read"        on storage.objects for select
  using (bucket_id = 'logos');
create policy "logos write own company"  on storage.objects for insert
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "logos update own company" on storage.objects for update
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "logos delete own company" on storage.objects for delete
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.current_company_id()::text);
