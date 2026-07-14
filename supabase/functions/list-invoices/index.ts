// Supabase Edge Function: list-invoices
// ---------------------------------------------------------------------------
// The company's Stripe invoice history, so billing history and PDF downloads can
// live inside Aster instead of only behind a redirect to Stripe's portal.
//
// Read-only. Returns just what the billing table renders: number, date, amount,
// status, the plan it was for, and Stripe's own PDF / hosted links. Card data is
// never touched.
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
      .from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    if (!prof?.company_id) return json({ error: "no company for user" }, 403);
    // Invoices are financial records: managers only.
    if (!["owner", "admin"].includes(prof.role)) return json({ error: "only an admin can view invoices" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    const { data: sub } = await admin
      .from("subscriptions").select("stripe_customer_id").eq("company_id", prof.company_id).maybeSingle();
    const customerId = sub?.stripe_customer_id;
    // Never checked out: no invoices, and that's not an error.
    if (!customerId) return json({ ok: true, invoices: [] });

    const res = await fetch(
      `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=24`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const data = await res.json();
    if (!res.ok) {
      // A customer from the other Stripe mode (or a deleted one) has no history.
      if (/no such customer/i.test(data?.error?.message || "")) return json({ ok: true, invoices: [] });
      console.error("stripe invoices", data);
      return json({ error: "could not load invoices", detail: data?.error?.message || null }, 502);
    }

    // Drafts aren't real history yet; don't show them.
    const invoices = (data.data || [])
      .filter((i: Record<string, unknown>) => i.status !== "draft")
      .map((i: Record<string, any>) => ({
        id: i.id,
        number: i.number || null,                       // human invoice no.
        created: i.created ? i.created * 1000 : null,   // ms, for the client to format
        amount: typeof i.amount_paid === "number" && i.amount_paid > 0 ? i.amount_paid : i.amount_due,
        currency: (i.currency || "usd").toUpperCase(),
        status: i.status,                               // paid | open | void | uncollectible
        plan: i.lines?.data?.[0]?.description || null,  // what it was for
        pdf: i.invoice_pdf || null,                     // direct download
        url: i.hosted_invoice_url || null,              // Stripe-hosted view
      }));

    return json({ ok: true, invoices });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
