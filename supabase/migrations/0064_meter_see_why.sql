-- 0064_meter_see_why.sql
--
-- Make See-why chargeable from the server, like ai_rank / ai_insight (0046), so
-- the new see-why edge function can take the credit BEFORE calling Claude and
-- refund if the call fails. bump_see_why (0026) returned no `charged` flag, so a
-- server couldn't tell "took the last credit" from "refused at the cap". Recreate
-- it with `charged`, and add a service-role refund.

drop function if exists public.bump_see_why();

create function public.bump_see_why()
returns table (used int, monthly_limit int, resets_at date, charged boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_created timestamptz;
  v_period  text;
  v_reset   date;
  v_limit   int;
  v_used    int;
  v_charged boolean := false;
begin
  if v_company is null then raise exception 'no company' using errcode = '42501'; end if;
  select created_at into v_created from public.companies where id = v_company;
  select p.period, p.resets_at into v_period, v_reset from public._ai_rank_period(v_created) p;
  v_limit := public._see_why_limit((select plan from public.companies where id = v_company));

  insert into public.usage_counters (company_id, period)
    values (v_company, v_period)
    on conflict (company_id, period) do nothing;

  select see_why into v_used from public.usage_counters
    where company_id = v_company and period = v_period for update;

  if v_limit is null or v_used < v_limit then
    update public.usage_counters set see_why = see_why + 1
      where company_id = v_company and period = v_period
      returning see_why into v_used;
    v_charged := true;
  end if;

  return query select v_used, v_limit, v_reset, v_charged;
end $$;
grant execute on function public.bump_see_why() to authenticated;

create or replace function public.refund_see_why_for(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.usage_counters set see_why = greatest(see_why - 1, 0)
  where company_id = p_company
    and period = (select period from public._ai_rank_period(
                    (select created_at from public.companies where id = p_company)));
$$;
revoke all on function public.refund_see_why_for(uuid) from public, anon, authenticated;
grant execute on function public.refund_see_why_for(uuid) to service_role;
