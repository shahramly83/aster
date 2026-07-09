-- ============================================================================
-- Aster — two-tier roles + job-scoped interviewers
-- ============================================================================
-- Collapses the customer-side roles to two effective tiers and scopes
-- interviewers down to the jobs they are assigned to:
--
--   * owner / admin  — the "hiring manager" tier. Full access to jobs,
--     candidates, applications, interviews and scorecards. `owner` is the
--     single billing anchor (one per company, cannot be demoted/removed).
--   * interviewer    — sees ONLY jobs assigned to them, and through those the
--     applicants and the shared panel of scorecards. Reads its assigned jobs,
--     writes only its own scorecard, and can signal "ready to schedule". No
--     job posting, no candidate search, no scheduling.
--   * recruiter      — retired. Any existing recruiter is promoted to admin so
--     nobody loses access; the enum value is left in place (Postgres cannot
--     cleanly drop it) but is no longer issued.
--
-- The linchpin is public.job_assignments: one row links an interviewer to a
-- job, and every interviewer permission is computed from it.
-- ============================================================================

-- Retire recruiter: fold any existing ones into the admin tier.
update public.profiles set role = 'admin' where role = 'recruiter';

-- ---------------------------------------------------------------------------
-- 1. Helpers — status-aware tenancy + role checks
-- ---------------------------------------------------------------------------
-- current_company_id() keeps the 0018 soft-delete exclusion and now also
-- requires the caller's profile to be active, so suspended / not-yet-accepted
-- members lose all data access immediately.
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.company_id
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid() and p.status = 'active' and c.deleted_at is null;
$$;

-- True when the caller is an active owner/admin of a live workspace.
create or replace function public.is_company_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.companies c on c.id = p.company_id
    where p.id = auth.uid() and p.status = 'active'
      and c.deleted_at is null and p.role in ('owner','admin')
  );
$$;

-- (assigned_job_ids() is defined in section 2, after job_assignments exists —
--  a language-sql function validates its body against the table at CREATE.)

-- ---------------------------------------------------------------------------
-- 2. Tables — assignments, invitations, schedule signals
-- ---------------------------------------------------------------------------

-- Interviewer <-> job. The single source of interviewer scope.
create table if not exists public.job_assignments (
  job_id      uuid not null references public.jobs(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (job_id, profile_id)
);

-- Pending teammate invites. Kept separate from profiles because an invitee has
-- no auth.users row yet (profiles.id references auth.users). accept_invite()
-- turns an invitation into a profile once they sign up.
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  email       text not null,
  role        profile_role not null default 'interviewer',
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (company_id, email)
);

-- "Interviewer says: this candidate is ready to schedule." Keeps interviewers
-- entirely off the applications table — a clean permission boundary.
create table if not exists public.schedule_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  requested_by   uuid not null references public.profiles(id) on delete cascade,
  note           text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_job_assignments_profile on public.job_assignments(profile_id);
create index if not exists idx_job_assignments_company  on public.job_assignments(company_id);
create index if not exists idx_invitations_company      on public.invitations(company_id);
create index if not exists idx_schedule_requests_company on public.schedule_requests(company_id);
create index if not exists idx_schedule_requests_app    on public.schedule_requests(application_id);

-- The set of job ids the caller (an interviewer) is assigned to. Used by every
-- interviewer policy below. SECURITY DEFINER so it bypasses RLS internally and
-- can't cause policy recursion. Defined here (not in section 1) because a
-- language-sql function validates its body against job_assignments at CREATE.
create or replace function public.assigned_job_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select ja.job_id
  from public.job_assignments ja
  join public.profiles p on p.id = ja.profile_id
  join public.companies c on c.id = ja.company_id
  where ja.profile_id = auth.uid()
    and p.status = 'active' and c.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 3. Data hygiene — best-effort backfill of scorecards.job_id
