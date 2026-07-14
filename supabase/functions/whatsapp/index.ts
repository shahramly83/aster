// Supabase Edge Function: whatsapp
// ---------------------------------------------------------------------------
// The whole server side of the WhatsApp Business integration (Meta Cloud API).
// One function, four actions, so there is a single thing to deploy:
//
//   status     — is this company connected? Returns only safe fields (never the token).
//   connect    — validate a phone-number id + access token against the Graph API,
//                and if they work, store them. Owner/admin only.
//   test       — send the pre-approved "hello_world" template to a number, to prove
//                the connection end to end. Owner/admin only.
//   disconnect — forget the stored credentials. Owner/admin only.
//   send       — send a template message (used by other server code / reminders).
//                Owner/admin only from the client; service callers pass an internal key.
//
// The company is derived from the caller's own profile, never from the request
// body, so one workspace can't touch another's connection. The access token is
// read and written here (service_role) and never returned to the browser.
//
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Pull a human-readable reason out of a Graph API error body.
function graphError(body: unknown): string {
  const e = (body as { error?: { message?: string; error_user_msg?: string } })?.error;
  return e?.error_user_msg || e?.message || "WhatsApp rejected the request. Check the number id and token.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { action, phoneNumberId, accessToken, wabaId, to, template, params } =
      await req.json().catch(() => ({}));

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await admin.from("profiles")
      .select("company_id, role").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no workspace" }, 403);
    const isAdmin = ["owner", "admin"].includes(profile?.role || "");

    // ---- status: safe to read for any member of the workspace ----
    if (action === "status") {
      const { data: row } = await admin.from("whatsapp_connections")
        .select("status, display_phone, verified_name, phone_number_id, waba_id, connected_at")
        .eq("company_id", companyId).maybeSingle();
      return json(row
        ? { connected: true, displayPhone: row.display_phone, verifiedName: row.verified_name,
            phoneNumberId: row.phone_number_id, wabaId: row.waba_id, connectedAt: row.connected_at }
        : { connected: false });
    }

    // Everything past here changes state or sends a message: owner/admin only.
    if (!isAdmin) return json({ error: "Only an owner or hiring manager can manage this." }, 403);

    // ---- connect: prove the credentials work, then store them ----
    if (action === "connect") {
      const pid = String(phoneNumberId || "").trim();
      const tok = String(accessToken || "").trim();
      if (!pid || !tok) return json({ ok: false, error: "Enter both the Phone number ID and the access token." });

      // A GET on the phone number both validates the token and gives us the
      // display number + verified business name to show back.
      const res = await fetch(`${GRAPH}/${pid}?fields=display_phone_number,verified_name,id`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return json({ ok: false, error: graphError(body) });

      const { error: upErr } = await admin.from("whatsapp_connections").upsert({
        company_id: companyId,
        phone_number_id: pid,
        waba_id: wabaId ? String(wabaId).trim() : null,
        display_phone: body.display_phone_number || null,
        verified_name: body.verified_name || null,
        access_token: tok,
        status: "connected",
        connected_by: user.id,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id" });
      if (upErr) { console.error("wa connect upsert", upErr.message); return json({ ok: false, error: "Couldn't save the connection." }); }

      return json({ ok: true, connected: true, displayPhone: body.display_phone_number || null, verifiedName: body.verified_name || null });
    }

    // Actions below need the stored connection.
    const { data: conn } = await admin.from("whatsapp_connections")
      .select("phone_number_id, access_token").eq("company_id", companyId).maybeSingle();

    // ---- disconnect ----
    if (action === "disconnect") {
      await admin.from("whatsapp_connections").delete().eq("company_id", companyId);
      return json({ ok: true, connected: false });
    }

    if (!conn) return json({ ok: false, error: "Connect WhatsApp first." });

    // ---- test: send the pre-approved hello_world template ----
    if (action === "test") {
      const dest = String(to || "").replace(/[^\d]/g, "");
      if (dest.length < 8) return json({ ok: false, error: "Enter a valid phone number, with country code." });
      const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: dest,
          type: "template",
          template: { name: "hello_world", language: { code: "en_US" } },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return json({ ok: false, error: graphError(body) });
      return json({ ok: true, messageId: body?.messages?.[0]?.id || null });
    }

    // ---- send: arbitrary approved template, for reminders/confirmations ----
    if (action === "send") {
      const dest = String(to || "").replace(/[^\d]/g, "");
      if (!template || dest.length < 8) return json({ ok: false, error: "template and a valid `to` are required." });
      const components = Array.isArray(params) && params.length
        ? [{ type: "body", parameters: params.map((t: string) => ({ type: "text", text: String(t) })) }]
        : undefined;
      const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: dest,
          type: "template",
          template: { name: template, language: { code: "en_US" }, ...(components ? { components } : {}) },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return json({ ok: false, error: graphError(body) });
      return json({ ok: true, messageId: body?.messages?.[0]?.id || null });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
