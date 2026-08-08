// Supabase Edge Function: admin-promos
// ---------------------------------------------------------------------------
// Create, list and switch off Stripe promotion codes from the admin portal,
// instead of leaving the Stripe dashboard as the only way to run an offer.
//
// Stripe models a promo in two objects and both matter here:
//   * coupon          — the discount itself (percent off, how long it lasts)
//   * promotion_code  — the string a customer types, plus its expiry, its
//                       redemption cap and who is allowed to use it
// A coupon's discount can never be edited and a code string can never be
// reattached to a different coupon, so "change the offer" always means "create
// a new code". Every action here is therefore additive or a deactivation;
// nothing edits a discount in place, because Stripe would refuse.
//
// One coupon per code on purpose: sharing a coupon between codes means editing
// nothing later without affecting every code that points at it.
//
// Admin-only, and narrower than that: super and billing. Guarded on
// admin_users, the same table is_admin() reads.
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

async function stripe(path: string, secret: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(params ? { body: new URLSearchParams(params).toString() } : {}),
  });
  return { ok: res.ok, data: await res.json() };
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
    const { data: who } = await admin.from("admin_users").select("role, status").eq("id", user.id).maybeSingle();
    if (!who || who.status !== "active") return json({ error: "forbidden" }, 403);
    if (who.role !== "super" && who.role !== "billing") return json({ error: "forbidden" }, 403);

    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "billing not configured" }, 503);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list");

    // ---- list --------------------------------------------------------------
    if (action === "list") {
      // Expanding the coupon avoids a second call per code just to learn what
      // the discount actually is, which is the first thing anyone wants to see.
      const res = await fetch("https://api.stripe.com/v1/promotion_codes?limit=100&expand[]=data.coupon", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok) return json({ error: "could not load promo codes", detail: data?.error?.message || null }, 502);

      const codes = (data.data || []).map((p: Record<string, any>) => ({
        id: p.id,
        code: p.code,
        active: !!p.active,
        created: p.created,
        expires_at: p.expires_at ?? null,
        max_redemptions: p.max_redemptions ?? null,
        times_redeemed: p.times_redeemed ?? 0,
        first_time_transaction: !!p?.restrictions?.first_time_transaction,
        minimum_amount: p?.restrictions?.minimum_amount ?? null,
        minimum_amount_currency: p?.restrictions?.minimum_amount_currency ?? null,
        customer: typeof p.customer === "string" ? p.customer : p.customer?.id ?? null,
        // Stripe returns coupon expanded here, but a code whose coupon was
        // deleted comes back with nothing to read, which rendered as a bare
        // dash. Carry the id so the screen can at least name it.
        coupon_id: typeof p.coupon === "string" ? p.coupon : p?.coupon?.id ?? null,
        percent_off: p?.coupon?.percent_off ?? null,
        amount_off: p?.coupon?.amount_off ?? null,
        coupon_currency: p?.coupon?.currency ?? null,
        duration: p?.coupon?.duration ?? null,
        duration_in_months: p?.coupon?.duration_in_months ?? null,
      }));

      // Name the workspace behind a targeted code. Without this the screen shows
      // a raw cus_… id, which tells an admin nothing about who it was for.
      const custIds = [...new Set(codes.map((c: any) => c.customer).filter(Boolean))];
      const names: Record<string, string> = {};
      if (custIds.length) {
        const { data: subs } = await admin
          .from("subscriptions").select("stripe_customer_id, company_id, companies(name)")
          .in("stripe_customer_id", custIds as string[]);
        for (const s of subs || []) {
          const cid = (s as any).stripe_customer_id;
          const nm = (s as any).companies?.name;
          if (cid && nm) names[cid] = nm;
        }
      }
      for (const c of codes) if (c.customer) c.customer_name = names[c.customer] || null;

      return json({ ok: true, codes });
    }

    // ---- create ------------------------------------------------------------
    if (action === "create") {
      const code = String(body?.code || "").trim().toUpperCase();
      const percentOff = Number(body?.percent_off);
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return json({ error: "Code must be 3-40 letters, digits, dash or underscore." }, 400);
      if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
        return json({ error: "Percent off must be between 1 and 100." }, 400);
      }

      // Refuse before creating a coupon, not after: a duplicate code would
      // otherwise leave an orphan coupon behind on every failed attempt.
      const existing = await fetch(`https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(code)}&limit=1`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const existingData = await existing.json();
      if (existing.ok && (existingData.data || []).length) {
        return json({ error: `${code} already exists in Stripe. A code string can never be reused.` }, 409);
      }

      const duration = ["once", "forever", "repeating"].includes(String(body?.duration)) ? String(body.duration) : "once";
      const couponParams: Record<string, string> = {
        percent_off: String(percentOff),
        duration,
        name: `${code} (${percentOff}% off)`,
      };
      if (duration === "repeating") {
        const months = Math.max(1, Math.min(36, Number(body?.duration_in_months) || 1));
        couponParams.duration_in_months = String(months);
      }
      const coupon = await stripe("coupons", secret, couponParams);
      if (!coupon.ok) return json({ error: "could not create the discount", detail: coupon.data?.error?.message || null }, 502);

      const promoParams: Record<string, string> = { coupon: coupon.data.id, code };
      if (body?.expires_at) {
        const ts = Math.floor(new Date(String(body.expires_at)).getTime() / 1000);
        if (Number.isFinite(ts) && ts > Math.floor(Date.now() / 1000)) promoParams.expires_at = String(ts);
      }
      if (Number(body?.max_redemptions) > 0) promoParams.max_redemptions = String(Math.floor(Number(body.max_redemptions)));
      if (body?.first_time_only) promoParams["restrictions[first_time_transaction]"] = "true";

      // Targeting: the admin picks a workspace, never a Stripe id. Resolving it
      // here keeps customer ids out of the browser entirely.
      let targetName: string | null = null;
      if (body?.company_id) {
        const { data: sub } = await admin
          .from("subscriptions").select("stripe_customer_id, companies(name)")
          .eq("company_id", String(body.company_id)).maybeSingle();
        const cus = (sub as any)?.stripe_customer_id;
        if (!cus) return json({ error: "That workspace has never checked out, so it has no Stripe customer to restrict the code to." }, 400);
        promoParams.customer = cus;
        targetName = (sub as any)?.companies?.name || null;
      }

      const promo = await stripe("promotion_codes", secret, promoParams);
      if (!promo.ok) {
        // The coupon is already created at this point. Say so, rather than
        // leaving an admin to wonder what state Stripe is in.
        return json({
          error: "could not create the code",
          detail: promo.data?.error?.message || null,
          orphan_coupon: coupon.data.id,
        }, 502);
      }

      return json({ ok: true, id: promo.data.id, code, percent_off: percentOff, target: targetName });
    }

    // ---- activate / deactivate --------------------------------------------
    if (action === "set_active") {
      const id = String(body?.id || "");
      if (!/^promo_/.test(id)) return json({ error: "unknown promo code" }, 400);
      const res = await stripe(`promotion_codes/${id}`, secret, { active: body?.active ? "true" : "false" });
      if (!res.ok) return json({ error: "could not update the code", detail: res.data?.error?.message || null }, 502);
      return json({ ok: true, id, active: !!res.data.active, code: res.data.code });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("admin-promos", e);
    return json({ error: "promo request failed" }, 500);
  }
});
