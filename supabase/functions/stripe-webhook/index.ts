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

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Since migration 0040 the app plan key and the plan_tier enum are the same
// vocabulary, so metadata.plan is written straight through. Guard anyway: a
// stale checkout session created before 0040 must not poison the enum.
const PLAN_TIERS = new Set(["launch", "scale", "elite", "enterprise"]);

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe-Signature: "t=<ts>,v1=<sig>[,v1=<sig>...]"
async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !sigs.length) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => s.length === expected.length && s === expected);
}

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
  if (!companyId) return json({ ok: true, ignored: "no company" });

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
    if (error) { console.error("subscriptions update", error.message, subUpdate); return json({ error: "subscription update failed", detail: error.message }, 500); }
  }

  if (status === "active") {
    const companyUpdate: Record<string, unknown> = { status: "active", deleted_at: null, purge_after: null };
    if (planEnum) companyUpdate.plan = planEnum;
    const { error } = await admin.from("companies").update(companyUpdate).eq("id", companyId);
    if (error) { console.error("companies activate", error.message, companyUpdate); return json({ error: "company update failed", detail: error.message }, 500); }
  } else if (status === "canceled") {
    const { error } = await admin.from("companies").update({ status: "churned" }).eq("id", companyId);
    if (error) { console.error("companies churn", error.message); return json({ error: "company update failed", detail: error.message }, 500); }
  }

  return json({ ok: true, type, status });
});
