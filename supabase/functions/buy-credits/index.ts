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

// Per-credit price in cents, by DB plan_tier. Enterprise gets the Elite rate.
const UNIT_CENTS: Record<string, number> = { free: 100, growth: 90, pro: 80, enterprise: 80 };
const KIND = "resume_screen";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { quantity, return_url } = await req.json().catch(() => ({}));
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
    const unit = UNIT_CENTS[company?.plan || "free"] ?? 100;

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    // Reuse the company's Stripe customer if it already has one (keeps the receipt
    // on the same account); otherwise let Checkout create one.
    const { data: subRow } = await admin.from("subscriptions").select("stripe_customer_id").eq("company_id", companyId).maybeSingle();
    const customerId = subRow?.stripe_customer_id || null;

    const base = (typeof return_url === "string" && return_url.startsWith("http")) ? return_url.replace(/\/$/, "") : "https://hireaster.com";

    const params: Record<string, string> = {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(unit),
      "line_items[0][price_data][product_data][name]": "Resume screening credits",
      "line_items[0][quantity]": String(qty),
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[kind]": KIND,
      "metadata[quantity]": String(qty),
      "payment_intent_data[metadata][company_id]": companyId,
      "payment_intent_data[metadata][kind]": KIND,
      success_url: `${base}/upload?credits=success`,
      cancel_url: `${base}/upload?credits=cancel`,
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
