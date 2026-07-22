// Supabase Edge Function: buy-credits
// ---------------------------------------------------------------------------
// One-time Stripe Checkout to top up a company's purchased credit balance. Today
// it sells "resume_screen" credits (bulk-upload screening). The unit price is
// $1/credit with a plan discount, computed SERVER-SIDE from the company's own
// plan so a crafted request can't cheat the price:
//   Launch (free): $1.00   Scale (growth): $0.90   Elite (pro): $0.80
// The quantity the buyer entered is trusted; the price is not.
//
// On payment, stripe-webhook (checkout.session.completed, metadata.kind) adds the
// credits to purchased_credits via grant_purchased_credits(). We only mint the
// session here; nothing is credited until Stripe confirms the charge.
//
// Secrets: STRIPE_SECRET_KEY
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function stripe(path: string, params: Record<string, string>, secret: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return { ok: res.ok, data: await res.json() };
}

// Base per-credit price in USD minor units, by credit kind. The final price is
// this base times the currency's rate (currency_rates, editable in /admin; USD=1)
// times the plan discount (Launch 0% · Scale 10% · Elite/Enterprise 20%).
const BASE_USD: Record<string, number> = {
  resume_screen: 100, applicant_screen: 100,   // $1.00
  ai_rank: 40, ai_insight: 40,                 // $0.40
  interview_questions: 40,                     // $0.40, same as the other per-generation AI credits
};
const CREDIT_KINDS = ["resume_screen", "applicant_screen", "ai_rank", "ai_insight", "interview_questions"];
const DEFAULT_RATE: Record<string, number> = { usd: 1, myr: 4.09, sgd: 1.29 };
// Plan discount multiplier, keyed by BOTH the DB plan_tier names (free/growth/pro)
// and the app names (launch/scale/elite), since companies.plan can hold either.
const DISCOUNT_MULT: Record<string, number> = {
  free: 1, launch: 1, starter: 1,
  growth: 0.9, scale: 0.9,
  pro: 0.8, elite: 0.8,
  enterprise: 0.8,
};
const PRODUCT_NAME: Record<string, string> = {
  resume_screen: "Resume screening credits",
  applicant_screen: "Applicant screening credits",
  ai_rank: "AI Rank credits",
  ai_insight: "AI Insight credits",
  interview_questions: "AI Question credits",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { quantity, return_url, return_path, kind: kindRaw, items: itemsRaw } = body;

    // Two shapes: a single {kind, quantity} (from a meter's Buy button) or an
    // {items:[{kind, quantity}]} basket (from the Billing modal, which buys several
    // kinds at once). Normalise to a validated basket, one entry per kind.
    const rawItems: Array<{ kind?: unknown; quantity?: unknown }> = Array.isArray(itemsRaw)
      ? itemsRaw
      : [{ kind: kindRaw ?? "resume_screen", quantity }];
    const byKind = new Map<string, number>();
    for (const it of rawItems) {
      const k = String(it?.kind || "");
      if (!CREDIT_KINDS.includes(k)) return json({ error: "unknown credit kind" }, 400);
      const q = Math.floor(Number(it?.quantity));
      if (!Number.isFinite(q) || q < 0 || q > 10000) {
        return json({ error: "Enter a quantity between 0 and 10,000." }, 400);
      }
      if (q > 0) byKind.set(k, (byKind.get(k) || 0) + q);
    }
    const basket = [...byKind.entries()].map(([kind, qty]) => ({ kind, qty }));
    if (basket.length === 0) return json({ error: "Enter at least 1 credit." }, 400);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    const companyId = prof?.company_id;
    if (!companyId) return json({ error: "no workspace" }, 403);
    if (!["owner", "admin"].includes(prof?.role || "")) {
      return json({ error: "Only an owner or hiring manager can buy credits." }, 403);
    }

    const { data: company } = await admin.from("companies").select("plan, preferred_currency").eq("id", companyId).maybeSingle();
    const mult = DISCOUNT_MULT[String(company?.plan || "").toLowerCase()] ?? 1;
    // Charge in the workspace's preferred currency (MYR default), server-side.
    const cur = ["usd", "myr", "sgd"].includes(String(company?.preferred_currency || "").toLowerCase())
      ? String(company.preferred_currency).toLowerCase() : "myr";
    // Currency rate from the admin-editable table (falls back to defaults).
    const { data: rateRows } = await admin.from("currency_rates").select("currency, rate");
    const rates: Record<string, number> = { ...DEFAULT_RATE };
    for (const r of rateRows || []) {
      if (r?.currency && Number(r.rate) > 0) rates[String(r.currency).toLowerCase()] = Number(r.rate);
    }
    const rate = rates[cur] ?? 1;
    // Price every basket line server-side, so a crafted request can't cheat.
    const priced = basket.map(({ kind, qty }) => {
      const unit = Math.max(1, Math.round(BASE_USD[kind] * rate * mult));
      return { kind, qty, unit, cents: unit * qty };
    });

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    // Reuse the company's Stripe customer if it already has one (keeps the receipt
    // on the same account); otherwise let Checkout create one.
    const { data: subRow } = await admin.from("subscriptions").select("stripe_customer_id").eq("company_id", companyId).maybeSingle();
    const customerId = subRow?.stripe_customer_id || null;

    const base = (typeof return_url === "string" && return_url.startsWith("http")) ? return_url.replace(/\/$/, "") : "https://hireaster.com";
    // Return to the screen the buyer came from (so an AI-Rank purchase from the
    // Applicants page lands back there, not on /upload). Only same-origin paths.
    const path = (typeof return_path === "string" && /^\/[A-Za-z0-9/_-]*$/.test(return_path)) ? return_path : "/upload";

    // The webhook grants from metadata.items (one entry per kind), idempotent per
    // (session, kind). Keep the flat metadata.kind/quantity too when the basket is a
    // single kind, so an older webhook build still credits it.
    const metaItems = JSON.stringify(priced.map(({ kind, qty, cents }) => ({ k: kind, q: qty, c: cents })));
    const totalQty = priced.reduce((s, p) => s + p.qty, 0);
    const descr = priced.map(({ kind, qty }) => `${PRODUCT_NAME[kind] || "credits"} (${qty})`).join(", ");

    const params: Record<string, string> = {
      mode: "payment",
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[items]": metaItems,
      "payment_intent_data[metadata][company_id]": companyId,
      // Produce a real Stripe invoice for the one-time purchase, so the buyer gets
      // an emailed receipt and it shows in their billing history (one-time payments
      // are Charges, not Invoices, unless we ask for one).
      "invoice_creation[enabled]": "true",
      "invoice_creation[invoice_data][description]": descr.slice(0, 500),
      "invoice_creation[invoice_data][metadata][company_id]": companyId,
      success_url: `${base}${path}?credits=success`,
      cancel_url: `${base}${path}?credits=cancel`,
    };
    priced.forEach(({ kind, qty, unit }, i) => {
      params[`line_items[${i}][price_data][currency]`] = cur;
      params[`line_items[${i}][price_data][unit_amount]`] = String(unit);
      params[`line_items[${i}][price_data][product_data][name]`] = PRODUCT_NAME[kind] || "Aster credits";
      params[`line_items[${i}][quantity]`] = String(qty);
    });
    // Single-kind basket keeps the legacy flat fields for webhook back-compat.
    if (priced.length === 1) {
      params["metadata[kind]"] = priced[0].kind;
      params["metadata[quantity]"] = String(priced[0].qty);
      params["payment_intent_data[metadata][kind]"] = priced[0].kind;
    } else {
      params["metadata[quantity]"] = String(totalQty);
    }
    if (customerId) params.customer = customerId;
    else params.customer_creation = "always";

    let session = await stripe("checkout/sessions", params, secret);
    if (!session.ok && customerId) {
      // The saved customer id can belong to the OTHER Stripe mode (e.g. a live
      // customer while the key is a test key), or have been deleted. Retry letting
      // Checkout mint a fresh customer instead of failing the purchase.
      console.warn("buy-credits: saved customer rejected, retrying without it", session.data?.error?.message);
      delete params.customer;
      params.customer_creation = "always";
      session = await stripe("checkout/sessions", params, secret);
    }
    if (!session.ok || !session.data?.url) {
      console.error("buy-credits checkout", session.data);
      return json({ error: session.data?.error?.message || "Could not start checkout." }, 502);
    }
    return json({ url: session.data.url });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
