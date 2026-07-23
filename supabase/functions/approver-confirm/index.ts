// Supabase Edge Function: approver-confirm  (PUBLIC — deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// The one-time link an approver clicks to confirm they'll approve offers. No
// account, no login: possession of the confirm_token is the proof. Flips the
// offer_approvers row to 'confirmed' so they become selectable as an approver.
//
// Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ error: "token is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin.from("offer_approvers")
      .select("id, company_id, email, name, status").eq("confirm_token", token).maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);

    if (row.status !== "confirmed") {
      await admin.from("offer_approvers").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", row.id);
    }

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", row.company_id).maybeSingle();
    return json({ ok: true, name: row.name || null, email: row.email, companyName: comp?.name || "the hiring team", logoUrl: comp?.logo_url || null });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
