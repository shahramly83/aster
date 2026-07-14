// Supabase Edge Function: create-checkout-session
// ---------------------------------------------------------------------------
// A signed-in owner/admin starts a paid plan. Creates a Stripe Checkout Session
// (mode=subscription) for the chosen tier+cycle and returns the hosted checkout
// URL; the client redirects to it. stripe-webhook then activates the plan once
// payment succeeds.
//
// Secrets: STRIPE_SECRET_KEY, and one price id per tier/cycle:
//   STRIPE_PRICE_{LAUNCH,SCALE,ELITE}_{MONTHLY,YEARLY}
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PRICE_ENV: Record<string, string> = {
  "launch|monthly": "STRIPE_PRICE_LAUNCH_MONTHLY",
  "launch|yearly": "STRIPE_PRICE_LAUNCH_YEARLY",
  "scale|monthly": "STRIPE_PRICE_SCALE_MONTHLY",
  "scale|yearly": "STRIPE_PRICE_SCALE_YEARLY",
  "elite|monthly": "STRIPE_PRICE_ELITE_MONTHLY",
  "elite|yearly": "STRIPE_PRICE_ELITE_YEARLY",
};

// Ranked so we can tell an upgrade from a downgrade, which decides how Stripe
// prorates the switch.
const RANK: Record<string, number> = { launch: 1, scale: 2, elite: 3 };

// Stripe prints the "Bill to" block on every invoice from the customer's own
// name/address/email, so whatever we fail to send simply is not on the receipt.
// Country must be a 2-letter ISO code; the profile form stores a display name,
// so map the ones we actually sell into. An unmapped country is dropped rather
// than sent raw, because Stripe rejects the whole request for a bad code and
// that would take checkout down with it.
const ISO2: Record<string, string> = {
  "malaysia": "MY", "singapore": "SG", "indonesia": "ID", "thailand": "TH",
  "philippines": "PH", "vietnam": "VN", "brunei": "BN", "india": "IN",
  "australia": "AU", "new zealand": "NZ", "united kingdom": "GB", "uk": "GB",
  "united states": "US", "united states of america": "US", "usa": "US",
  "canada": "CA", "hong kong": "HK", "japan": "JP", "south korea": "KR",
  "china": "CN", "taiwan": "TW", "united arab emirates": "AE", "uae": "AE",
  "saudi arabia": "SA", "germany": "DE", "france": "FR", "netherlands": "NL",
  "ireland": "IE", "spain": "ES", "italy": "IT",
};
const iso2 = (c?: string | null): string | null => {
  const s = String(c || "").trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return ISO2[s.toLowerCase()] || null;
};

// Everything Stripe needs to render a proper invoice header for this company.
// Used both when minting the customer and to backfill one created before we
// sent any of this, so an existing bare customer is repaired on the next click.
function billingParams(co: Record<string, any> | null, email: string): Record<string, string> {
  const p: Record<string, string> = { email };
  if (co?.name) p.name = co.name;
  if (co?.address_street) p["address[line1]"] = co.address_street;
  if (co?.address_city) p["address[city]"] = co.address_city;
  if (co?.address_state) p["address[state]"] = co.address_state;
  if (co?.address_postcode) p["address[postal_code]"] = co.address_postcode;
  const country = iso2(co?.address_country);
  if (country) p["address[country]"] = country;
  // A company registration number is a legal requirement on invoices in most of
  // the markets we sell into. Stripe renders customer custom fields on the
  // invoice, which is the only place it can go.
  if (co?.registration_no) {
    p["invoice_settings[custom_fields][0][name]"] = "Company No.";
    p["invoice_settings[custom_fields][0][value]"] = String(co.registration_no).slice(0, 30);
  }
  return p;
}