-- ---------------------------------------------------------------------------
-- Fill legacy null job_id from the candidate's application, then from any
-- interview for that candidate. We deliberately DO NOT enforce NOT NULL:
-- production has orphan scorecards (no application, no interview) and a null
-- job_id is already safe. The interviewer read/write policies key on
-- `job_id in (select assigned_job_ids())`, which never matches null, so such
-- rows stay visible to admins only, and an interviewer can never create a
-- null-job scorecard (their insert policy requires an assigned job_id).
update public.scorecards s set job_id = (
  select a.job_id from public.applications a
  where a.candidate_id = s.candidate_id and a.company_id = s.company_id
  order by a.created_at limit 1
) where s.job_id is null;
update public.scorecards s set job_id = (
  select i.job_id from public.interviews i
  where i.candidate_id = s.candidate_id and i.company_id = s.company_id and i.job_id is not null
  order by i.created_at limit 1
) where s.job_id is null;

-- ---------------------------------------------------------------------------
-- 4. Policy rewrite — split blanket company access into admin-full + int-scoped
-- ---------------------------------------------------------------------------
-- Drops the old "any member sees everything" policies from 0001 and replaces
-- them with an admin/owner full-access policy plus tight interviewer reads.

-- jobs
drop policy if exists jobs_company on public.jobs;
create policy jobs_admin on public.jobs for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy jobs_interviewer_read on public.jobs for select
  using (id in (select public.assigned_job_ids()));

-- candidates (no direct job link -> route through applications)
drop policy if exists candidates_company on public.candidates;
create policy candidates_admin on public.candidates for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy candidates_interviewer_read on public.candidates for select
  using (id in (
    select a.candidate_id from public.applications a
    where a.job_id in (select public.assigned_job_ids())
  ));

-- applications
drop policy if exists applications_company on public.applications;
create policy applications_admin on public.applications for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy applications_interviewer_read on public.applications for select
  using (job_id in (select public.assigned_job_ids()));

-- interviews (interviewer sees the schedule for assigned jobs + their own rows)
drop policy if exists interviews_company on public.interviews;
create policy interviews_admin on public.interviews for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy interviews_interviewer_read on public.interviews for select
  using (interviewer_id = auth.uid() or job_id in (select public.assigned_job_ids()));

-- scorecards: read the whole panel for assigned jobs, write only your own row
drop policy if exists scorecards_company on public.scorecards;
create policy scorecards_admin on public.scorecards for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy scorecards_interviewer_read on public.scorecards for select
  using (job_id in (select public.assigned_job_ids()));
create policy scorecards_interviewer_insert on public.scorecards for insert
  with check (interviewer_id = auth.uid() and job_id in (select public.assigned_job_ids()));
create policy scorecards_interviewer_update on public.scorecards for update
  using (interviewer_id = auth.uid() and job_id in (select public.assigned_job_ids()))
  with check (interviewer_id = auth.uid() and job_id in (select public.assigned_job_ids()));

-- ---------------------------------------------------------------------------
-- 5. RLS + grants for the new tables
-- ---------------------------------------------------------------------------
alter table public.job_assignments   enable row level security;
alter table public.invitations       enable row level security;
alter table public.schedule_requests enable row level security;

-- job_assignments: admins manage; an interviewer may read their own rows.
create policy job_assignments_admin on public.job_assignments for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy job_assignments_self_read on public.job_assignments for select
  using (profile_id = auth.uid());

-- invitations: admins only (accept happens via SECURITY DEFINER RPC by token).
create policy invitations_admin on public.invitations for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());

-- schedule_requests: admins see/manage all; interviewer inserts + reads own.
create policy schedule_requests_admin on public.schedule_requests for all
  using (company_id = public.current_company_id() and public.is_company_admin())
  with check (company_id = public.current_company_id() and public.is_company_admin());
create policy schedule_requests_self_read on public.schedule_requests for select
  using (requested_by = auth.uid());
create policy schedule_requests_self_insert on public.schedule_requests for insert
  with check (
    requested_by = auth.uid()
    and application_id in (
      select a.id from public.applications a
      where a.job_id in (select public.assigned_job_ids())
    )
  );

grant select, insert, update, delete on
  public.job_assignments, public.invitations, public.schedule_requests
  to authenticated;
grant execute on function public.is_company_admin(), public.assigned_job_ids()
  to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. Owner protection — never leave a workspace without an active owner
