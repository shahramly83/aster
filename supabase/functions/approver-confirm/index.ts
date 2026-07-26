// Supabase Edge Function: approver-confirm  (PUBLIC — deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// The one-time link an approver clicks to confirm they'll approve offers. No
// account, no login: possession of the confirm_token is the proof. Flips the
// offer_approvers row to 'confirmed' so they become selectable as an approver.
//
// Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailApprover, OFFER_COLS } from "../_shared/offer-model.ts";

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
    const { token, origin } = await req.json().catch(() => ({}));
    if (!token) return json({ error: "token is required" }, 400);
    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin.replace(/\/$/, "") : "https://hireaster.com";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin.from("offer_approvers")
      .select("id, company_id, email, name, status").eq("confirm_token", token).maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);

    const wasPending = row.status !== "confirmed";
    if (wasPending) {
      await admin.from("offer_approvers").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", row.id);
      // Release any offers that were held at THIS approver's step (added to a
      // chain before they'd confirmed). For each of their pending steps that is
      // now the live turn (all prior steps approved) on an offer still pending
      // approval, email them the approval request so the chain can proceed.
      try {
        const { data: mySteps } = await admin.from("offer_approvals")
          .select("id, offer_id, step, token, approver_email, approver_name")
          .eq("company_id", row.company_id).eq("status", "pending").ilike("approver_email", row.email);
        for (const st of mySteps || []) {
          const { data: prior } = await admin.from("offer_approvals").select("status").eq("offer_id", st.offer_id).lt("step", st.step);
          if ((prior || []).some((p: { status: string }) => p.status !== "approved")) continue; // not their live turn yet
          const { data: offer } = await admin.from("offers").select(OFFER_COLS).eq("id", st.offer_id).maybeSingle();
          if (!offer || offer.approval_status !== "pending") continue; // declined/approved/closed
          const { data: all } = await admin.from("offer_approvals").select("step").eq("offer_id", st.offer_id);
          await emailApprover(admin, offer, st, (all || []).length || 1, base);
        }
      } catch (e) { console.error("release held offers", e); }
    }

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", row.company_id).maybeSingle();
    return json({ ok: true, name: row.name || null, email: row.email, companyName: comp?.name || "the hiring team", logoUrl: comp?.logo_url || null });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
