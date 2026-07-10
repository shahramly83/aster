// Supabase Edge Function: razorpay-webhook
// ---------------------------------------------------------------------------
// Receives Razorpay subscription events, verifies the signature, and syncs the
// company's billing state into Supabase:
//   subscriptions.status : active | past_due | canceled
//   subscriptions.plan   : DB plan_tier enum (free|growth|pro|enterprise)
//   subscriptions.current_period_end
//   companies.status     : active (paid) | churned (cancelled)
// On activation it also clears any soft-delete (deleted_at / purge_after), so a
// customer who paid after their trial lapsed is restored.
//
// Secrets: RAZORPAY_WEBHOOK_SECRET (the value you set on the Razorpay webhook)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// App plan key (in subscription notes) → DB plan_tier enum.
const PLAN_TO_ENUM: Record<string, string> = {
  free: "free", starter: "growth", professional: "pro", enterprise: "enterprise",
};

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
  // Razorpay India sends x-razorpay-signature; Curlec (Malaysia) may use x-curlec-signature.
  const sig = req.headers.get("x-razorpay-signature") || req.headers.get("x-curlec-signature") || "";
  if (!secret) return json({ error: "webhook not configured" }, 503);
  const expected = await hmacHex(secret, raw);
  // Constant-time-ish compare.
  if (sig.length !== expected.length || sig !== expected) return json({ error: "invalid signature" }, 401);

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const event: string = evt.event || "";
  const sub = evt.payload?.subscription?.entity;
  if (!sub) return json({ ok: true, ignored: event });
  const companyId = sub.notes?.company_id;
  if (!companyId) return json({ ok: true, ignored: "no company_id" });

  let status: "active" | "past_due" | "canceled" | null = null;
  if (["subscription.activated", "subscription.charged", "subscription.resumed", "subscription.authenticated", "subscription.updated"].includes(event)) status = "active";
  else if (["subscription.pending", "subscription.halted"].includes(event)) status = "past_due";
  else if (["subscription.cancelled", "subscription.completed", "subscription.expired"].includes(event)) status = "canceled";

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const planEnum = sub.notes?.plan ? (PLAN_TO_ENUM[sub.notes.plan] || null) : null;
  const cycle = sub.notes?.cycle || null;
  const periodEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString().slice(0, 10) : null;

  const subUpdate: Record<string, unknown> = { razorpay_subscription_id: sub.id };
  if (status) subUpdate.status = status;
  if (planEnum) subUpdate.plan = planEnum;
  if (cycle) subUpdate.cycle = cycle;
  if (periodEnd) subUpdate.current_period_end = periodEnd;
  await admin.from("subscriptions").update(subUpdate).eq("company_id", companyId);

  if (status === "active") {
    // Paid → active, and lift any soft-delete/suspension.
    const companyUpdate: Record<string, unknown> = { status: "active", deleted_at: null, purge_after: null };
    if (planEnum) companyUpdate.plan = planEnum;
    await admin.from("companies").update(companyUpdate).eq("id", companyId);
  } else if (status === "canceled") {
    await admin.from("companies").update({ status: "churned" }).eq("id", companyId);
  }

  return json({ ok: true, event, status });
});
