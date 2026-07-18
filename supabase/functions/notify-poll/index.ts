// Supabase Edge Function: notify-poll
// ---------------------------------------------------------------------------
// A hiring manager posted an interview availability poll on a candidate. Push a
// notification to every interviewer assigned to that role (job_assignments) so
// they know to open the thread and mark their availability.
//
// Best-effort by contract: the poll is already saved and logged to the activity
// feed, so a push hiccup never blocks anything. Mobile-only (push), no email.
//
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pushToUser } from "../_shared/push.ts";

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

    const { candidate_id, job_id, candidate_name } = await req.json();
    if (!candidate_id) return json({ error: "candidate_id is required" }, 400);

    const { data: caller } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = caller?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);
    if (!job_id) return json({ ok: true, skipped: "no_role" }); // no panel to notify

    // Interviewers assigned to this role (the panel), excluding the poster.
    const { data: assigns } = await admin
      .from("job_assignments").select("profile_id")
      .eq("company_id", companyId).eq("job_id", job_id);
    const recipients = [...new Set((assigns || []).map((a: { profile_id: string }) => a.profile_id))]
      .filter((id) => id && id !== user.id);
    if (!recipients.length) return json({ ok: true, skipped: "no_panel" });

    const cand = candidate_name
      || (await admin.from("candidates").select("full_name").eq("id", candidate_id).maybeSingle()).data?.full_name
      || "a candidate";
    const { data: job } = await admin.from("jobs").select("title").eq("id", job_id).maybeSingle();
    const roleTitle = job?.title || "a role";

    // Fan out. Deep link opens the candidate (thread + poll) in the app.
    let sent = 0;
    for (const id of recipients) {
      const r = await pushToUser(admin, id, {
        title: "Interview availability poll",
        body: `Mark the times you can interview ${cand} · ${roleTitle}`,
        data: { url: `aster://candidate/${candidate_id}`, candidateId: candidate_id, jobId: job_id, type: "interview_poll" },
      });
      sent += r.sent;
    }

    return json({ ok: true, recipients: recipients.length, sent });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
