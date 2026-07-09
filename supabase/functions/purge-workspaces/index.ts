// Supabase Edge Function: purge-workspaces
// ---------------------------------------------------------------------------
// The scheduled teardown for the 30-day soft delete. Finds workspaces whose
// purge_after has passed and permanently removes them: resume files in storage,
// the members' auth.users rows (which cascade their profiles), then the company
// row (which cascades jobs, candidates, applications, interviews, scorecards,
// subscriptions, usage_counters, industries, job_views).
//
// Run daily from a cron. It is NOT public: it requires the x-purge-key header to
// match the PURGE_KEY secret, so only the scheduler can trigger it.
//
// Secrets: PURGE_KEY (shared secret the cron sends)
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-purge-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("PURGE_KEY") || "";
  if (!expected || (req.headers.get("x-purge-key") || "") !== expected) {
    return json({ error: "forbidden" }, 403);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // First: suspend any 14-day trial that ended without an active subscription and
  // start its 30-day soft-delete window (purge_after = now + 30d, so it is NOT
  // purged in this same run). There is no free-tier fallback.
  let suspended = 0;
  try {
    const { data: n, error: sErr } = await admin.rpc("suspend_expired_trials");
    if (sErr) console.error("suspend_expired_trials", sErr);
    else suspended = typeof n === "number" ? n : 0;
  } catch (e) { console.error("suspend_expired_trials threw", e); }

  // Find workspaces past their purge window, with their members' auth ids.
  const { data: expired, error } = await admin
    .from("companies")
    .select("id, profiles(id)")
    .not("deleted_at", "is", null)
    .lt("purge_after", new Date().toISOString());
  if (error) { console.error("query expired", error); return json({ error: error.message }, 500); }

  const purged: string[] = [];
  for (const c of expired || []) {
    const id = (c as any).id as string;
    try {
      // 1. Resume files: resumes/{company_id}/{candidate_id}.pdf
      const { data: files } = await admin.storage.from("resumes").list(id, { limit: 1000 });
      if (files && files.length) {
        await admin.storage.from("resumes").remove(files.map((f: any) => `${id}/${f.name}`));
      }
      // 2. Auth users (cascades each member's profile row)
      for (const p of ((c as any).profiles || [])) {
        try { await admin.auth.admin.deleteUser(p.id); } catch (e) { console.error("auth delete", p.id, e); }
      }
      // 3. Company row (cascades all remaining child data)
      const { error: delErr } = await admin.from("companies").delete().eq("id", id);
      if (delErr) { console.error("company delete", id, delErr); continue; }
      purged.push(id);
    } catch (e) {
      console.error("purge failed", id, e);
    }
  }

  return json({ suspended, purged: purged.length, ids: purged });
});
