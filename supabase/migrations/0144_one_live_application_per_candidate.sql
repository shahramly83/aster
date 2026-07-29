-- ============================================================================
-- 0144: one live application per candidate per company, enforced by the database
-- ============================================================================
-- The rule already existed, but only inside parse-application: the public apply
-- page checked it, and nothing else did. Any other write path — an importer, a
-- new "move candidate to another role" feature, a hand-written UPDATE — could
-- create a second live application silently, with no error and no warning, and
-- the rule would simply stop holding from that day on.
--
-- This puts the rule in the table itself, so it holds no matter who writes.
--
-- "Live" means anything except rejected and declined. Rejected: the company
-- closed that door. Declined: the candidate did. Either way nobody is waiting on
-- anybody, so the person is free to apply for something else, and those rows are
-- excluded from the index rather than blocking future applications forever.
--
-- Accepted cost, decided deliberately: this applies to recruiters too. Inviting
-- someone who already has a live application to a second role will now fail. A
-- unique index cannot tell a considered invitation from a candidate applying
-- everywhere, and the protection above was judged worth that.
--
-- Prerequisite handled before this ran: Marcus Lim held two live applications
-- (Backend Engineer, interviewing + Senior Frontend Engineer, applied). The
-- less advanced one was rejected, since an index cannot be created over data
-- that already breaks it.

create unique index if not exists one_live_application_per_candidate
  on public.applications (company_id, candidate_id)
  where stage not in ('rejected', 'declined');

comment on index public.one_live_application_per_candidate is
  'A candidate may hold at most one application that is not rejected or declined, per company. parse-application still checks this first so a public applicant gets a readable message; this is the backstop that makes the rule true for every other write path.';
