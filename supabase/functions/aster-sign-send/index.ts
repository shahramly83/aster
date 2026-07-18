// Supabase Edge Function: aster-sign-send
// ---------------------------------------------------------------------------
// HR sends an existing offer (offers row + token) to the candidate for signature
// via Aster Sign (our native e-signature). Verifies the caller belongs to the
// offer's company, persists the HR note/letter opening on the offer, marks it
// sent, and emails the candidate a "Review & sign" link to /offer/<token>. The
// candidate signs on that page; the aster-sign function stores the signed PDF.
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs, button } from "../_shared/email.ts";

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
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { token: offerToken, message, origin } = await req.json();
    if (!offerToken) return json({ error: "token is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers")
      .select("company_id, candidate_id, offer_job_title").eq("token", offerToken).maybeSingle();
    if (!offer || offer.company_id !== companyId) return json({ error: "not found" }, 404);

    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
    if (!cand?.email) return json({ error: "candidate has no email" }, 422);

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;

    let jobTitle = offer.offer_job_title || "the role";
    if (!offer.offer_job_title) {
      const { data: app } = await admin.from("applications").select("jobs(title)")
        .eq("company_id", companyId).eq("candidate_id", offer.candidate_id)
        .order("created_at", { ascending: false }).limit(1);
      jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || jobTitle;
    }

    // Persist the HR note (letter opening) so the signing page and the signed PDF
    // render the same letter, then mark the offer sent for signature.
    const note = (typeof message === "string" && message.trim()) ? message.trim().slice(0, 8000) : null;
    await admin.from("offers").update({
      esign_provider: "aster", esign_status: "sent", ...(note != null ? { message: note } : {}),
    }).eq("token", offerToken);

    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin.replace(/\/$/, "") : "https://hireaster.com";
    const signUrl = `${base}/offer/${offerToken}`;

    // The email blurb comes from the editable "offer" template so HR can tailor it.
    const tpl = await loadTemplate(admin, "offer", companyId, {
      subject: "Your offer from {{company_name}}",
      body: "You've received an offer for the {{job_title}} role at {{company_name}}. Review the terms and sign, it only takes a minute.",
    });
    const tokens = { candidate_name: cand.full_name || "there", job_title: jobTitle, company_name: companyName };
    const html = companyShell({
      companyName, logoUrl, heading: "You've received an offer",
      preview: `Your offer for the ${jobTitle} role at ${companyName}.`,
      bodyHtml: `${paragraphs(renderTemplate(tpl.body, tokens))}${button("Review & sign", signUrl)}`,
    });
    const r = await sendEmail({ to: cand.email, subject: renderTemplate(tpl.subject, tokens), html });
    if (!r.ok) { console.error("aster-sign-send email failed", r.error || r.skipped); return json({ error: "email_failed" }, 502); }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
