-- 0136_offer_email_sent.sql
-- Record whether an offer was emailed to the candidate (true) or only recorded
-- internally because they have no email on file (false). Lets the Decision panel
-- restore the manual "Mark accepted / Mark declined" controls and the correct
-- status label after a reload, instead of assuming every offer was emailed.

alter table public.offers
  add column if not exists email_sent boolean not null default true;