-- ---------------------------------------------------------------------------
create or replace function public.protect_owner()
returns trigger language plpgsql as $$
begin
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then
    if (select count(*) from public.profiles
        where company_id = old.company_id and role = 'owner' and status = 'active') <= 1 then
      raise exception 'cannot remove the sole workspace owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_owner on public.profiles;
create trigger trg_protect_owner before update on public.profiles
  for each row execute function public.protect_owner();

-- ---------------------------------------------------------------------------
-- 7. RPCs — invite, accept, assign, request scheduling
-- ---------------------------------------------------------------------------

-- Admin invites a teammate. Enforces seats (active members + pending invites
-- must stay within subscriptions.seats). Returns the invite token; email
-- delivery is wired separately.
create or replace function public.invite_teammate(
  p_email text,
  p_role  profile_role default 'interviewer'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_email   text := lower(trim(p_email));
  v_seats   int;
  v_used    int;
  v_token   uuid;
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if p_role not in ('admin','interviewer') then
    raise exception 'role must be admin or interviewer' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles
             where company_id = v_company and lower(email) = v_email) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  select coalesce(seats, 1) into v_seats from public.subscriptions where company_id = v_company;
  v_seats := coalesce(v_seats, 1);
  select (select count(*) from public.profiles
            where company_id = v_company and status = 'active')
       + (select count(*) from public.invitations
            where company_id = v_company and accepted_at is null and expires_at > now())
    into v_used;
  if v_used >= v_seats then
    raise exception 'seat limit reached' using errcode = 'P0001';
  end if;

  insert into public.invitations (company_id, email, role, invited_by)
  values (v_company, v_email, p_role, auth.uid())
  on conflict (company_id, email) do update
    set role        = excluded.role,
        invited_by  = excluded.invited_by,
        token       = gen_random_uuid(),
        expires_at  = now() + interval '7 days',
        accepted_at = null,
        created_at  = now()
  returning token into v_token;

  return v_token;
end $$;

-- Invitee (already signed up) redeems a token and becomes a member. Refuses if
-- they already have a profile, if the token is bad/expired, or if their auth
-- email doesn't match the invitation.
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.invitations;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  select * into v_inv from public.invitations
    where token = p_token and accepted_at is null and expires_at > now();
  if v_inv.id is null then
    raise exception 'invite invalid or expired' using errcode = 'P0002';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'invite is for a different email' using errcode = '42501';
  end if;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (v_uid, v_inv.company_id, v_email, v_email, v_inv.role, 'active');

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.company_id;
end $$;

-- Admin assigns / unassigns an interviewer to a job. Removal is immediate;
-- already-submitted scorecards are retained (they're the hiring record).
create or replace function public.assign_interviewer(p_job_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id and company_id = v_company) then
    raise exception 'job not in this workspace' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and company_id = v_company) then
    raise exception 'person not in this workspace' using errcode = 'P0002';
  end if;
  insert into public.job_assignments (job_id, profile_id, company_id, assigned_by)
  values (p_job_id, p_profile_id, v_company, auth.uid())
  on conflict (job_id, profile_id) do nothing;
end $$;

create or replace function public.unassign_interviewer(p_job_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.job_assignments
    where job_id = p_job_id and profile_id = p_profile_id and company_id = v_company;
end $$;

-- Interviewer flags a candidate as ready for the hiring manager to schedule.
-- Only for applications on a job they are assigned to.
create or replace function public.request_scheduling(p_application_id uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.applications
    where id = p_application_id and job_id in (select public.assigned_job_ids());
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;

  insert into public.schedule_requests (company_id, application_id, requested_by, note)
  values (v_company, p_application_id, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.invite_teammate(text, profile_role)   from public, anon;
revoke all on function public.assign_interviewer(uuid, uuid)        from public, anon;
revoke all on function public.unassign_interviewer(uuid, uuid)      from public, anon;
grant execute on function
  public.invite_teammate(text, profile_role),
  public.accept_invite(uuid),
  public.assign_interviewer(uuid, uuid),
  public.unassign_interviewer(uuid, uuid),
  public.request_scheduling(uuid, text)
  to authenticated;
