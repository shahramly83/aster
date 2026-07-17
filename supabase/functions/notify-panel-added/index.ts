// Supabase Edge Function: notify-panel-added
// ---------------------------------------------------------------------------
// A hiring manager swapped a teammate onto an interview panel. Email that
// interviewer (Aster-branded) so they know they're on it, with the candidate,
// role, time, the meeting link if it's already set, and a link into Aster.
//
// Best-effort: the swap + job assignment are already saved, so a mail hiccup
// never blocks anything.
//
// Secrets: RESEND_API_KEY (optional — the send is skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, button, esc } from "../_shared/email.ts";
import { pushToUser } from "../_shared/push.ts";

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
    return new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
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

    const { candidate_id, job_id, interviewer_id } = await req.json();
    if (!candidate_id || !interviewer_id) return json({ error: "candidate_id and interviewer_id are required" }, 400);

    const { data: caller } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = caller?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // The interviewer being added (scoped to the caller's company).
    const { data: iv } = await admin
      .from("profiles").select("email, full_name, company_id").eq("id", interviewer_id).maybeSingle();
    if (!iv || iv.company_id !== companyId || !iv.email) return json({ ok: true, skipped: "no_recipient" });

    // The scheduled interview (for time + meeting link).
    let q = admin.from("interviews").select("scheduled_at, meeting_link, job_id")
      .eq("company_id", companyId).eq("candidate_id", candidate_id).eq("status", "scheduled")
      .order("scheduled_at", { ascending: false }).limit(1);
    if (job_id) q = q.eq("job_id", job_id);
    const { data: interview } = await q.maybeSingle();

    const { data: cand } = await admin.from("candidates").select("full_name").eq("id", candidate_id).maybeSingle();
    const { data: job } = (interview?.job_id || job_id)
      ? await admin.from("jobs").select("title").eq("id", interview?.job_id || job_id).maybeSingle()
      : { data: null };
    const { data: comp } = await admin.from("companies").select("slug").eq("id", companyId).maybeSingle();

    const firstName = (iv.full_name || "there").split(" ")[0] || "there";
    const candidateName = cand?.full_name || "a candidate";
    const roleTitle = job?.title || "a role";
    const whenStr = fmtWhen(interview?.scheduled_at || null);
    const origin = comp?.slug ? `https://${comp.slug}.hireaster.com` : "https://hireaster.com";
    const link = interview?.meeting_link
      ? `<p style="margin:14px 0;">Join the call here: <a href="${esc(interview.meeting_link)}" style="color:#0B2AE0;font-weight:600;word-break:break-all;">${esc(interview.meeting_link)}</a></p>`
      : `<p style="margin:14px 0;">The hiring manager will share the video link before the call.</p>`;

    await sendEmail({
      to: iv.email,
      subject: `You're on the interview panel: ${candidateName} · ${roleTitle}`,
      html: emailShell({
        heading: "You're on the interview panel",
        preview: `You've been added to interview ${candidateName}.`,
        bodyHtml:
          `<p>Hi ${esc(firstName)},</p>` +
          `<p>You've been added to the interview panel for <strong>${esc(candidateName)}</strong>, interviewing for the <strong>${esc(roleTitle)}</strong> position on <strong>${esc(whenStr)}</strong>.</p>` +
          link +
          `<p>Open Aster to review their profile beforehand, and add your scorecard once you're done.</p>` +
          button("Review the candidate", `${origin}/open-roles`),
        footnote: "You're getting this because you were added to this interview panel on Aster.",
      }),
    });

    // Also push to the interviewer's mobile devices, if any. Best-effort: a push
    // failure never affects the email above or the already-saved panel change.
    // Deep link opens the interview straight in the app.
    await pushToUser(admin, interviewer_id, {
      title: "You're on an interview panel",
      body: `${candidateName} · ${roleTitle} · ${whenStr}`,
      data: { url: interview?.job_id || job_id ? `aster://interview/${candidate_id}` : "aster://today" },
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
