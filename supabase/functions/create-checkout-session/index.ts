// Supabase Edge Function: create-checkout-session
// ---------------------------------------------------------------------------
// A signed-in owner/admin starts a paid plan. Creates a Stripe Checkout Session
// (mode=subscription) for the chosen tier+cycle and returns the hosted checkout
// URL; the client redirects to it. stripe-webhook then activates the plan once
// payment succeeds.
//
// Secrets: STRIPE_SECRET_KEY, and one price id per tier/cycle:
//   STRIPE_PRICE_{LAUNCH,SCALE,ELITE}_{MONTHLY,YEARLY}
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PRICE_ENV: Record<string, string> = {
  "launch|monthly": "STRIPE_PRICE_LAUNCH_MONTHLY",
  "launch|yearly": "STRIPE_PRICE_LAUNCH_YEARLY",
  "scale|monthly": "STRIPE_PRICE_SCALE_MONTHLY",
  "scale|yearly": "STRIPE_PRICE_SCALE_YEARLY",
  "elite|monthly": "STRIPE_PRICE_ELITE_MONTHLY",
  "elite|yearly": "STRIPE_PRICE_ELITE_YEARLY",
};

// Stripe expects application/x-www-form-urlencoded.
async function stripe(path: string, params: Record<string, string>, secret: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { plan, cycle, return_url } = await req.json();
    const c = cycle === "yearly" ? "yearly" : "monthly";
    const priceEnv = PRICE_ENV[`${plan}|${c}`];
    if (!priceEnv) return json({ error: "unknown plan or cycle" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("company_id, email, role").eq("id", user.id).maybeSingle();
    const companyId = prof?.company_id;
    if (!companyId) return json({ error: "no company for user" }, 403);
    if (!["owner", "admin"].includes(prof?.role)) return json({ error: "only an admin can subscribe" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = Deno.env.get(priceEnv);
    if (!secret) return json({ error: "billing not configured" }, 503);
    if (!priceId) return json({ error: `missing ${priceEnv}` }, 503);

    // Reuse or create the Stripe customer for this company.
    const { data: subRow } = await admin
      .from("subscriptions").select("stripe_customer_id").eq("company_id", companyId).maybeSingle();
    let customerId = subRow?.stripe_customer_id || null;
    if (!customerId) {
      const cr = await stripe("customers", {
        email: prof?.email || user.email || "",
        "metadata[company_id]": companyId,
      }, secret);
      if (!cr.ok || !cr.data?.id) { console.error("stripe customer", cr.data); return json({ error: "could not create customer" }, 502); }
      customerId = cr.data.id;
      await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("company_id", companyId);
    }

    const base = (typeof return_url === "string" && return_url.startsWith("http")) ? return_url.replace(/\/$/, "") : "https://hireaster.com";
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      customer: customerId!,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][company_id]": companyId,
      "subscription_data[metadata][plan]": plan,
      "subscription_data[metadata][cycle]": c,
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[plan]": plan,
      "metadata[cycle]": c,
      allow_promotion_codes: "true",
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=cancel`,
    }, secret);
    if (!session.ok || !session.data?.url) { console.error("stripe session", session.data); return json({ error: "could not start checkout", detail: session.data?.error?.message || null }, 502); }

    return json({ ok: true, url: session.data.url });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
