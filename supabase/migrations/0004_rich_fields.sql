-- ============================================================================
-- Aster — rich prototype fields
-- ============================================================================
-- The app renders detailed jobs (salary, responsibilities, benefits…) and fully
-- parsed resumes (experience, education, languages…). Rather than normalise
-- every one of those into columns, we keep the queryable scalars that already
-- exist and stash the rich, display-only shape in a jsonb blob per row, so the
-- UI can render exactly what it renders today. All additive + idempotent.

-- Jobs: the full posting (department, location, salary_*, description,
-- responsibilities[], requirements[], benefits[]) lives here.
alter table public.jobs
  add column if not exists details jsonb not null default '{}'::jsonb;

-- Candidates: the parsed-resume object the profile/list screens read, plus the
-- import-screen metadata (original file name, parse status, whether a photo
-- was extracted). full_name/email/etc. columns still hold the scalar copy.
alter table public.candidates
  add column if not exists parsed    jsonb,
  add column if not exists file_name text,
  add column if not exists status    text not null default 'parsed',
  add column if not exists has_photo boolean not null default false;

-- Applications: where the applicant came from (drives the source donut).
alter table public.applications
  add column if not exists source text;

-- Interviews: which calendar the invite went out on (google | microsoft).
alter table public.interviews
  add column if not exists provider text not null default 'google';
