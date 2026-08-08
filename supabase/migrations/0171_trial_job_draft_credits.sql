-- ============================================================================
-- 0171: three free AI job drafts for every trial
-- ============================================================================
-- AI job drafting is the one feature no plan includes (0170), so a trialling
-- workspace has no way to find out whether it is any good before being asked to
-- pay for it. Three drafts is enough to write a couple of real postings and
-- decide.
--
-- Granted into purchased_credits, which means they behave exactly like bought
-- ones: they never expire and they carry across the upgrade, in line with the
-- rule that a credit already given is not taken back. A trial that never
-- converts keeps three unused drafts, which costs nothing.
--
-- Done as a trigger on the subscription row rather than by editing
-- create_company_and_owner: that function is long, provisioning is the one path
-- where a mistake locks a new customer out entirely, and this needs none of its
-- internals.
--
-- Idempotent: safe to re-run, and the grant itself cannot double up because the
-- insert does nothing when a row for (company, kind) already exists.

create or replace function public.grant_trial_job_drafts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'trialing' then
    insert into public.purchased_credits (company_id, kind, balance, updated_at)
    values (new.company_id, 'job_draft', 3, now())
    on conflict (company_id, kind) do nothing;   -- never top up an existing balance
  end if;
  return new;
end $$;

drop trigger if exists trg_grant_trial_job_drafts on public.subscriptions;
create trigger trg_grant_trial_job_drafts
  after insert on public.subscriptions
  for each row execute function public.grant_trial_job_drafts();

-- Backfill the trials that already exist. `do nothing` on conflict means a
-- workspace that has already bought (or been given) job-draft credits keeps
-- exactly what it has rather than being topped up to three.
insert into public.purchased_credits (company_id, kind, balance, updated_at)
select s.company_id, 'job_draft', 3, now()
  from public.subscriptions s
  join public.companies c on c.id = s.company_id
 where s.status = 'trialing' and c.deleted_at is null
on conflict (company_id, kind) do nothing;
