// Supabase Edge Function: admin-reset-password
// ---------------------------------------------------------------------------
// A staff admin (super or support) triggers a password reset for a workspace
// user. The portal button used to just print "success" and do nothing.
//
// This needs the service role (only it may send auth emails for another user),
// so the caller is verified TWICE: a valid JWT, AND an active admin_users row
// with role super/support. Without both, it refuses — the service role must
// never act for an unverified caller.
//
// It sends the standard Supabase recovery email; the app's /forgot-password
// screen (which now really calls updateUser) completes the reset. Staff never
// see or set the password.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    // Second gate: must be an active super/support staff admin.
    const { data: staff } = await admin
      .from("admin_users").select("role, status").eq("id", user.id).maybeSingle();
    if (!staff || staff.status !== "active" || !["super", "support"].includes(staff.role)) {
      return json({ error: "forbidden" }, 403);
    }

    const { email } = await req.json().catch(() => ({}));
    if (!email || typeof email !== "string") return json({ error: "email required" }, 400);

    // Send the recovery email. Errors are logged but not echoed, so this cannot
    // be used to probe which addresses have accounts.
    const site = Deno.env.get("SITE_URL") || "https://hireaster.com";
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${site}/forgot-password`,
    });
    if (error) console.error("admin-reset-password", error.message);

    // Audit as the acting admin (best effort).
    await admin.from("audit_log").insert({
      actor_id: user.id, actor_role: staff.role,
      action: "Sent password reset", target: email,
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
