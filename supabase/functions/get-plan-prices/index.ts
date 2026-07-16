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

// One PRODUCT per plan. Each product carries its own prices, one per currency and
// interval (USD monthly, MYR monthly, USD yearly, …). We list a product's prices
// and group them by cycle + currency, so adding a currency in Stripe needs no code
// or secret change. Must stay in sync with create-checkout-session's PRODUCT_ENV.
const PRODUCT_ENV: Record<string, string> = {
  launch: "STRIPE_PRODUCT_LAUNCH",
  scale: "STRIPE_PRODUCT_SCALE",
  elite: "STRIPE_PRODUCT_ELITE",
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
    // For each plan's product, list its active recurring prices and group by
    // cycle (monthly/yearly) then currency, so `launch|monthly` ends up with a
    // { usd, myr, sgd } amount map drawn from however many single-currency prices
    // the product has. Returns an array of [key, value] entries per product.
    const results = await Promise.all(Object.entries(PRODUCT_ENV).map(async ([plan, envName]) => {
      const prodId = Deno.env.get(envName);
      if (!prodId) { if (debug) diagnostics.push({ plan, env: envName, set: false }); return []; }
      const res = await fetch(`https://api.stripe.com/v1/prices?product=${prodId}&active=true&limit=100`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data?.data)) {
        console.error("stripe prices", prodId, data?.error?.message);
        if (debug) diagnostics.push({ plan, env: envName, set: true, product: prodId, ok: false, error: data?.error?.message || `http ${res.status}` });
        return [];
      }
      // group[cycle] = { currencies: {usd: amt, ...}, interval, interval_count }
      const group: Record<string, { currencies: Record<string, number>; interval: string; interval_count: number }> = {};
      for (const p of data.data as Array<Record<string, any>>) {
        if (!p.recurring || typeof p.unit_amount !== "number") continue;   // skip one-off prices
        const cycle = p.recurring.interval === "year" ? "yearly" : "monthly";
        const g = group[cycle] || (group[cycle] = { currencies: {}, interval: p.recurring.interval, interval_count: p.recurring.interval_count || 1 });
        // First price wins per currency (avoid an old archived duplicate flipping it).
        if (g.currencies[p.currency] == null) g.currencies[p.currency] = p.unit_amount;
      }
      if (debug) diagnostics.push({ plan, env: envName, set: true, product: prodId, ok: true, cycles: Object.fromEntries(Object.entries(group).map(([c, g]) => [c, Object.keys(g.currencies)])) });
      return Object.entries(group).map(([cycle, g]) => {
        // Base currency for the headline amount: prefer USD, else the first one.
        const baseCur = g.currencies.usd != null ? "usd" : Object.keys(g.currencies)[0];
        return [`${plan}|${cycle}`, {
          active: true,
          amount: g.currencies[baseCur],
          currency: baseCur,
          currencies: g.currencies,
          interval: g.interval,
          interval_count: g.interval_count,
        }] as const;
      });
    }));

    const prices = Object.fromEntries(results.flat() as [string, unknown][]);
    if (debug) return json({ ok: true, key_mode: keyMode, count: Object.keys(prices).length, diagnostics, prices });

    // Prices change rarely; let the CDN and browser hold them for a few minutes.
    return json({ ok: true, prices }, 200, { "Cache-Control": "public, max-age=300, s-maxage=300" });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
