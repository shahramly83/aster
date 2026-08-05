-- ============================================================================
-- Aster — three gaps the end-to-end audit found, none of them cosmetic
-- ============================================================================
--
-- 1. jobs_interviewer_read let a suspended user keep reading their own jobs.
-- 2. The two screening-credit functions branched on the monthly cap without a
--    row lock, so two concurrent applications could both spend the free branch.
-- 3. The server's public-email-domain list had drifted behind the browser's.
--
-- ============================================================================


-- 1. RLS: created_by is not a substitute for tenancy -------------------------
--
-- 0073 widened this policy so an interviewer could see the roles THEY requested,
-- which request_job files as a draft with created_by = the requester. Its comment
-- reasoned that "created_by = auth.uid() is inherently self-scoped and
-- same-company, so this exposes nothing beyond the requester's own rows."
--
-- Self-scoped, yes. But the branch never consults current_company_id(), so it
-- also never re-checks the two things that function exists to check: that the
-- profile is still active, and that the company is not soft-deleted. Every other
-- policy revokes on the very next request when a teammate is removed (0043) or a
-- workspace lapses. This one kept returning the requester's job rows, including
-- the details jsonb that can hold salary and the full description.
--
-- Not a cross-tenant leak. But 0043 documents instant revocation as a guarantee,
-- and this quietly broke it. Scope the branch to the caller's live company.
drop policy if exists jobs_interviewer_read on public.jobs;
create policy jobs_interviewer_read on public.jobs for select
  using (
    id in (select public.assigned_job_ids())
    or (created_by = auth.uid() and company_id = public.current_company_id())
  );


-- 2. Take the lock before deciding the pool has room ------------------------
--
-- consume_ai_rank in 0087 already does `select ... for update`. These two never
-- did: they read usage_counters, decided "still under the monthly limit", and
-- only then incremented. Two applications landing together at the boundary both
-- read the stale count and both take the free monthly branch, so the company
-- gets screens it did not pay for.
--
-- The row has to exist before it can be locked, so insert-then-lock. Everything
-- else about these functions is unchanged.

create or replace function public.consume_resume_screen_for(p_company uuid)
returns table (ok boolean, source text, monthly_used int, monthly_limit int, purchased_balance int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_limit int; v_used int; v_bal int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  v_limit := public._resume_parse_limit((select plan from public.companies where id = p_company));

  -- Insert first so there is a row to lock, then lock it. Every concurrent caller
  -- for this company and period now queues here instead of racing the read.
  insert into public.usage_counters (company_id, period) values (p_company, v_period)
    on conflict (company_id, period) do nothing;
  select coalesce(resume_parsing, 0) into v_used
    from public.usage_counters where company_id = p_company and period = v_period for update;
  v_used := coalesce(v_used, 0);

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set resume_parsing = resume_parsing + 1
      where company_id = p_company and period = v_period returning resume_parsing into v_used;
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'resume_screen';
    return query select true, 'monthly'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;

  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = p_company and kind = 'resume_screen' and balance > 0
    returning balance into v_bal;
  if v_bal is null then
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'resume_screen';
    return query select false, 'none'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;
  return query select true, 'purchased'::text, v_used, v_limit, v_bal;
end $$;

create or replace function public.consume_applicant_screen_for(p_company uuid)
returns table (ok boolean, source text, monthly_used int, monthly_limit int, purchased_balance int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_limit int; v_used int; v_bal int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  v_limit := public._applicant_parse_limit((select plan from public.companies where id = p_company));

  insert into public.usage_counters (company_id, period) values (p_company, v_period)
    on conflict (company_id, period) do nothing;
  select coalesce(applicant_parsing, 0) into v_used
    from public.usage_counters where company_id = p_company and period = v_period for update;
  v_used := coalesce(v_used, 0);

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set applicant_parsing = applicant_parsing + 1
      where company_id = p_company and period = v_period returning applicant_parsing into v_used;
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'applicant_screen';
    return query select true, 'monthly'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;

  update public.purchased_credits set balance = balance - 1, updated_at = now()
    where company_id = p_company and kind = 'applicant_screen' and balance > 0 returning balance into v_bal;
  if v_bal is null then
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'applicant_screen';
    return query select false, 'none'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;
  return query select true, 'purchased'::text, v_used, v_limit, v_bal;
end $$;


-- 3. The work-email rule should not depend on which client you use ----------
--
-- The browser's CONSUMER_EMAIL_DOMAINS blocks hotmail.fr, qq.com, 163.com,
-- 126.com and naver.com. This function, last touched in 0019, does not. Anyone
-- calling signUp plus create_company_and_owner directly, bypassing the React
-- form, got the free 14-day trial the UI is built to refuse.
create or replace function public._is_public_email_domain(p text)
returns boolean language sql immutable as $$
  select lower(coalesce(p,'')) in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com',
    'yahoo.com','yahoo.co.uk','yahoo.co.in','ymail.com','rocketmail.com',
    'icloud.com','me.com','mac.com','proton.me','protonmail.com','pm.me',
    'aol.com','gmx.com','gmx.net','mail.com','yandex.com','yandex.ru',
    'zoho.com','fastmail.com','hey.com','tutanota.com','hotmail.co.uk',
    -- Added to match the browser's list, which had drifted ahead of this one.
    'hotmail.fr','qq.com','163.com','126.com','naver.com'
  );
$$;
