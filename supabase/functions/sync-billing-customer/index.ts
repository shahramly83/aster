// Supabase Edge Function: sync-billing-customer
// ---------------------------------------------------------------------------
// Pushes the company profile (legal name, registration no., full address, billing
// email) onto the company's Stripe customer, so it prints in the "Bill to" block
// of every invoice.
//
// Called after the company profile is saved. It has to be its own trigger rather
// than something we do at checkout: Stripe snapshots the customer's details onto
// an invoice at the moment it is finalized, so a renewal three weeks from now
// bills whatever the customer looks like THEN. If we only synced during checkout,
// an address edited afterwards would never reach a single invoice.
//
// Already-issued invoices keep the details they were finalized with. That is
// Stripe's behaviour and it is the correct one: a receipt is a record of what was
// billed, not a live view.
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

// Stripe wants a 2-letter ISO country; the profile form stores a display name.
// An unmapped country is dropped rather than sent raw, because Stripe rejects the
// whole request for a bad code.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("company_id, email, role").eq("id", user.id).maybeSingle();
    if (!prof?.company_id) return json({ error: "no company for user" }, 403);
    if (!["owner", "admin"].includes(prof.role)) return json({ error: "only an admin can change billing details" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ ok: true, synced: false, reason: "billing not configured" });

    const { data: sub } = await admin
      .from("subscriptions").select("stripe_customer_id").eq("company_id", prof.company_id).maybeSingle();
    const customerId = sub?.stripe_customer_id;
    // Never checked out, so there is no customer to keep in step yet. The details
    // will be sent when create-checkout-session mints one.
    if (!customerId) return json({ ok: true, synced: false, reason: "no customer yet" });

    const { data: co } = await admin
      .from("companies")
      .select("name, registration_no, address_street, address_city, address_state, address_postcode, address_country")
      .eq("id", prof.company_id).maybeSingle();

    const params: Record<string, string> = { email: prof.email || user.email || "" };
    if (co?.name) params.name = co.name;
    if (co?.address_street) params["address[line1]"] = co.address_street;
    if (co?.address_city) params["address[city]"] = co.address_city;
    if (co?.address_state) params["address[state]"] = co.address_state;
    if (co?.address_postcode) params["address[postal_code]"] = co.address_postcode;
    const country = iso2(co?.address_country);
    if (country) params["address[country]"] = country;
    // A company registration number is a legal requirement on an invoice in most
    // of the markets we sell into, and a customer custom field is the only place
    // on a Stripe invoice it can go.
    if (co?.registration_no) {
      params["invoice_settings[custom_fields][0][name]"] = "Company No.";
      params["invoice_settings[custom_fields][0][value]"] = String(co.registration_no).slice(0, 30);
    }

    const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      // A stale customer (deleted, or from the other Stripe mode) is not worth
      // failing a profile save over; checkout already recovers from it.
      console.error("stripe customer sync", data);
      return json({ ok: true, synced: false, reason: data?.error?.message || "stripe rejected the update" });
    }

    return json({ ok: true, synced: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
