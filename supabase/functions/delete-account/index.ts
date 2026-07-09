// Supabase Edge Function: delete-account
// ---------------------------------------------------------------------------
// Schedules the signed-in owner's workspace for 30-day soft deletion. Verifies
// the caller, records a one-way hash of their (normalized) email in the
// free_grant_ledger so a re-signup can't reset the free trial, then calls the
// request_workspace_deletion RPC AS the user (so its auth.uid() + owner check
// apply). The client signs the user out after a success.
//
// Secrets: DELETE_HASH_SECRET (HMAC key for the email hash)
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Normalize an email so trivial aliases map to one identity: lowercase, drop a
// "+tag", and for Gmail also drop dots in the local part.
function normalizeEmail(raw: string): string {
  const e = String(raw || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

    // One-way hash of the normalized email for the free-grant ledger.
    const secret = Deno.env.get("DELETE_HASH_SECRET") || "";
    const emailHash = secret && user.email ? await hmacHex(secret, normalizeEmail(user.email)) : null;

    // Call the RPC AS the user so auth.uid() and the owner-only check apply.
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await asUser.rpc("request_workspace_deletion", { p_email_hash: emailHash });
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
