// Supabase Edge Function: notify-message
// ---------------------------------------------------------------------------
// Called by the mobile app right after it inserts a candidate discussion
// message. Pushes the other people on that candidate's thread (managers +
// the role's assigned interviewers, minus the author) so they see it live.
//
// The message row is already saved (RLS-gated insert from the client); this is
// best-effort notification only and never blocks anything.
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

    const { candidate_id, job_id, preview } = await req.json();
    if (!candidate_id) return json({ error: "candidate_id required" }, 400);

    const { data: caller } = await admin.from("profiles").select("company_id, full_name").eq("id", user.id).maybeSingle();
    const companyId = caller?.company_id;
    if (!companyId) return json({ error: "no company" }, 403);

    // Recipients = every manager in the company + the assigned interviewers for
    // this role, minus the author. Deduped.
    const recipients = new Set<string>();
    const { data: managers } = await admin
      .from("profiles").select("id").eq("company_id", companyId).in("role", ["owner", "admin", "recruiter"]).neq("status", "suspended");
    (managers || []).forEach((m: { id: string }) => recipients.add(m.id));
    if (job_id) {
      const { data: panel } = await admin.from("job_assignments").select("profile_id").eq("company_id", companyId).eq("job_id", job_id);
      (panel || []).forEach((p: { profile_id: string }) => recipients.add(p.profile_id));
    }
    recipients.delete(user.id); // don't notify the author

    const { data: cand } = await admin.from("candidates").select("full_name, parsed").eq("id", candidate_id).maybeSingle();
    const candName = cand?.parsed?.name || cand?.full_name || "a candidate";
    const authorName = (caller?.full_name || "Someone").split(" ")[0];

    await Promise.all(
      [...recipients].map((uid) =>
        pushToUser(admin, uid, {
          title: `${authorName} · ${candName}`,
          body: String(preview || "New message").slice(0, 140),
          data: { url: `aster://candidate/${candidate_id}` },
        })
      )
    );

    return json({ ok: true, notified: recipients.size });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