// Stripe expects application/x-www-form-urlencoded.
async function stripe(path: string, params: Record<string, string>, secret: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}
async function stripeGet(path: string, secret: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { plan, cycle, return_url } = await req.json();
    const c = cycle === "yearly" ? "yearly" : "monthly";
    const priceEnv = PRICE_ENV[`${plan}|${c}`];
    if (!priceEnv) return json({ error: "unknown plan or cycle" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("company_id, email, role").eq("id", user.id).maybeSingle();
    const companyId = prof?.company_id;
    if (!companyId) return json({ error: "no company for user" }, 403);
    if (!["owner", "admin"].includes(prof?.role)) return json({ error: "only an admin can subscribe" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = Deno.env.get(priceEnv);
    if (!secret) return json({ error: "billing not configured" }, 503);
    if (!priceId) return json({ error: `missing ${priceEnv}` }, 503);

    // The company details that print on the invoice.
    const { data: company } = await admin
      .from("companies")
      .select("name, registration_no, address_street, address_city, address_state, address_postcode, address_country")
      .eq("id", companyId).maybeSingle();
    const billTo = billingParams(company, prof?.email || user.email || "");

    // Mint a Stripe customer for this company and remember it.
    const newCustomer = async (): Promise<string | null> => {
      const cr = await stripe("customers", { ...billTo, "metadata[company_id]": companyId }, secret);
      if (!cr.ok || !cr.data?.id) { console.error("stripe customer", cr.data); return null; }
      await admin.from("subscriptions").update({ stripe_customer_id: cr.data.id }).eq("company_id", companyId);
      return cr.data.id as string;
    };

    // Reuse the saved customer when we have one.
    const { data: subRow } = await admin
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, plan, cycle")
      .eq("company_id", companyId).maybeSingle();

    // Keep an existing customer's billing details in step with the company profile.
    // Customers minted before we sent name/address are otherwise stuck with a bare
    // email forever, and every invoice they get prints without a "Bill to" block.
    // Best effort: a failure here must not stop them paying.
    if (subRow?.stripe_customer_id) {
      const sync = await stripe(`customers/${subRow.stripe_customer_id}`, billTo, secret);
      if (!sync.ok) console.warn("stripe customer sync", sync.data?.error?.message);
    }

    // ---- Already paying? Then this is a PLAN CHANGE, not a new purchase. ----
    // Sending them through Checkout again would open a SECOND subscription and
    // bill them for both plans at once. Switch the price on the live subscription
    // instead, and let Stripe prorate it.
    const liveSub = subRow?.stripe_subscription_id || null;
    const paying = liveSub && ["active", "past_due", "trialing"].includes(String(subRow?.status || ""));
    if (paying) {
      const cur = await stripeGet(`subscriptions/${liveSub}`, secret);
      const item = cur.ok ? cur.data?.items?.data?.[0] : null;

      // A subscription we can't read (deleted, wrong mode) is not a plan change;
      // fall through and let them buy a fresh one.
      if (item?.id) {
        const already = item.price?.id === priceId;
        if (already) return json({ ok: true, unchanged: true, plan, cycle: c });

        const from = String(subRow?.plan || "");
        const isUpgrade = (RANK[plan] ?? 0) > (RANK[from] ?? 0);
        // Upgrade: bill the difference now, so they pay for what they just got.
        // Downgrade: no refund, credit the unused time against the next invoice.
        const proration = isUpgrade ? "always_invoice" : "create_prorations";

        const upd = await stripe(`subscriptions/${liveSub}`, {
          "items[0][id]": item.id,
          "items[0][price]": priceId,
          proration_behavior: proration,
          "metadata[company_id]": companyId,
          "metadata[plan]": plan,
          "metadata[cycle]": c,
          // We need to know whether the proration charge actually went through.
          "expand[0]": "latest_invoice.payment_intent",
        }, secret);
        if (!upd.ok) {
          console.error("stripe plan change", upd.data);
          return json({ error: "could not change plan", detail: upd.data?.error?.message || null }, 502);
        }

        // An upgrade bills the difference immediately, and that charge is made
        // OFF-SESSION against the saved card. A card that needs 3-D Secure cannot
        // be authenticated with nobody there, so Stripe declines and leaves the
        // subscription past_due with an open invoice. 3DS is effectively mandatory
        // in Malaysia and the EU, so without this every plan change on such a card
        // dead-ends: the customer is billed, not upgraded, and has no way to
        // authenticate from inside Aster.
        //
        // Stripe's hosted invoice page CAN run the 3DS challenge, so hand them
        // there to finish paying.
        const inv = upd.data?.latest_invoice;
        const pi = inv?.payment_intent;
        const needsAuth = pi && ["requires_action", "requires_confirmation", "requires_payment_method"].includes(String(pi.status));
        if (needsAuth || (inv && inv.status === "open" && inv.amount_due > 0)) {
          return json({
            ok: true, changed: true, requires_action: true,
            url: inv?.hosted_invoice_url || null,
            from, to: plan, cycle: c,
            reason: pi?.status || inv?.status || "unpaid",
          });
        }

        // The customer.subscription.updated webhook writes plan/cycle/period to the
        // DB, so we don't duplicate that here.
        return json({
          ok: true, changed: true, from, to: plan, cycle: c,
          direction: isUpgrade ? "upgrade" : "downgrade", proration,
        });
      }
    }

    let customerId: string | null = subRow?.stripe_customer_id || null;
    if (!customerId) {
      customerId = await newCustomer();
      if (!customerId) return json({ error: "could not create customer" }, 502);
    }

    const base = (typeof return_url === "string" && return_url.startsWith("http")) ? return_url.replace(/\/$/, "") : "https://hireaster.com";
    const openCheckout = (cust: string) => stripe("checkout/sessions", {
      mode: "subscription",
      customer: cust,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][company_id]": companyId,
      "subscription_data[metadata][plan]": plan,
      "subscription_data[metadata][cycle]": c,
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[plan]": plan,
      "metadata[cycle]": c,
      allow_promotion_codes: "true",
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=cancel`,
    }, secret);

    let session = await openCheckout(customerId);

    // A saved customer id can stop resolving: it was deleted in Stripe, or it
    // belongs to the other mode (a live id used with a test key, or vice versa).
    // Reusing it blindly would brick checkout for this workspace forever, so mint
    // a fresh customer and try once more instead of dead-ending.
    const stale = !session.ok && /no such customer/i.test(session.data?.error?.message || "");
    if (stale) {
      console.warn(`stripe: stale customer ${customerId} for company ${companyId}; recreating`);
      const fresh = await newCustomer();
      if (!fresh) return json({ error: "could not create customer" }, 502);
      customerId = fresh;
      session = await openCheckout(customerId);
    }

    if (!session.ok || !session.data?.url) { console.error("stripe session", session.data); return json({ error: "could not start checkout", detail: session.data?.error?.message || null }, 502); }

    return json({ ok: true, url: session.data.url });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
