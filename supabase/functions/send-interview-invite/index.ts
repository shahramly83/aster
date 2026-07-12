// Supabase Edge Function: send-interview-invite
// ---------------------------------------------------------------------------
// After HR sends an interview invite (the app has already inserted the
// interviews row with proposed slots + a token), this emails the candidate a
// link to /book/<token> to pick a time. Verifies the caller belongs to the
// interview's company before touching candidate PII. Best-effort send.
//
// Secrets: RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs, button } from "../_shared/email.ts";

const SITE = "https://hireaster.com";
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
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { token: inviteToken } = await req.json();
    if (!inviteToken) return json({ error: "token is required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: iv } = await admin
      .from("interviews").select("company_id, candidate_id, job_id, interviewer_name").eq("token", inviteToken).maybeSingle();
    if (!iv || iv.company_id !== companyId) return json({ error: "not found" }, 404);

    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", iv.candidate_id).maybeSingle();
    if (!cand?.email) return json({ ok: true, skipped: "no_candidate_email" });

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    let jobTitle = "the role";
    if (iv.job_id) {
      const { data: job } = await admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle();
      jobTitle = job?.title || jobTitle;
    }

    const bookingLink = `${SITE}/book/${inviteToken}`;
    const tpl = await loadTemplate(admin, "interview_invite", companyId, {
      subject: "Pick a time for your {{job_title}} interview",
      body: "Hi {{candidate_name}},\n\nWe'd like to interview you for the {{job_title}} role at {{company_name}}, and you'll be meeting {{interviewer_name}}.\n\nPick whichever time suits you best. Once you choose, we'll send the calendar invite and joining details to your inbox.",
    });
    const tokens = {
      candidate_name: cand.full_name || "there",
      job_title: jobTitle,
      company_name: companyName,
      interviewer_name: iv.interviewer_name || "the hiring team",
      booking_link: bookingLink,
    };
    // The booking link is a proper CTA button (not a raw URL pasted into the
    // prose), with a small text fallback for clients that strip buttons.
    const bodyHtml = paragraphs(renderTemplate(tpl.body, tokens))
      + button("Pick a time", bookingLink)
      + `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#8B8699;">If the button doesn't work, <a href="${bookingLink}" style="color:#0B2AE0;text-decoration:underline;">open your booking page here</a>.</p>`;
    await sendEmail({
      to: cand.email,
      subject: renderTemplate(tpl.subject, tokens),
      html: companyShell({
        companyName, logoUrl,
        heading: "Pick a time for your interview",
        preview: `Choose a time for your ${jobTitle} interview with ${companyName}.`,
        bodyHtml,
      }),
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
