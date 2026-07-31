-- ============================================================================
-- Aster — an unchecked domain keeps its trial
-- ============================================================================
-- 0148 denied a trial to any domain without a row in domain_site_checks, on the
-- reasoning that the signup form always warms the cache first, so a missing row
-- means the form was bypassed.
--
-- That is true, and it is still the wrong default. It makes an outage of the
-- check-domain-site function silently deny EVERY legitimate signup its trial and
-- drop it on a suspended, pay-first workspace, with nothing on screen to explain
-- why. Nobody would notice until the signups stopped converting.
--
-- Weigh the two failures. Ours costs real customers who did nothing wrong and
-- leaves no trace. Theirs lets a determined abuser skip the form for a trial
-- they can already obtain today. The first is worse, so only an explicit
-- "no site" now denies a trial.
--
-- The abuse this was built for is unaffected: that signup came through the form,
-- which writes the row, which says false.
-- ============================================================================

create or replace function public._domain_has_site(p_domain text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.domain_trial_allowlist where domain = lower(trim(coalesce(p_domain, '')))),
    (select has_site from public.domain_site_checks   where domain = lower(trim(coalesce(p_domain, '')))),
    true
  );
$$;
