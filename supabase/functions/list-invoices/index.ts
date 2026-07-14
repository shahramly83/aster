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
    // Invoices are financial records, and they carry the company's legal name,
    // address and registration number. Owner only: a hiring manager is 'admin', so
    // admins used to be able to download every invoice the company has ever paid.
    if (prof.role !== "owner") return json({ error: "only the account owner can view invoices" }, 403);

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

    // What the invoice was FOR, in one line.
    //
    // A plan change produces two lines: a credit for the old plan's unused time and
    // a charge for the new one. Taking lines[0] showed "Unused time on Aster Scale"
    // against a charge of $169.91, which reads as though we billed them for time
    // they did not use. Describe it by the plan they were moved ONTO, which is the
    // line that was actually charged.
    const planOf = (lines: Record<string, any>[]): string | null => {
      if (!lines?.length) return null;
      // Several plan changes in one period stack their prorations onto a single
      // invoice, so there can be many charged lines. Take the LARGEST, which is the
      // plan they actually ended up on. Taking the last one labelled an upgrade to
      // Elite as "Aster Scale" purely because of the order Stripe happened to list.
      const charged = lines.filter((l) => (l.amount ?? 0) > 0)
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
      const line = charged[0] || lines[0];
      const d = String(line.description || "");
      // "Remaining time on Aster Elite after 14 Jul 2026" -> "Aster Elite (prorated)"
      const m = d.match(/^Remaining time on (.+?) after /i);
      if (m) return `${m[1]} (prorated)`;
      // "1 × Aster Scale (at $129.00 / month)" -> "Aster Scale"
      const n = d.match(/^\d+\s*×\s*(.+?)\s*\(at /i);
      if (n) return n[1];
      return d || null;
    };

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
        plan: planOf(i.lines?.data || []),              // what it was for
        pdf: i.invoice_pdf || null,                     // direct download
        url: i.hosted_invoice_url || null,              // Stripe-hosted view
      }));

    // What they will ACTUALLY be charged next, which is not the list price.
    // A plan change leaves prorations sitting on the account: after an Elite ->
    // Scale downgrade the next invoice is Scale minus the unused Elite time, which
    // can be nothing at all. Showing the sticker price there promises a charge that
    // will not happen, so ask Stripe to price the invoice instead of guessing.
    let upcoming: Record<string, unknown> | null = null;
    const { data: subRow } = await admin
      .from("subscriptions").select("stripe_subscription_id, status").eq("company_id", prof.company_id).maybeSingle();
    const liveSub = subRow?.stripe_subscription_id;
    if (liveSub && ["active", "past_due", "trialing"].includes(String(subRow?.status || ""))) {
      const pv = await fetch("https://api.stripe.com/v1/invoices/create_preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ customer: customerId, subscription: liveSub }).toString(),
      });
      const p = await pv.json();
      if (pv.ok) {
        // Credits show up as negative lines, and Stripe floors amount_due at zero.
        const credit = (p.lines?.data || [])
          .filter((l: Record<string, any>) => (l.amount ?? 0) < 0)
          .reduce((t: number, l: Record<string, any>) => t + Math.abs(l.amount), 0);
        upcoming = {
          amount: p.amount_due ?? null,
          currency: (p.currency || "usd").toUpperCase(),
          date: p.next_payment_attempt ? p.next_payment_attempt * 1000 : null,
          credit: credit || 0,
        };
      } else {
        // A preview is a nicety. Never fail the billing page over it.
        console.warn("stripe upcoming preview", p?.error?.message);
      }
    }

    return json({ ok: true, invoices, upcoming });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
