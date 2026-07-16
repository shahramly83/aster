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
    const { plan, cycle, return_url, currency } = await req.json();
    // Optional display/billing currency for a NEW subscription. Must match a
    // currency_option configured on the Price; anything else is ignored and the
    // Price's base currency is used. A plan change keeps the existing subscription's
    // currency (Stripe won't switch it), so this only applies to fresh checkouts.
    const cur = ["usd", "myr", "sgd"].includes(String(currency || "").toLowerCase())
      ? String(currency).toLowerCase() : null;
    // Validate the cycle, do not coerce it. This used to be
    //   const c = cycle === "yearly" ? "yearly" : "monthly";
    // so ANY value that was not the literal "yearly" silently became monthly. A
    // typo, a stale client or a crafted call would then reprice a live yearly
    // subscription onto the monthly plan and prorate it, without ever being asked.
    // Unvalidated input must not be allowed to move a customer's billing period.
    if (cycle !== "monthly" && cycle !== "yearly") return json({ error: "unknown plan or cycle" }, 400);
    const c = cycle;
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
    // Billing belongs to the account owner alone. A hiring manager is 'admin', and
    // admins used to pass this check: any recruiter could upgrade, downgrade or
    // CANCEL the company's subscription.
    if (prof?.role !== "owner") return json({ error: "only the account owner can change the plan" }, 403);

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
      .select("stripe_customer_id, stripe_subscription_id, status, plan, cycle, stripe_schedule_id")
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

      // The DB says this company has an ACTIVE paid subscription. If Stripe won't
      // return it with the current key, do NOT fall through to opening a fresh
      // Checkout: that mints a SECOND live subscription and bills the customer
      // twice (exactly what the block above is meant to prevent). An unreadable
      // subscription here is almost always a mode mismatch (a test-mode sub id
      // under a live key, or vice versa) or a subscription deleted out from under
      // us while the DB still reads "active". Both are data/config faults for an
      // admin to reconcile, not a reason to charge again. Refuse and surface it.
      if (!item?.id) {
        console.error("plan change: DB shows active sub but Stripe can't read it", {
          companyId, liveSub, status: subRow?.status, error: cur.data?.error?.message || null,
        });
        return json({
          error: "subscription_unreadable",
          detail: "We couldn't load your current subscription to switch plans. This usually means the billing key and the subscription are in different Stripe modes. Please contact support before subscribing again, so you aren't billed twice.",
        }, 409);
      }
      const subObj = cur.data;
      const trialing = String(subObj?.status) === "trialing";
      const already = item.price?.id === priceId;
      const from = String(subRow?.plan || "");
      const fromCycle = subRow?.cycle === "yearly" ? "yearly" : "monthly";
      // The schedule the LIVE subscription is actually attached to is the source of
      // truth, not the DB. They drift (a write that didn't land, a manual change in
      // Stripe), and acting on a stale DB value tries to create a second schedule,
      // which Stripe rejects ("already attached to a schedule"). Prefer the live id.
      const attachedScheduleId = typeof subObj?.schedule === "string"
        ? subObj.schedule
        : (subObj?.schedule?.id || null);
      const knownScheduleId = attachedScheduleId || subRow?.stripe_schedule_id || null;

      // Release the subscription's schedule and clear the DB bookkeeping. Called
      // when the customer re-selects their current plan (cancel the downgrade) or
      // upgrades (an immediate change supersedes a scheduled one). Releasing is also
      // REQUIRED before Stripe will let us modify the subscription's items.
      const clearSchedule = async () => {
        if (knownScheduleId) {
          const rel = await stripe(`subscription_schedules/${knownScheduleId}/release`, {}, secret);
          if (!rel.ok && !/released|canceled|completed/i.test(rel.data?.error?.message || "")) {
            console.warn("schedule release", rel.data?.error?.message);
          }
        }
        await admin.from("subscriptions").update({
          scheduled_plan: null, scheduled_cycle: null, scheduled_effective: null, stripe_schedule_id: null,
        }).eq("company_id", companyId);
      };

      // Re-selecting the plan they're already on cancels any pending downgrade and
      // does nothing else. This is also how the "Cancel scheduled change" button works.
      if (already) {
        await clearSchedule();
        return json({ ok: true, unchanged: true, plan, cycle: c });
      }

      // Direction. Upgrade = pay more / bigger commitment => apply NOW and charge.
      // Downgrade = pay less / smaller commitment => DEFER to the end of the paid
      // period. A tier rise is always an upgrade; at the same tier, monthly->yearly
      // is an upgrade and yearly->monthly is a downgrade.
      const tierUp = (RANK[plan] ?? 0) > (RANK[from] ?? 0);
      const tierDown = (RANK[plan] ?? 0) < (RANK[from] ?? 0);
      const cycleUp = fromCycle === "monthly" && c === "yearly";
      const isUpgrade = tierUp || (!tierDown && cycleUp);
      // A trial has nothing paid to protect, so every change applies immediately.
      const immediate = trialing || isUpgrade;

      if (immediate) {
        // An immediate change supersedes any scheduled downgrade.
        await clearSchedule();

        const params: Record<string, string> = {
          "items[0][id]": item.id,
          "items[0][price]": priceId,
          "metadata[company_id]": companyId,
          "metadata[plan]": plan,
          "metadata[cycle]": c,
          "expand[0]": "latest_invoice.payment_intent",
        };
        if (trialing) {
          // Mid-trial: no money moves. Just swap which plan converts at trial end.
          params.proration_behavior = "none";
        } else {
          // Paid upgrade: bill the prorated difference now, and HOLD the upgrade
          // until that balance is actually paid. pending_if_incomplete leaves the
          // customer on their OLD plan with an open invoice if the card needs 3-D
          // Secure or declines, instead of upgrading them unpaid. The webhook
          // applies the new plan only once payment lands.
          params.proration_behavior = "always_invoice";
          params.payment_behavior = "pending_if_incomplete";
          // A cycle change (e.g. monthly -> yearly) starts a fresh term now, so
          // reset the billing anchor; otherwise they keep the old renewal date.
          if (fromCycle !== c) params.billing_cycle_anchor = "now";
        }

        const upd = await stripe(`subscriptions/${liveSub}`, params, secret);
        if (!upd.ok) {
          console.error("stripe plan change", upd.data);
          return json({ error: "could not change plan", detail: upd.data?.error?.message || null }, 502);
        }

        if (trialing) return json({ ok: true, changed: true, trial: true, from, to: plan, cycle: c });

        // Held upgrade: the balance still needs paying (3-D Secure, a retry, or the
        // off-session charge didn't clear). The plan has NOT switched yet (pending
        // update); send them to Stripe's hosted invoice to pay. The webhook flips
        // the plan once payment lands.
        const inv = upd.data?.latest_invoice;
        const pi = inv?.payment_intent;
        const needsAuth = pi && ["requires_action", "requires_confirmation", "requires_payment_method"].includes(String(pi.status));
        if (needsAuth || upd.data?.pending_update || (inv && inv.status !== "paid" && (inv.amount_due ?? 0) > 0)) {
          // Guarantee a payment page. A just-created invoice can still be a draft
          // with no hosted url; finalize it so there is always a link to pay at.
          let payUrl = inv?.hosted_invoice_url || null;
          if (!payUrl && inv?.id) {
            let fin = await stripe(`invoices/${inv.id}/finalize`, {}, secret);
            // Already finalized is not an error for us: re-fetch to read its url.
            if (!fin.ok && /already been finalized|not.*draft/i.test(fin.data?.error?.message || "")) {
              fin = await stripeGet(`invoices/${inv.id}`, secret);
            }
            payUrl = fin.ok ? (fin.data?.hosted_invoice_url || null) : null;
          }
          if (!payUrl) {
            // No page to send them to means we can't collect safely; surface it
            // rather than leaving a silent half-applied upgrade.
            console.error("held upgrade: no hosted invoice url", { companyId, invoice: inv?.id, status: inv?.status });
            return json({ error: "could not open a payment page for the upgrade. Please try again or contact support." }, 502);
          }
          return json({
            ok: true, requires_action: true, held: true,
            url: payUrl,
            from, to: plan, cycle: c, reason: pi?.status || inv?.status || "unpaid",
          });
        }
        // Paid straight through. Write the new plan NOW so a reload reflects it
        // immediately; the webhook still lands and reconciles (period end etc.).
        // Without this the page reloads before the webhook syncs and shows the OLD
        // plan until the next refresh, which reads as "the upgrade didn't work".
        await admin.from("subscriptions").update({ plan, cycle: c, status: "active" }).eq("company_id", companyId);
        await admin.from("companies").update({ plan }).eq("id", companyId);
        return json({ ok: true, changed: true, direction: "upgrade", from, to: plan, cycle: c });
      }

      // ---- Downgrade: DEFER to the end of the paid period via a subscription
      // schedule. Nothing is charged or credited now. Phase 0 keeps the current
      // plan until the period ends; phase 1 switches to the new plan and bills it
      // normally (a full new-cycle charge, no proration). end_behavior=release lets
      // it renew normally on the new plan afterwards. This is what keeps a yearly
      // customer on full features until their year is actually up.
      const periodEnd = item.current_period_end ?? subObj?.current_period_end ?? null;

      // Reuse the schedule the subscription is already attached to (the customer is
      // changing a pending downgrade), else create one from the live subscription.
      // knownScheduleId prefers the LIVE attachment over the DB, so a drifted DB
      // can't make us try to create a duplicate schedule (Stripe rejects that).
      let scheduleId = knownScheduleId;
      let phase0: Record<string, any> | null = null;
      if (scheduleId) {
        const sc = await stripeGet(`subscription_schedules/${scheduleId}`, secret);
        if (sc.ok && !["released", "canceled", "completed"].includes(String(sc.data?.status))) {
          phase0 = sc.data?.phases?.[0] || null;
        } else {
          scheduleId = null; // stale/ended; make a fresh one
        }
      }
      if (!scheduleId) {
        const created = await stripe("subscription_schedules", { from_subscription: liveSub }, secret);
        if (!created.ok || !created.data?.id) {
          console.error("schedule create", created.data);
          return json({ error: "could not schedule the change", detail: created.data?.error?.message || null }, 502);
        }
        scheduleId = created.data.id;
        phase0 = created.data?.phases?.[0] || null;
      }

      const p0Price = phase0?.items?.[0]?.price || item.price?.id;
      const p0Start = phase0?.start_date;
      const p0End = phase0?.end_date ?? periodEnd;
      // Phase 0 = current plan until the period ends (echoed back unchanged so
      // Stripe accepts the already-started phase). Phase 1 = the new plan, open
      // ended so it just renews normally on the lower plan. end_behavior=release so
      // the subscription isn't left permanently managed by the schedule.
      const schedParams: Record<string, string> = {
        end_behavior: "release",
        "phases[0][items][0][price]": String(p0Price),
        "phases[0][items][0][quantity]": "1",
        "phases[1][items][0][price]": priceId,
        "phases[1][items][0][quantity]": "1",
      };
      if (p0Start) schedParams["phases[0][start_date]"] = String(p0Start);
      if (p0End) schedParams["phases[0][end_date]"] = String(p0End);

      const schedUpd = await stripe(`subscription_schedules/${scheduleId}`, schedParams, secret);
      if (!schedUpd.ok) {
        console.error("schedule update", schedUpd.data);
        return json({ error: "could not schedule the change", detail: schedUpd.data?.error?.message || null }, 502);
      }

      const effective = p0End ? new Date(Number(p0End) * 1000).toISOString().slice(0, 10) : null;
      await admin.from("subscriptions").update({
        scheduled_plan: plan,
        scheduled_cycle: c,
        scheduled_effective: effective,
        stripe_schedule_id: scheduleId,
      }).eq("company_id", companyId);

      return json({ ok: true, scheduled: true, effective, from, to: plan, cycle: c });
    }

    let customerId: string | null = subRow?.stripe_customer_id || null;
    if (!customerId) {
      customerId = await newCustomer();
      if (!customerId) return json({ error: "could not create customer" }, 502);
    }

    // ---- Duplicate-subscription safeguard. ----
    // We only get here when the DB did NOT show a live subscription to switch. But
    // the DB can drift out of step with Stripe: a webhook that never landed, or a
    // subscription created under a Stripe mode the previous key couldn't read. If
    // Stripe already holds a live subscription for THIS customer, opening a fresh
    // Checkout mints a SECOND one and bills the customer twice — every such pair
    // then stacks prorations into a runaway credit balance (this is how a downgrade
    // can show a credit larger than a whole year of the plan). So before opening
    // Checkout, ask Stripe directly. If a live subscription exists, adopt it back
    // into the DB and ask the caller to retry — the retry then takes the normal
    // plan-change path with the row back in sync.
    const existing = await stripeGet(`subscriptions?customer=${customerId}&status=all&limit=20`, secret);
    const liveExisting = (existing.ok ? (existing.data?.data as Array<Record<string, any>>) : [])
      ?.find((s) => ["active", "trialing", "past_due"].includes(String(s?.status)));
    if (liveExisting?.id) {
      const m = (liveExisting.metadata || {}) as Record<string, string>;
      const reUpd: Record<string, unknown> = {
        stripe_subscription_id: liveExisting.id,
        stripe_customer_id: customerId,
        status: liveExisting.status === "past_due" ? "past_due" : "active",
      };
      if (m.plan && RANK[m.plan]) reUpd.plan = m.plan;
      if (m.cycle === "monthly" || m.cycle === "yearly") reUpd.cycle = m.cycle;
      await admin.from("subscriptions").update(reUpd).eq("company_id", companyId);
      console.error("reconciled orphaned Stripe subscription; refused to open a duplicate", { companyId, subId: liveExisting.id, status: liveExisting.status });
      return json({
        error: "subscription_desynced",
        detail: "We found a subscription that wasn't linked to your account and reconnected it. Please try changing your plan again.",
      }, 409);
    }

    const base = (typeof return_url === "string" && return_url.startsWith("http")) ? return_url.replace(/\/$/, "") : "https://hireaster.com";
    const openCheckout = (cust: string) => stripe("checkout/sessions", {
      mode: "subscription",
      customer: cust,
      // Multi-currency: charge in the chosen currency (Stripe picks the matching
      // currency_option on the Price). Omit to use the Price's base currency.
      ...(cur ? { currency: cur } : {}),
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
