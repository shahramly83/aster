// Create (or reuse) the Stripe TEST-mode webhook endpoint that points at the
// stripe-webhook edge function, and print its signing secret.
//
// Stripe only returns the signing secret when the endpoint is CREATED. If one
// already exists for this URL we can't read its secret back, so we delete and
// recreate it to get a fresh one.
//
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup-webhook.mjs

const KEY = process.env.STRIPE_SECRET_KEY || "";
if (!KEY.startsWith("sk_test_")) {
  console.error("✗ Set STRIPE_SECRET_KEY to your sk_test_ key. Refusing to touch live mode.");
  process.exit(1);
}

const PROJECT_REF = "edaefharlofwhnmcbiwk";
const URL_ = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;

// Exactly the events supabase/functions/stripe-webhook/index.ts acts on.
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Billing address edited in Stripe's portal, mirrored back onto the profile.
  "customer.updated",
];

const api = async (path, body, method = "POST") => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? body.toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error?.message || res.status}`);
  return json;
};

// Any existing endpoint on the same URL? Remove it so we can mint a fresh secret.
const { data: existing } = await api("webhook_endpoints?limit=100", null, "GET");
for (const ep of existing) {
  if (ep.url === URL_) {
    console.log(`• removing existing endpoint ${ep.id} (so we can read a fresh signing secret)`);
    await api(`webhook_endpoints/${ep.id}`, null, "DELETE");
  }
}

const params = new URLSearchParams();
params.set("url", URL_);
params.set("description", "Aster (test) — subscription lifecycle");
EVENTS.forEach((e, i) => params.set(`enabled_events[${i}]`, e));

const ep = await api("webhook_endpoints", params);

console.log(`\n✅ Webhook endpoint created`);
console.log(`   id:     ${ep.id}`);
console.log(`   url:    ${ep.url}`);
console.log(`   events: ${EVENTS.length}`);
EVENTS.forEach((e) => console.log(`     - ${e}`));
console.log(`\n   STRIPE_WEBHOOK_SECRET=${ep.secret}\n`);
