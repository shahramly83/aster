// Supabase Edge Function: create-portal-session
// ---------------------------------------------------------------------------
// Opens Stripe's hosted Billing Portal for the caller's company. The portal is
// the real source of truth for everything the app used to fake: invoice history
// with downloadable PDFs, the saved card, and cancellation. Stripe renders it,
// so amounts, currency and tax always match what was actually charged.
//
// Requires the company to already have a Stripe customer, which
// create-checkout-session creates on first subscribe.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { return_url } = await req.json().catch(() => ({}));

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    if (!prof?.company_id) return json({ error: "no company for user" }, 403);
    // Owner only. The portal can change the card and cancel the subscription, and a
    // hiring manager is 'admin', so admins used to have both.
    if (prof.role !== "owner") return json({ error: "only the account owner can manage billing" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    const { data: subRow } = await admin
      .from("subscriptions").select("stripe_customer_id").eq("company_id", prof.company_id).maybeSingle();
    const customerId = subRow?.stripe_customer_id;
    // No customer means they have never checked out; there is nothing to manage.
    if (!customerId) return json({ error: "no_customer", detail: "Subscribe first to manage billing." }, 409);

    const base = (typeof return_url === "string" && return_url.startsWith("http"))
      ? return_url.replace(/\/$/, "") : "https://hireaster.com";

    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: customerId, return_url: `${base}/billing` }).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data?.url) {
      console.error("stripe portal", data);
      // The saved customer can stop resolving: deleted in Stripe, or belonging to
      // the other mode (a live id used with a test key). Drop the dead id so the
      // next checkout mints a fresh one, and tell them to subscribe rather than
      // leaking a raw Stripe message.
      if (/no such customer/i.test(data?.error?.message || "")) {
        console.warn(`stripe: stale customer ${customerId} for company ${prof.company_id}; clearing`);
        await admin.from("subscriptions")
          .update({ stripe_customer_id: null }).eq("company_id", prof.company_id);
        return json({ error: "no_customer", detail: "Subscribe first to manage billing." }, 409);
      }
      return json({ error: "could not open billing portal", detail: data?.error?.message || null }, 502);
    }

    return json({ ok: true, url: data.url });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
