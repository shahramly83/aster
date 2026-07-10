// Supabase Edge Function: stripe-webhook
// ---------------------------------------------------------------------------
// Receives Stripe events, verifies the signature, and syncs billing state:
//   subscriptions.status : active | past_due | canceled
//   subscriptions.plan   : DB plan_tier enum (launch|scale|elite|enterprise)
//   subscriptions.current_period_end, stripe ids
//   companies.status     : active (paid, clears soft-delete) | churned (cancelled)
//
// Secrets: STRIPE_WEBHOOK_SECRET (the signing secret from the Stripe webhook)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Extracted so it can be unit-tested against forged signatures. See
// _shared/stripe-sig.test.ts — this function guards "mark this workspace paid".
import { verify } from "../_shared/stripe-sig.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Since migration 0040 the app plan key and the plan_tier enum are the same
// vocabulary, so metadata.plan is written straight through. Guard anyway: a
// stale checkout session created before 0040 must not poison the enum.
const PLAN_TIERS = new Set(["launch", "scale", "elite", "enterprise"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const sig = req.headers.get("stripe-signature") || "";
  if (!secret) return json({ error: "webhook not configured" }, 503);
  if (!(await verify(raw, sig, secret))) return json({ error: "invalid signature" }, 401);

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const type: string = evt.type || "";
  const obj = evt.data?.object || {};
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Claim the event id before doing any work. Every write below is an idempotent
  // UPDATE to a fixed value, so a replay cannot double-credit — but it CAN
  // re-flip companies.status to 'active' and clear deleted_at, resurrecting a
  // workspace suspended for a lapsed trial or a cancelled subscription.
  //
  // The claim is released on every failure path (see `fail` below). Leaving it in
  // place would make Stripe's retry look like a duplicate and skip it, which is
  // precisely the dropped-payment bug we just fixed by returning 500.
  const eventId: string = evt.id || "";
  if (eventId) {
    const { error: claimErr } = await admin.from("stripe_events").insert({ id: eventId, type });
    if (claimErr) {
      if (claimErr.code === "23505") return json({ ok: true, duplicate: true, type });  // already handled
      console.error("stripe_events claim", claimErr.message);
      return json({ error: "dedupe unavailable" }, 500);   // fail closed: let Stripe retry
    }
  }
  const release = async () => { if (eventId) await admin.from("stripe_events").delete().eq("id", eventId); };
  const fail = async (msg: string, detail?: string) => { await release(); return json({ error: msg, detail }, 500); };

  // Resolve which company + what changed, per event type.
  let companyId: string | null = null;
  let status: "active" | "past_due" | "canceled" | null = null;
  let planKey: string | null = null;
  let cycle: string | null = null;
  let periodEnd: string | null = null;
  let stripeSubId: string | null = null;
  let stripeCustId: string | null = null;

  const meta = obj.metadata || {};

  if (type === "checkout.session.completed") {
    companyId = obj.client_reference_id || meta.company_id || null;
    stripeSubId = obj.subscription || null;
    stripeCustId = obj.customer || null;
    planKey = meta.plan || null;
    cycle = meta.cycle || null;
    status = "active";
  } else if (type.startsWith("customer.subscription.")) {
    companyId = meta.company_id || null;
    stripeSubId = obj.id || null;
    stripeCustId = obj.customer || null;
    planKey = meta.plan || null;
    cycle = meta.cycle || null;
    periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString().slice(0, 10) : null;
    if (type === "customer.subscription.deleted") status = "canceled";
    else if (["active", "trialing"].includes(obj.status)) status = "active";
    else if (["past_due", "unpaid", "incomplete"].includes(obj.status)) status = "past_due";
    else if (obj.status === "canceled") status = "canceled";
  } else if (type === "invoice.paid") {
    stripeSubId = obj.subscription || null;
    stripeCustId = obj.customer || null;
    status = "active";
  } else if (type === "invoice.payment_failed") {
    stripeSubId = obj.subscription || null;
    stripeCustId = obj.customer || null;
    status = "past_due";
  } else {
    return json({ ok: true, ignored: type });
  }

  // Fallback: resolve company via stored stripe ids when metadata is absent.
  if (!companyId && (stripeSubId || stripeCustId)) {
    let q = admin.from("subscriptions").select("company_id");
    q = stripeSubId ? q.eq("stripe_subscription_id", stripeSubId) : q.eq("stripe_customer_id", stripeCustId!);
    const { data: row } = await q.maybeSingle();
    companyId = row?.company_id || null;
  }
  // 200 here meant Stripe never retried. But invoice.paid can arrive BEFORE
  // checkout.session.completed, so the subscriptions row has no stripe ids yet
  // and the fallback lookup finds nothing — a real payment, silently ignored
  // forever. Fail instead: the retry succeeds once the session event lands.
  // A genuinely orphaned event just retries for 3 days and is then dropped by
  // Stripe, which is the correct end state and is logged either way.
  if (!companyId) { console.error("no company for event", { type, stripeSubId, stripeCustId }); return await fail("no company for event"); }

  const planEnum = planKey && PLAN_TIERS.has(planKey) ? planKey : null;

  const subUpdate: Record<string, unknown> = {};
  if (stripeSubId) subUpdate.stripe_subscription_id = stripeSubId;
  if (stripeCustId) subUpdate.stripe_customer_id = stripeCustId;
  if (status) subUpdate.status = status;
  if (planEnum) subUpdate.plan = planEnum;
  if (cycle) subUpdate.cycle = cycle;
  if (periodEnd) subUpdate.current_period_end = periodEnd;
  // Every write below used to have its error discarded, and the function returned
  // 200 regardless. Stripe treats 2xx as "handled" and never retries, so a failed
  // write — an unknown plan_tier label, a transient outage — silently dropped a
  // real payment: money taken, subscription never activated, no second chance.
  // Return 5xx instead and let Stripe's retry schedule do its job. Every write
  // here is an idempotent UPDATE to a fixed value, so replaying is safe.
  if (Object.keys(subUpdate).length) {
    const { error } = await admin.from("subscriptions").update(subUpdate).eq("company_id", companyId);
    if (error) { console.error("subscriptions update", error.message, subUpdate); return await fail("subscription update failed", error.message); }
  }

  if (status === "active") {
    const companyUpdate: Record<string, unknown> = { status: "active", deleted_at: null, purge_after: null };
    if (planEnum) companyUpdate.plan = planEnum;
    const { error } = await admin.from("companies").update(companyUpdate).eq("id", companyId);
    if (error) { console.error("companies activate", error.message, companyUpdate); return await fail("company update failed", error.message); }
  } else if (status === "canceled") {
    // Setting status alone revoked nothing: companies.status is read by no policy,
    // and the tenancy layer keys off deleted_at. A cancelled customer kept full
    // access forever, for free. Stamp the same 30-day soft-delete window a lapsed
    // trial gets (0036), so they land on the existing paywall, can resubscribe
    // (the activate branch above clears these), and are purged if they don't.
    // 0045 stops restore_workspace() from letting them undo this with one click.
    const purgeAfter = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { error } = await admin.from("companies")
      .update({ status: "churned", deleted_at: new Date().toISOString(), purge_after: purgeAfter })
      .eq("id", companyId).is("deleted_at", null);   // don't slide the purge date on a repeat event
    if (error) { console.error("companies churn", error.message); return await fail("company update failed", error.message); }
  }

  return json({ ok: true, type, status });
});
