-- ============================================================================
-- Aster — private resume storage + feature-flag seed
-- ============================================================================

-- Private bucket for resumes. Files are stored under a per-company folder:
--   resumes/{company_id}/{candidate_id}.pdf
-- so the first path segment is the tenant boundary.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Only members of a company may touch that company's resume files.
-- There is deliberately NO admin policy here, so Aster admins cannot read
-- resumes even with a valid session.
create policy "resumes read own company"   on storage.objects for select
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "resumes write own company"  on storage.objects for insert
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "resumes update own company" on storage.objects for update
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "resumes delete own company" on storage.objects for delete
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = public.current_company_id()::text);

-- Seed feature flags (safe: no dependency on auth). Idempotent.
insert into public.feature_flags (key, label, description, enabled, rollout, environment) values
  ('ai_dedup_v2',         'AI dedup v2',             'Second-gen deduplication across old and new CVs.',    true,  100, 'prod'),
  ('voice_screening',     'Voice screening (beta)',  'AI voice interview for phone-screen replacement.',    false, 15,  'prod'),
  ('career_site_builder', 'Career site builder',     'Hosted branded careers page and job board.',          true,  100, 'prod'),
  ('whatsapp_scheduling', 'WhatsApp scheduling',     'Candidate self-booking over WhatsApp.',               true,  60,  'prod'),
  ('advanced_analytics',  'Advanced analytics',      'Custom funnel reports and cohort breakdowns.',        false, 30,  'prod'),
  ('sso_scim',            'SSO + SCIM provisioning', 'Enterprise SSO and directory sync.',                  true,  100, 'prod'),
  ('new_billing_ui',      'New billing UI',          'Redesigned in-app billing and invoices.',             false, 0,   'staging'),
  ('ranked_reasons_v3',   'Ranked reasons v3',       'Richer explanations on every match score.',           false, 5,   'prod')
on conflict (key) do nothing;
