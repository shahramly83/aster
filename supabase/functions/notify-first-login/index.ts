// Supabase Edge Function: notify-first-login
// ---------------------------------------------------------------------------
// An invited teammate opened Aster for the first time. Tell the owner and the
// admins, in their bell (activity_log) and on their phone (Expo push), so
// whoever sent the invite knows the seat is genuinely in use rather than just
// redeemed.
//
// Idempotent by construction: the first_login_at stamp is claimed with
// `is("first_login_at", null)`, so two tabs opening at once produce exactly one
// notification and every later call is a no-op. The client can therefore fire
// this on every session restore without guarding.
//
// Best-effort: the sign-in itself has already succeeded, so nothing here is
// allowed to fail the caller. Errors are swallowed into an ok response.
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

// Role → what the owner reads in the bell. The DB enum is the source of truth;
// ROLE_LABELS in the web app uses the same vocabulary.
const ROLE_WORD: Record<string, string> = {
  owner: "Tenant",
  admin: "Hiring manager",
  recruiter: "Recruiter",
  interviewer: "Interviewer",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    // Claim the stamp. The `is null` filter is the whole concurrency story: only
    // the first caller gets a row back, everyone after gets an empty array.
    const { data: claimed } = await admin
      .from("profiles")
      .update({ first_login_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("first_login_at", null)
      .select("full_name, email, role, company_id");

    const me = (claimed || [])[0];
    if (!me) return json({ ok: true, skipped: "not_first_login" });
    if (!me.company_id) return json({ ok: true, skipped: "no_company" });

    // The owner announcing their own arrival to themselves is noise: they just
    // created the workspace and are looking at it.
    if (me.role === "owner") return json({ ok: true, skipped: "self" });

    const name = (me.full_name || "").trim() || me.email || "A teammate";
    const roleWord = ROLE_WORD[me.role] || "Teammate";
    const title = `${roleWord} signed in for the first time`;
    const description = `${name} has opened Aster and can now be assigned to roles.`;

    // Bell: one company-scoped row, read by every admin's feed.
    await admin.from("activity_log").insert({
      company_id: me.company_id,
      type: "teammate_joined",
      title,
      description,
      actor_id: user.id,
    });

    // Push: only the people who can act on it, and never the person who just
    // signed in (they are holding the phone that would buzz).
    const { data: recipients } = await admin
      .from("profiles")
      .select("id")
      .eq("company_id", me.company_id)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .neq("id", user.id);

    const results = await Promise.all(
      (recipients || []).map((r: { id: string }) =>
        pushToUser(admin, r.id, {
          title: "Your teammate is in",
          body: `${name} signed in to Aster for the first time.`,
          data: { url: "aster://team" },
        })
      )
    );

    return json({ ok: true, notified: results.filter((r) => r.sent > 0).length });
  } catch (e) {
    // Never surface a failure: the sign-in already worked.
    return json({ ok: true, skipped: "error", detail: String(e) });
  }
});
