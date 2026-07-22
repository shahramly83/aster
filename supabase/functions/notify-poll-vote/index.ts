// Supabase Edge Function: notify-poll-vote
// ---------------------------------------------------------------------------
// An interviewer marked their availability on a poll. Tell whoever is waiting on
// it — the hiring manager who opened the poll — in their bell and on their
// phone, with how much of the panel has now answered.
//
// The counterpart to notify-poll, which fires when the poll is created and goes
// the other way (manager -> panel). Without this the manager had to keep
// reopening the poll to find out whether anyone had replied.
//
// Fires ONCE per voter, not once per tap. Marking availability means ticking
// two or three slots, which is two or three rows in interview_poll_votes; this
// notifies only on the tick that takes the voter from "not counted" to
// "counted", so a manager gets one push per person rather than a burst.
//
// Best-effort by contract: the vote is already saved, so a push failure never
// blocks anything.
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

// Mirrors minAvailabilityMarks() in shared/poll.js. Kept in sync by hand: the
// edge runtime can't import from the app workspace. 1-2 slots proposed needs 1
// mark, 3 or more needs 2.
function minMarks(slotCount: number): number {
  if (slotCount <= 0) return 0;
  return slotCount <= 2 ? 1 : 2;
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

    const { poll_id } = await req.json();
    if (!poll_id) return json({ error: "poll_id is required" }, 400);

    const { data: me } = await admin.from("profiles").select("company_id, full_name, email").eq("id", user.id).maybeSingle();
    const companyId = me?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // The poll, scoped to the caller's company so a stray id can't reach another
    // tenant's data.
    const { data: poll } = await admin
      .from("interview_polls").select("id, candidate_id, job_id, created_by, status")
      .eq("id", poll_id).eq("company_id", companyId).maybeSingle();
    if (!poll) return json({ ok: true, skipped: "no_poll" });
    if (poll.status !== "open") return json({ ok: true, skipped: "closed" });
    if (!poll.created_by || poll.created_by === user.id) return json({ ok: true, skipped: "self" });

    const [{ data: slots }, { data: votes }] = await Promise.all([
      admin.from("interview_poll_slots").select("id").eq("poll_id", poll_id),
      admin.from("interview_poll_votes").select("profile_id").eq("poll_id", poll_id),
    ]);
    const slotCount = (slots || []).length;
    const need = minMarks(slotCount);

    // Only fire on the tick that made this voter count. Any earlier tap is a
    // half-finished vote, any later one is them adding a spare time.
    const mine = (votes || []).filter((v: { profile_id: string }) => v.profile_id === user.id).length;
    if (mine !== need) return json({ ok: true, skipped: "not_threshold", mine, need });

    // How much of the panel has answered, counting only voters who reached the
    // minimum — the same bar the app applies.
    const perVoter: Record<string, number> = {};
    (votes || []).forEach((v: { profile_id: string }) => { perVoter[v.profile_id] = (perVoter[v.profile_id] || 0) + 1; });
    const votedCount = Object.values(perVoter).filter((n) => n >= need).length;

    const { data: assigns } = await admin
      .from("job_assignments").select("profile_id")
      .eq("company_id", companyId).eq("job_id", poll.job_id ?? "");
    const panelSize = new Set((assigns || []).map((a: { profile_id: string }) => a.profile_id).filter(Boolean)).size;

    const voter = (me.full_name || "").trim() || me.email || "An interviewer";
    const { data: cand } = await admin.from("candidates").select("full_name, parsed").eq("id", poll.candidate_id).maybeSingle();
    const candName = cand?.parsed?.name || cand?.full_name || "a candidate";
    const progress = panelSize > 0 ? `${votedCount} of ${panelSize} have answered.` : "";
    const everyone = panelSize > 0 && votedCount >= panelSize;

    await admin.from("activity_log").insert({
      company_id: companyId,
      type: "poll_vote",
      title: everyone ? "Panel availability complete" : `${voter} marked their availability`,
      description: everyone
        ? `Everyone has answered for ${candName}. You can pick times to offer.`
        : `${voter} answered for ${candName}. ${progress}`.trim(),
      candidate_id: poll.candidate_id,
      job_id: poll.job_id,
      actor_id: user.id,
    });

    const res = await pushToUser(admin, poll.created_by, {
      title: everyone ? "Panel availability complete" : `${voter} marked their availability`,
      body: everyone
        ? `Everyone has answered for ${candName}. Pick times to offer.`
        : `${candName} · ${progress}`.trim(),
      data: { url: `aster://candidate/${poll.candidate_id}`, candidateId: poll.candidate_id, jobId: poll.job_id, type: "poll_vote" },
    });

    return json({ ok: true, sent: res.sent, votedCount, panelSize });
  } catch (e) {
    console.error(e);
    return json({ ok: true, skipped: "error", detail: String(e) });
  }
});
