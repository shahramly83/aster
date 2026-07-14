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

// Base per-credit price in cents, by credit kind. The plan discount is applied on
// top (Launch 0% · Scale 10% · Elite/Enterprise 20%). AI Rank is cheaper to buy.
const BASE_CENTS: Record<string, number> = {
  resume_screen: 100,     // $1.00
  applicant_screen: 100,  // $1.00
  ai_rank: 40,            // $0.40
};
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
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { quantity, return_url, return_path, kind: kindRaw } = await req.json().catch(() => ({}));
    const kind = String(kindRaw || "resume_screen");
    if (!(kind in BASE_CENTS)) return json({ error: "unknown credit kind" }, 400);
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 10000) {
      return json({ error: "Enter a quantity between 1 and 10,000." }, 400);
    }

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

    const { data: company } = await admin.from("companies").select("plan").eq("id", companyId).maybeSingle();
    const mult = DISCOUNT_MULT[String(company?.plan || "").toLowerCase()] ?? 1;
    const unit = Math.max(1, Math.round(BASE_CENTS[kind] * mult));

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

    const params: Record<string, string> = {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(unit),
      "line_items[0][price_data][product_data][name]": PRODUCT_NAME[kind] || "Aster credits",
      "line_items[0][quantity]": String(qty),
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[kind]": kind,
      "metadata[quantity]": String(qty),
      "payment_intent_data[metadata][company_id]": companyId,
      "payment_intent_data[metadata][kind]": kind,
      success_url: `${base}${path}?credits=success`,
      cancel_url: `${base}${path}?credits=cancel`,
    };
    if (customerId) params.customer = customerId;
    else params.customer_creation = "always";

    const session = await stripe("checkout/sessions", params, secret);
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
