-- ============================================================================
-- 0086: Purchased (top-up) credits, starting with resume screening (bulk upload)
-- ============================================================================
-- Companies can BUY extra credits on top of their monthly plan allowance. These
-- purchased credits are a persistent balance: they do NOT sit on the rolling
-- 30-day cycle and never reset on renewal. The monthly plan pool is always spent
-- first; only once it is exhausted do we draw down the purchased balance. So a
-- purchase is a durable buffer that kicks in exactly when the plan runs dry.
--
-- 'kind' namespaces the credit type so the same machinery can back other credits
-- later (ai_rank, ai_insight, ...). We start with 'resume_screen' (the bulk-upload
-- pool metered as usage_counters.resume_parsing in 0034).
--
-- Both tables hold billing state, so they are service_role only (no client
-- policies). The app reads its balance through get_purchased_credits(); the
-- parse-resume and stripe-webhook edge functions (service_role) consume and grant.

create table if not exists public.purchased_credits (
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null,
  balance     int  not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now(),
  primary key (company_id, kind)
);

-- Ledger of purchases, one row per paid Stripe checkout. stripe_session_id is
-- unique so a webhook that fires twice (Stripe retries) can't double-credit.
create table if not exists public.credit_purchase_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  kind              text not null,
  quantity          int  not null,
  amount_cents      int,
  currency          text,
  stripe_session_id text unique,
  created_at        timestamptz not null default now()
);

alter table public.purchased_credits   enable row level security;
alter table public.credit_purchase_log enable row level security;
revoke all on public.purchased_credits   from anon, authenticated;
revoke all on public.credit_purchase_log from anon, authenticated;

-- The signed-in company's purchased balances, for the usage meters. Read-only.
create or replace function public.get_purchased_credits()
returns table (kind text, balance int)
language sql security definer set search_path = public as $$
  select kind, balance from public.purchased_credits
   where company_id = public.current_company_id();
$$;
grant execute on function public.get_purchased_credits() to authenticated;

-- Grant purchased credits after a paid checkout. Idempotent on the Stripe session
-- id: a retried webhook logs nothing new and leaves the balance untouched.
-- service_role only (the webhook), so no grant to authenticated.
create or replace function public.grant_purchased_credits(
  p_company uuid, p_kind text, p_qty int,
  p_amount_cents int, p_currency text, p_session text
) returns int
language plpgsql security definer set search_path = public as $$
declare v_bal int; v_new_row boolean := false;
begin
  if p_company is null or p_qty is null or p_qty <= 0 then raise exception 'bad grant'; end if;
  insert into public.credit_purchase_log (company_id, kind, quantity, amount_cents, currency, stripe_session_id)
    values (p_company, p_kind, p_qty, p_amount_cents, p_currency, p_session)
    on conflict (stripe_session_id) do nothing;
  if not found then
    -- Already processed this session: return the current balance unchanged.
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = p_kind;
    return coalesce(v_bal, 0);
  end if;
  insert into public.purchased_credits (company_id, kind, balance) values (p_company, p_kind, p_qty)
    on conflict (company_id, kind) do update set balance = public.purchased_credits.balance + excluded.balance, updated_at = now()
    returning balance into v_bal;
  return v_bal;
end $$;

-- Consume ONE resume-screening credit for a company, monthly pool first then the
-- purchased balance. Returns which pool paid and the resulting figures so the
-- edge function can decide whether to proceed. service_role (parse-resume).
--   source: 'monthly' | 'purchased' | 'none' (nothing left → caller blocks)
create or replace function public.consume_resume_screen_for(p_company uuid)
returns table (ok boolean, source text, monthly_used int, monthly_limit int, purchased_balance int)
language plpgsql security definer set search_path = public as $$
declare v_created timestamptz; v_period text; v_limit int; v_used int; v_bal int;
begin
  select created_at into v_created from public.companies where id = p_company;
  if v_created is null then raise exception 'no company'; end if;
  select period into v_period from public._ai_rank_period(v_created);
  v_limit := public._resume_parse_limit((select plan from public.companies where id = p_company));
  select coalesce(resume_parsing, 0) into v_used
    from public.usage_counters where company_id = p_company and period = v_period;
  v_used := coalesce(v_used, 0);

  -- Unlimited plan, or the monthly pool still has room: spend a monthly credit.
  if v_limit is null or v_used < v_limit then
    insert into public.usage_counters (company_id, period) values (p_company, v_period)
      on conflict (company_id, period) do nothing;
    update public.usage_counters set resume_parsing = resume_parsing + 1
      where company_id = p_company and period = v_period returning resume_parsing into v_used;
    select balance into v_bal from public.purchased_credits where company_id = p_company and kind = 'resume_screen';
    return query select true, 'monthly'::text, v_used, v_limit, coalesce(v_bal, 0);
    return;
  end if;

  -- Monthly exhausted: draw one from the purchased balance if any remain.
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
