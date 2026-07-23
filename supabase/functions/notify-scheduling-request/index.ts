// Supabase Edge Function: notify-scheduling-request
// ---------------------------------------------------------------------------
// An interviewer requested an interview with a candidate (request_scheduling
// filed the schedule_requests row). This emails the workspace's hiring managers
// (owner + admins) so they know to set it up, with a deep link straight to the
// candidate's profile where the scheduling panel lives.
//
// Exactly-once: it claims schedule_requests.notified_at atomically, so a retry
// or a dedupe hit (re-clicking Request) never emails the team twice.
//
// Secrets: RESEND_API_KEY (optional — the send is skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, button, loadTemplate, renderTemplate, paragraphs } from "../_shared/email.ts";
import { pushToCompanyAdmins } from "../_shared/push.ts";

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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { application_id } = await req.json();
    if (!application_id) return json({ error: "application_id is required" }, 400);

    // The requester's profile gives us their name and scopes the lookup to their
    // own company (so this can only notify within the caller's workspace).
    const { data: reqProfile } = await admin
      .from("profiles").select("full_name, company_id").eq("id", user.id).maybeSingle();
    const companyId = reqProfile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // The open request just filed for this application. Claim its notification
    // atomically — only the invocation that flips notified_at from null sends mail.
    const { data: sr } = await admin
      .from("schedule_requests").select("id, notified_at")
      .eq("company_id", companyId).eq("application_id", application_id).is("resolved_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!sr) return json({ ok: true, skipped: "no_open_request" });
    const { data: claimed } = await admin
      .from("schedule_requests").update({ notified_at: new Date().toISOString() })
      .eq("id", sr.id).is("notified_at", null).select("id");
    if (!claimed || claimed.length === 0) return json({ ok: true, skipped: "already_notified" });

    // Details for the email: candidate + role, plus a deep link to the profile.
    const { data: app } = await admin
      .from("applications").select("candidate_id, job_id").eq("id", application_id).maybeSingle();
    const { data: cand } = app?.candidate_id
      ? await admin.from("candidates").select("full_name").eq("id", app.candidate_id).maybeSingle()
      : { data: null };
    const { data: job } = app?.job_id
      ? await admin.from("jobs").select("title").eq("id", app.job_id).maybeSingle()
      : { data: null };
    const { data: comp } = await admin.from("companies").select("name, slug").eq("id", companyId).maybeSingle();

    // Recipients: the workspace's hiring managers (owner + admins).
    const { data: recips } = await admin
      .from("profiles").select("email").eq("company_id", companyId)
      .in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
    const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
    if (!to.length) return json({ ok: true, skipped: "no_recipient" });

    const requesterName = reqProfile?.full_name || "An interviewer";
    const candidateName = cand?.full_name || "a candidate";
    const roleTitle = job?.title || "a role";
    const dashUrl = comp?.slug && app?.candidate_id
      ? `https://${comp.slug}.hireaster.com/candidates/${app.candidate_id}${app.job_id ? `?job=${app.job_id}` : ""}`
      : "https://hireaster.com/login";

    const tpl = await loadTemplate(admin, "interview_requested", companyId, {
      subject: "{{requester_name}} requested an interview: {{candidate_name}}",
      body: "{{requester_name}} wants to interview {{candidate_name}} for the {{job_title}} position.\n\nSet it up from the candidate's profile: pick a time, and Aster sends the calendar invite and video link automatically.",
    });
    const tokens = { requester_name: requesterName, candidate_name: candidateName, job_title: roleTitle };
    await sendEmail({
      to,
      subject: renderTemplate(tpl.subject, tokens),
      html: emailShell({
        heading: "Interview requested",
        preview: `${requesterName} requested an interview with ${candidateName}.`,
        bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) + button("Set up the interview", dashUrl),
        footnote: "You're getting this because you manage hiring for this workspace on Aster.",
      }),
    });

    // Bell record, so a dismissed push still leaves a trace of the request.
    await admin.from("activity_log").insert({
      company_id: companyId, type: "interview_requested",
      title: `${requesterName} requested an interview`,
      description: `${candidateName} · ${roleTitle}`,
      candidate_id: app?.candidate_id ?? null,
      job_id: app?.job_id ?? null,
      actor_id: user.id,
    });

    // Buzz the managers too, minus whoever requested it.
    await pushToCompanyAdmins(admin, companyId, {
      title: "Interview requested",
      body: `${requesterName} wants to interview ${candidateName} · ${roleTitle}`,
      data: { url: `aster://candidate/${app?.candidate_id ?? ""}`, type: "interview_requested" },
    }, user.id);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
