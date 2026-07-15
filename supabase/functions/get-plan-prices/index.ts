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
    // Opt-in diagnostics: POST {"debug":true} to see, per plan, whether the price
    // secret is set and whether Stripe accepted the id (and its error otherwise).
    // None of this is secret (env var NAMES, public price ids, Stripe error text);
    // the SECRET KEY itself is never echoed, only its mode (test/live).
    const body = await req.json().catch(() => ({}));
    const debug = body?.debug === true;

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) {
      return json(debug
        ? { ok: false, error: "STRIPE_SECRET_KEY is not set", key_mode: "unset" }
        : { error: "billing not configured" }, debug ? 200 : 503);
    }
    const keyMode = secret.startsWith("sk_live_") ? "live" : secret.startsWith("sk_test_") ? "test" : "unknown";

    const diagnostics: Array<Record<string, unknown>> = [];
    const results = await Promise.all(Object.entries(PRICE_ENV).map(async ([key, envName]) => {
      const id = Deno.env.get(envName);
      if (!id) { if (debug) diagnostics.push({ key, env: envName, set: false }); return null; }
      const res = await fetch(`https://api.stripe.com/v1/prices/${id}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const p = await res.json();
      if (!res.ok || typeof p?.unit_amount !== "number") {
        console.error("stripe price", id, p?.error?.message);
        if (debug) diagnostics.push({ key, env: envName, set: true, id, ok: false, error: p?.error?.message || `http ${res.status}` });
        return null; // a misconfigured id shouldn't take the whole screen down
      }
      if (debug) diagnostics.push({ key, env: envName, set: true, id, ok: true, amount: p.unit_amount, currency: p.currency });
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

    const prices = Object.fromEntries(results.filter(Boolean) as [string, unknown][]);
    if (debug) return json({ ok: true, key_mode: keyMode, count: Object.keys(prices).length, diagnostics, prices });

    // Prices change rarely; let the CDN and browser hold them for a few minutes.
    return json({ ok: true, prices }, 200, { "Cache-Control": "public, max-age=300, s-maxage=300" });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
