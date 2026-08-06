// Supabase Edge Function: admin-revenue
// ---------------------------------------------------------------------------
// Total revenue for the admin overview, for today, this month and this year.
//
// Read from Stripe rather than from our own tables, because Stripe is the only
// place that holds all of it. Subscriptions go through create-checkout-session
// and credit top-ups through buy-credits, and only the top-ups leave a row
// behind (credit_purchase_log). Summing our own tables would report top-ups as
// though they were the whole business.
//
// Gross: succeeded charges, as taken. Refunds and Stripe's fees are not
// deducted, so this is money in, not money kept.
//
// Windows are Asia/Kuala_Lumpur days. Local midnight is 16:00 UTC the day
// before, so a UTC "today" would file a Malaysian morning under yesterday.
//
// Amounts are grouped by the currency they were taken in and never converted:
// a rate fetched today would restate takings from ten months ago.
//
// Admin-only. Guarded on admin_users, the same table is_admin() reads, so a
// customer's token cannot reach it even though every signed-in user may call
// edge functions.
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

const TZ_OFFSET_MIN = 8 * 60; // Asia/Kuala_Lumpur, no DST ever

// Start of the local day / month / year, expressed as a UTC epoch in seconds,
// which is what Stripe's created[gte] filter wants.
function localBoundaries(now = new Date()) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const toEpoch = (yy: number, mm: number, dd: number) =>
    Math.floor(Date.UTC(yy, mm, dd) / 1000) - TZ_OFFSET_MIN * 60;
  return { today: toEpoch(y, m, d), month: toEpoch(y, m, 1), year: toEpoch(y, 0, 1) };
}

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
    const { data: who } = await admin
      .from("admin_users").select("role, status").eq("id", user.id).maybeSingle();
    if (!who || who.status !== "active") return json({ error: "forbidden" }, 403);
    // Revenue is a billing figure. Support admins can see workspaces and
    // tickets but never money, matching canRevenue in the portal.
    if (who.role !== "super" && who.role !== "billing") return json({ error: "forbidden" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    const bounds = localBoundaries();

    // One pass over the year covers all three windows: today and this month are
    // both inside it. Three separate queries would re-fetch the same charges.
    const totals: Record<string, Record<string, { amount: number; count: number }>> = {
      today: {}, month: {}, year: {},
    };
    const add = (bucket: string, currency: string, amount: number) => {
      const c = (totals[bucket][currency] ||= { amount: 0, count: 0 });
      c.amount += amount;
      c.count += 1;
    };

    let startingAfter: string | null = null;
    let pages = 0;
    // Stripe caps a page at 100. The guard stops a runaway loop from holding the
    // request open; 50 pages is 5,000 charges in a year, well past today's scale.
    while (pages < 50) {
      const qs = new URLSearchParams({ limit: "100" });
      qs.set("created[gte]", String(bounds.year));
      if (startingAfter) qs.set("starting_after", startingAfter);

      const res = await fetch(`https://api.stripe.com/v1/charges?${qs}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const page = await res.json();
      if (!res.ok) {
        console.error("stripe charges", page);
        return json({ error: "could not load revenue", detail: page?.error?.message || null }, 502);
      }

      for (const ch of page.data || []) {
        // Only money that actually arrived. A failed card and an uncaptured
        // authorisation both appear here and neither is revenue.
        if (ch.status !== "succeeded" || ch.paid !== true) continue;
        const cur = String(ch.currency || "myr").toLowerCase();
        const amt = Number(ch.amount || 0);
        add("year", cur, amt);
        if (ch.created >= bounds.month) add("month", cur, amt);
        if (ch.created >= bounds.today) add("today", cur, amt);
      }

      pages += 1;
      if (!page.has_more || !page.data?.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    // Flatten to the same shape the portal already reads for top-ups, so the
    // tile renders one way regardless of where the figure came from.
    const rows = Object.entries(totals).flatMap(([bucket, byCcy]) =>
      Object.entries(byCcy).map(([currency, v]) => ({
        bucket, currency, amount_cents: v.amount, payments: v.count,
      })),
    );

    return json({ ok: true, rows, truncated: pages >= 50 });
  } catch (e) {
    console.error("admin-revenue", e);
    return json({ error: "could not load revenue" }, 500);
  }
});
