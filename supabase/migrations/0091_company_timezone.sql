-- ============================================================================
-- 0091: Per-company timezone
-- ============================================================================
-- Interview times are stored in UTC, but every surface (the in-app panel and the
-- candidate/interviewer emails) must render them through ONE company timezone so
-- they always agree, whatever zone the viewer or recipient happens to be in.
-- Before this, emails hardcoded Asia/Kuala_Lumpur and the panel used the viewer's
-- browser zone, which drift apart. Store the company's IANA zone once and read it
-- everywhere. Captured from the browser at signup; editable in Settings.

alter table public.companies
  add column if not exists timezone text not null default 'Asia/Kuala_Lumpur';
