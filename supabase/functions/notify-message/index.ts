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

    const { candidate_id, job_id, preview, mentioned_ids } = await req.json();
    if (!candidate_id) return json({ error: "candidate_id required" }, 400);
    const mentionedInput = Array.isArray(mentioned_ids) ? mentioned_ids.filter((x: unknown) => typeof x === "string") : [];

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

    // Tagged teammates get a distinct "mentioned you" push instead of the
    // generic one. Only honour mentions of people actually on the thread (a
    // client can't tag someone into a conversation they can't see), and never
    // the author. A mentioned person is pushed once, as a mention.
    const mentioned = new Set(mentionedInput.filter((id: string) => recipients.has(id)));
    mentioned.forEach((id) => recipients.delete(id)); // avoid a double push

    const { data: cand } = await admin.from("candidates").select("full_name, parsed").eq("id", candidate_id).maybeSingle();
    const candName = cand?.parsed?.name || cand?.full_name || "a candidate";
    const authorFull = caller?.full_name || "Someone";
    const authorName = authorFull.split(" ")[0];
    const body = String(preview || "New message").slice(0, 140);
    const data = { url: `aster://candidate/${candidate_id}` };

    await Promise.all([
      ...[...mentioned].map((uid) =>
        pushToUser(admin, uid, { title: `${authorName} mentioned you`, body: `${candName}: ${body}`, data })
      ),
      ...[...recipients].map((uid) =>
        pushToUser(admin, uid, { title: `${authorName} · ${candName}`, body, data })
      ),
    ]);

    return json({ ok: true, notified: recipients.size + mentioned.size, mentioned: mentioned.size });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
