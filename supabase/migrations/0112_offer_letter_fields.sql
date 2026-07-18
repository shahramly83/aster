-- ============================================================================
-- 0112: extra fields for a standard prose offer letter
-- ============================================================================
-- The offer letter now reads as a normal business letter (terms woven into
-- prose, no key-value table), so it needs a named company signatory and a couple
-- of optional details that a real letter of offer carries. All optional.
alter table public.offers add column if not exists signatory_name  text;   -- who signs on behalf of the company
alter table public.offers add column if not exists signatory_title text;   -- their designation, e.g. "HR Manager"
alter table public.offers add column if not exists reporting_to    text;   -- optional: manager / role the hire reports to
alter table public.offers add column if not exists work_location   text;   -- optional: place of work
