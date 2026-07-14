// Create the Launch / Scale / Elite products + monthly & yearly prices in Stripe
// TEST mode, and print the six price ids ready to paste into Supabase secrets.
//
// Test mode is a separate dataset: prices created in Live mode do NOT exist here,
// which is why this has to be done again. Running twice is safe: it reuses a
// product with the same name instead of duplicating it.
//
// The key is read from the environment and never printed.
//
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup-test.mjs
//
// PowerShell:
//   $env:STRIPE_SECRET_KEY="sk_test_xxx"; node scripts/stripe-setup-test.mjs

const KEY = process.env.STRIPE_SECRET_KEY || "";
if (!KEY) {
  console.error("✗ STRIPE_SECRET_KEY is not set.");
  console.error("  Get it from https://dashboard.stripe.com/test/apikeys (Reveal test key).");
  process.exit(1);
}
if (!KEY.startsWith("sk_test_")) {
  console.error(`✗ Refusing to run: the key starts with "${KEY.slice(0, 8)}…", not "sk_test_".`);
  console.error("  A live key would create real products and real charges. Use the TEST key.");
  process.exit(1);
}

// Plan catalogue. Monthly price in dollars; yearly is 12 months less a discount.
// Source of truth is Stripe (the app reads prices from get-plan-prices), so these
// must match what you actually sell.
const YEARLY_DISCOUNT = 0.20;                 // 20% off when billed yearly
const PLANS = [
  { key: "LAUNCH", name: "Aster Launch", monthly: 19 },
  { key: "SCALE", name: "Aster Scale", monthly: 129 },
  { key: "ELITE", name: "Aster Elite", monthly: 299 },
];
const CURRENCY = "usd";

// The billing UI shows the yearly plan as a MONTHLY EQUIVALENT (yearly / 12), so
// round that to a whole dollar and derive the annual figure from it. That keeps
// the number customers actually read clean ("$15 per month, $180 billed yearly")
// instead of "$15.20 per month, $182.40 billed yearly".
const cents = (dollars) => Math.round(dollars * 100);
for (const p of PLANS) {
  p.monthlyAmt = cents(p.monthly);
  p.perMonthYearly = Math.round(p.monthly * (1 - YEARLY_DISCOUNT)); // whole dollars
  p.yearlyAmt = cents(p.perMonthYearly * 12);
}

const api = async (path, body, method = "POST") => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error?.message || res.status}`);
  return json;
};

// Reuse an existing product with the same name so re-running doesn't duplicate.
const findProduct = async (name) => {
  const { data } = await api(`products?active=true&limit=100`, null, "GET");
  return data.find((p) => p.name === name) || null;
};
// Active prices on a product for a given interval.
const activePrices = async (productId, interval) => {
  const { data } = await api(`prices?product=${productId}&active=true&limit=100`, null, "GET");
  return data.filter((p) => p.recurring?.interval === interval);
};
// Stripe prices are immutable and cannot be deleted, only archived.
const archivePrice = (id) => api(`prices/${id}`, new URLSearchParams({ active: "false" }));

const out = {};
console.log("Stripe TEST mode: creating products and prices…\n");

for (const plan of PLANS) {
  let product = await findProduct(plan.name);
  if (product) {
    console.log(`• ${plan.name}: reusing existing product`);
  } else {
    product = await api("products", { name: plan.name });
    console.log(`• ${plan.name}: created product`);
  }

  for (const [interval, amount] of [["month", plan.monthlyAmt], ["year", plan.yearlyAmt]]) {
    const existing = await activePrices(product.id, interval);
    let price = existing.find((p) => p.unit_amount === amount && p.currency === CURRENCY);

    // Retire anything at the wrong amount so the app can't offer a stale price.
    for (const stale of existing) {
      if (price && stale.id === price.id) continue;
      await archivePrice(stale.id);
      console.log(`    ${interval.padEnd(5)} archived wrong price ${stale.id} (was ${(stale.unit_amount / 100).toFixed(2)})`);
    }

    if (!price) {
      price = await api("prices", {
        product: product.id,
        currency: CURRENCY,
        unit_amount: String(amount),
        "recurring[interval]": interval,
      });
    }
    const env = `STRIPE_PRICE_${plan.key}_${interval === "month" ? "MONTHLY" : "YEARLY"}`;
    out[env] = price.id;
    const note = interval === "year"
      ? `  (= $${plan.perMonthYearly}/mo, ${Math.round((1 - plan.perMonthYearly / plan.monthly) * 100)}% off)`
      : "";
    console.log(`    ${interval.padEnd(5)} $${(amount / 100).toFixed(2).padStart(8)}${note}  ->  ${price.id}`);
  }
}

console.log("\n─────────────────────────────────────────────");
console.log("Paste this (add your sk_test_ and whsec_ too):\n");
console.log(
  "npx supabase secrets set \\\n" +
  Object.entries(out).map(([k, v]) => `  ${k}=${v}`).join(" \\\n")
);
console.log("\n(Windows PowerShell: put it all on ONE line, no backslashes.)");
console.log("─────────────────────────────────────────────");
