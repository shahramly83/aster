// Supabase Edge Function: share-meeting-link
// ---------------------------------------------------------------------------
// The hiring manager pastes the video-call link they created (Meet / Zoom /
// Teams). This saves it on the interview and emails EVERYONE the same link with
// a message tailored to who they are:
//   - the candidate gets a company-branded "your interview link" note,
//   - each interviewer on the panel gets an Aster-branded internal heads-up.
//
// Secrets: RESEND_API_KEY (optional — sends are skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, emailShell, esc } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fmtWhen(iso: string | null): string {
  if (!iso) return "the scheduled time";
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    });
  } catch { return "the scheduled time"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { candidate_id, job_id, meeting_link } = await req.json();
    const link = String(meeting_link || "").trim();
    if (!candidate_id || !/^https?:\/\/\S+$/i.test(link)) {
      return json({ error: "candidate_id and a valid meeting_link (http/https) are required" }, 400);
    }

    // Scope to the caller's company; only managers run interviews.
    const { data: caller } = await admin.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    const companyId = caller?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // The scheduled interview for this candidate (+ job when given).
    let q = admin.from("interviews")
      .select("id, scheduled_at, attendees, job_id")
      .eq("company_id", companyId).eq("candidate_id", candidate_id).eq("status", "scheduled")
      .order("scheduled_at", { ascending: false }).limit(1);
    if (job_id) q = q.eq("job_id", job_id);
    const { data: iv } = await q.maybeSingle();
    if (!iv) return json({ error: "no scheduled interview for this candidate" }, 404);

    // Persist the link.
    await admin.from("interviews").update({ meeting_link: link }).eq("id", iv.id);

    // Who + what for the emails.
    const { data: cand } = await admin.from("candidates").select("full_name, email").eq("id", candidate_id).maybeSingle();
    const { data: job } = iv.job_id
      ? await admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle()
      : { data: null };
    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const roleTitle = job?.title || "the role";
    const whenStr = fmtWhen(iv.scheduled_at);
    const candidateName = cand?.full_name || "there";
    const linkHtml = `<p style="margin:16px 0;"><a href="${esc(link)}" style="color:#0B2AE0;font-weight:600;word-break:break-all;">${esc(link)}</a></p>`;

    let candidateSent = false;
    const results: string[] = [];

    // 1) The candidate (company-branded).
    if (cand?.email) {
      await sendEmail({
        to: cand.email,
        subject: `Your interview link: ${roleTitle} at ${companyName}`,
        html: companyShell({
          companyName, logoUrl: comp?.logo_url || null,
          heading: "Here's your interview link",
          preview: `Your video link for the ${roleTitle} interview.`,
          bodyHtml:
            `<p>Hi ${esc(candidateName.split(" ")[0] || "there")},</p>` +
            `<p>Your interview for the <strong>${esc(roleTitle)}</strong> role is confirmed for <strong>${esc(whenStr)}</strong>. Join the video call here at that time:</p>` +
            linkHtml +
            `<p>Please join a couple of minutes early to check your camera and mic. See you then.</p>`,
        }),
      });
      candidateSent = true;
      results.push("candidate");
    }

    // 2) The interview panel (Aster-branded internal note). Skip the candidate if
    // they somehow appear, and de-dupe by email.
    const attendees = Array.isArray(iv.attendees) ? iv.attendees as { name?: string; email?: string }[] : [];
    const seen = new Set<string>();
    if (cand?.email) seen.add(cand.email.toLowerCase());
    for (const a of attendees) {
      const email = (a?.email || "").trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      await sendEmail({
        to: email,
        subject: `Interview link: ${candidateName} · ${roleTitle}`,
        html: emailShell({
          heading: "Interview link",
          preview: `Video link for your interview with ${candidateName}.`,
          bodyHtml:
            `<p>Hi ${esc((a?.name || "there").split(" ")[0] || "there")},</p>` +
            `<p>You're interviewing <strong>${esc(candidateName)}</strong> for the <strong>${esc(roleTitle)}</strong> role on <strong>${esc(whenStr)}</strong>. Join the panel here:</p>` +
            linkHtml +
            `<p>Your scorecard for this candidate is ready in Aster once the interview is done.</p>`,
          footnote: "You're getting this because you're on this interview panel on Aster.",
        }),
      });
      results.push("panel");
    }

    return json({ ok: true, candidate: candidateSent, panel: results.filter((r) => r === "panel").length });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
