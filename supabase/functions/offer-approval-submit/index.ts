// Supabase Edge Function: offer-approval-submit
// ---------------------------------------------------------------------------
// The hiring manager submits an offer for sequential internal approval. Given an
// offer token + an ordered list of approver emails, it (re)creates the approval
// sequence, marks the offer pending approval (draft, not yet sent to the
// candidate), and emails the FIRST approver the offer letter with a link to
// approve or decline. Used for the initial submit and for resubmit after a
// decline. Verifies the caller belongs to the offer's company.
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailApprover, OFFER_COLS } from "../_shared/offer-model.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { offerToken, approvers, message, origin } = await req.json();
    if (!offerToken) return json({ error: "offerToken is required" }, 400);

    const clean = (Array.isArray(approvers) ? approvers : [])
      .map((a: { email?: string; name?: string }) => ({ email: String(a?.email || "").trim().toLowerCase(), name: (a?.name || "").trim() || null }))
      .filter((a) => emailOk(a.email));
    if (!clean.length) return json({ error: "no valid approver emails" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers").select(OFFER_COLS).eq("token", offerToken).maybeSingle();
    if (!offer || offer.company_id !== companyId) return json({ error: "not found" }, 404);

    // Persist the composed letter body + mark pending approval (draft: not yet
    // sent to the candidate). Wipe any previous chain (fresh submit / resubmit).
    const note = (typeof message === "string" && message.trim()) ? message.trim().slice(0, 20000) : null;
    await admin.from("offers").update({
      approval_status: "pending", status: "draft", ...(note != null ? { message: note } : {}),
    }).eq("id", offer.id);
    await admin.from("offer_approvals").delete().eq("offer_id", offer.id);

    const rows = clean.map((a, i) => ({
      offer_id: offer.id, company_id: companyId, step: i + 1, approver_email: a.email, approver_name: a.name,
    }));
    const { data: inserted, error: insErr } = await admin.from("offer_approvals").insert(rows).select("token, approver_email, approver_name, step");
    if (insErr || !inserted?.length) { console.error("insert approvals", insErr?.message); return json({ error: "could_not_create" }, 500); }

    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin.replace(/\/$/, "") : "https://hireaster.com";
    const first = inserted.sort((a: { step: number }, b: { step: number }) => a.step - b.step)[0];
    const sent = await emailApprover(admin, { ...offer, message: note ?? offer.message }, first, inserted.length, base);
    if (!sent) console.error("approver email failed for", first.approver_email);

    return json({ ok: true, total: inserted.length });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
