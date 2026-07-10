// Supabase Edge Function: get-plan-prices
// ---------------------------------------------------------------------------
// Returns the live Stripe amount + currency for each configured plan/cycle, so
// no screen can ever display a price different from what the card is actually
// charged. The amounts used to be hardcoded in the UI, free to drift from Stripe.
//
// Response: { ok: true, prices: { "scale|monthly": { amount, currency,
//            interval, interval_count } , ... } }
// `amount` is in the currency's minor unit (e.g. sen), as Stripe reports it.
// A plan whose STRIPE_PRICE_* secret is unset is simply absent from the map.
//
// List prices are public information (they're on the marketing pricing page), so
// this needs no session: the signed-out pricing and sign-up screens read it too.
// It exposes only amount/currency/interval, never a key or a customer.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_* (same ids create-checkout-session uses)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, ...extra, "Content-Type": "application/json" } });

// Must stay in sync with create-checkout-session's PRICE_ENV.
const PRICE_ENV: Record<string, string> = {
  "launch|monthly": "STRIPE_PRICE_LAUNCH_MONTHLY",
  "launch|yearly": "STRIPE_PRICE_LAUNCH_YEARLY",
  "scale|monthly": "STRIPE_PRICE_SCALE_MONTHLY",
  "scale|yearly": "STRIPE_PRICE_SCALE_YEARLY",
  "elite|monthly": "STRIPE_PRICE_ELITE_MONTHLY",
  "elite|yearly": "STRIPE_PRICE_ELITE_YEARLY",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    const entries = Object.entries(PRICE_ENV)
      .map(([key, envName]) => [key, Deno.env.get(envName)] as const)
      .filter(([, id]) => !!id);

    const results = await Promise.all(entries.map(async ([key, id]) => {
      const res = await fetch(`https://api.stripe.com/v1/prices/${id}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const p = await res.json();
      if (!res.ok || typeof p?.unit_amount !== "number") {
        console.error("stripe price", id, p?.error?.message);
        return null; // a misconfigured id shouldn't take the whole screen down
      }
      return [key, {
        // Not a secret (it travels in the Checkout URL), and echoing it makes
        // "which price is this env var actually pointing at?" answerable.
        id: p.id,
        active: p.active !== false,
        amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval || "month",
        interval_count: p.recurring?.interval_count || 1,
      }] as const;
    }));

    // Prices change rarely; let the CDN and browser hold them for a few minutes.
    return json(
      { ok: true, prices: Object.fromEntries(results.filter(Boolean) as [string, unknown][]) },
      200,
      { "Cache-Control": "public, max-age=300, s-maxage=300" },
    );
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
