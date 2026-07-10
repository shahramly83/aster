// Supabase Edge Function: create-subscription
// ---------------------------------------------------------------------------
// A signed-in owner/admin starts a paid subscription. Creates a Razorpay
// subscription for the chosen plan + cycle and returns the subscription id +
// public key so the client can open Razorpay Checkout. The razorpay-webhook
// function then activates it (subscriptions.status='active', companies.status
// ='active') once payment succeeds.
//
// Secrets required: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and one plan id per
//   tier/cycle: RZP_PLAN_LAUNCH_MONTHLY, RZP_PLAN_SCALE_MONTHLY,
//   RZP_PLAN_SCALE_YEARLY, RZP_PLAN_ELITE_MONTHLY, RZP_PLAN_ELITE_YEARLY.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Curlec by Razorpay (Malaysia, MYR) API base. Override with RZP_API_BASE if your
// Curlec docs show a different host (e.g. Razorpay India: https://api.razorpay.com/v1).
const API_BASE = Deno.env.get("RZP_API_BASE") || "https://api.curlec.com/v1";

// App plan key + cycle → the env var holding that Razorpay plan id.
const PLAN_ENV: Record<string, string> = {
  "free|monthly": "RZP_PLAN_LAUNCH_MONTHLY",       // Launch, monthly only
  "starter|monthly": "RZP_PLAN_SCALE_MONTHLY",     // Scale
  "starter|yearly": "RZP_PLAN_SCALE_YEARLY",
  "professional|monthly": "RZP_PLAN_ELITE_MONTHLY", // Elite
  "professional|yearly": "RZP_PLAN_ELITE_YEARLY",
};
// Billing cycles to authorise up front (Razorpay requires total_count).
const TOTAL_COUNT: Record<string, number> = { monthly: 120, yearly: 10 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { plan, cycle } = await req.json();
    const c = cycle === "yearly" ? "yearly" : "monthly";
    const planEnv = PLAN_ENV[`${plan}|${c}`];
    if (!planEnv) return json({ error: "unknown plan or cycle" }, 400);

    // Identify the caller + their company.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("company_id, full_name, email, role").eq("id", user.id).maybeSingle();
    const companyId = prof?.company_id;
    if (!companyId) return json({ error: "no company for user" }, 403);
    if (!["owner", "admin"].includes(prof?.role)) return json({ error: "only an admin can subscribe" }, 403);

    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const planId = Deno.env.get(planEnv);
    if (!keyId || !keySecret) return json({ error: "billing not configured" }, 503);
    if (!planId) return json({ error: `missing ${planEnv}` }, 503);
    const rzpAuth = "Basic " + btoa(`${keyId}:${keySecret}`);

    // Create the Razorpay subscription. notes.company_id lets the webhook map the
    // event back to this workspace; plan/cycle let it record the tier.
    const subRes = await fetch(`${API_BASE}/subscriptions`, {
      method: "POST",
      headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        total_count: TOTAL_COUNT[c] || 120,
        customer_notify: 1,
        notes: { company_id: companyId, plan, cycle: c },
      }),
    });
    const sub = await subRes.json();
    if (!subRes.ok || !sub?.id) {
      console.error("razorpay subscription create failed", sub);
      return json({ error: "could not create subscription", detail: sub?.error?.description || null }, 502);
    }

    // Remember the subscription id so the webhook can reconcile it.
    await admin.from("subscriptions").update({ razorpay_subscription_id: sub.id }).eq("company_id", companyId);

    return json({
      ok: true,
      subscription_id: sub.id,
      key_id: keyId,
      prefill: { name: prof?.full_name || "", email: prof?.email || user.email || "" },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
