// Supabase Edge Function: delete-account
// ---------------------------------------------------------------------------
// Schedules the signed-in owner's workspace for 30-day soft deletion. Verifies
// the caller, then calls request_workspace_deletion AS the user (so its
// auth.uid() + owner-only check apply). The RPC itself records the owner's email
// and business domain in the free-grant ledger (so a re-signup can't reset the
// free trial) and stamps deleted_at + purge_after. The client signs out on
// success.
//
// No custom secret needed (the DB does the hashing).
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    // Call the RPC AS the user so auth.uid() and the owner-only check apply.
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await asUser.rpc("request_workspace_deletion", {});
    if (error) {
      const status = error.code === "42501" ? 403 : 400;
      return json({ error: error.message || "could not schedule deletion" }, status);
    }

    return json({ purge_after: data });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
