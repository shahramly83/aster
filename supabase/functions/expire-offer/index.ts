// Supabase Edge Function: expire-offer
// ---------------------------------------------------------------------------
// Declines an offer whose expiry date has passed and that the candidate has not
// yet signed. Marks the offer declined and moves the candidate out of the Offer
// stage. Idempotent:
// a second call for an already-settled offer is a no-op. Verifies the caller
// belongs to the offer's company.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { candidateId } = await req.json();
    if (!candidateId) return json({ error: "candidateId is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers")
      .select("id, status, expires_at, esign_envelope_id, esign_status, candidate_id")
      .eq("company_id", companyId).eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!offer) return json({ ok: true, skipped: "no_offer" });

    // Only act on a still-pending offer that is genuinely past its expiry date.
    const settled = offer.status === "accepted" || offer.status === "declined" || offer.esign_status === "completed";
    const past = offer.expires_at && new Date(`${offer.expires_at}T23:59:59`).getTime() < Date.now();
    if (settled || !past) return json({ ok: true, skipped: "not_expired_or_settled" });

    // DocuSign was retired on 2026-07-18 in favour of Aster Sign, so there is no
    // external envelope to void: setting the offer to declined below is what stops
    // the candidate signing, and aster-sign now refuses an expired offer outright.

    await admin.from("offers").update({ status: "declined", esign_status: "voided", responded_at: new Date().toISOString() }).eq("id", offer.id);
    // Move the candidate out of the Offer stage (unless already further along).
    await admin.from("applications").update({ stage: "declined" })
      .eq("company_id", companyId).eq("candidate_id", offer.candidate_id)
      .in("stage", ["offer", "interviewing", "shortlisted"]);

    const { data: ec } = await admin.from("candidates").select("full_name").eq("id", offer.candidate_id).maybeSingle();
    await admin.from("activity_log").insert({ company_id: companyId, type: "offer_expired", title: `${ec?.full_name || "A candidate"}'s offer expired`, description: "The offer lapsed without a signature and was declined.", candidate_id: offer.candidate_id });

    return json({ ok: true, expired: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
