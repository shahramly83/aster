-- ============================================================================
-- 0033: Drop the broken "require aal2 when mfa enrolled" RLS policy
-- ============================================================================
-- A RESTRICTIVE policy of this name was added directly in the database (not via
-- these migrations) to public.candidates (and possibly other tables). Its
-- expression reads auth.mfa_factors, which the `authenticated` role is not
-- granted to read, so every affected SELECT failed with
-- "permission denied for table mfa_factors" and the app saw zero candidates
-- (dashboard, Candidate Search and imports all empty) even though the rows
-- existed and the user was the company owner.
--
-- The intent (require a completed MFA session for users who enrolled MFA) is
-- reasonable, but as written it denies ALL authenticated users because the read
-- of auth.mfa_factors itself fails. Aster already enforces 2FA at login, so this
-- drops the broken per-table policy. To re-add per-table MFA enforcement
-- correctly, gate on a SECURITY DEFINER helper (which may read auth.mfa_factors)
-- instead of reading the table directly from the policy.

do $$
declare r record;
begin
  for r in
    select schemaname, tablename
    from pg_policies
    where policyname = 'require aal2 when mfa enrolled'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   'require aal2 when mfa enrolled', r.schemaname, r.tablename);
  end loop;
end $$;
