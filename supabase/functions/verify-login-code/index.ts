// Supabase Edge Function: verify-login-code
// ---------------------------------------------------------------------------
// The "verify" half of email-code two-factor. Checks the 6-digit code against the
// stored hash (single use, capped attempts, short expiry). On success:
//   - purpose 'enable': turns email_2fa_enabled on for the account.
//   - if trustDevice: mints a device token, trusts it for 30 days, returns it so the
//     client can store it and skip the code next time from this browser.
//
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomToken = () => {
  const a = new Uint8Array(32); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { code, purpose, trustDevice } = await req.json().catch(() => ({}));
    const kind = purpose === "enable" ? "enable" : "login";
    if (!/^\d{6}$/.test(String(code || ""))) return json({ ok: false, error: "Enter the 6-digit code." });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: row } = await admin.from("login_codes")
      .select("id, code_hash, attempts, expires_at, consumed_at")
      .eq("user_id", user.id).eq("purpose", kind).is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!row) return json({ ok: false, error: "No code to check. Send a new one." });
    if (new Date(row.expires_at) < new Date()) return json({ ok: false, error: "That code has expired. Send a new one." });
    if (row.attempts >= 5) return json({ ok: false, error: "Too many attempts. Send a new code." });

    const ok = (await sha256(`${code}:${user.id}`)) === row.code_hash;
    if (!ok) {
      await admin.from("login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ ok: false, error: "That code is not right." });
    }

    // Correct: consume it so it can't be replayed.
    await admin.from("login_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

    if (kind === "enable") {
      await admin.from("profiles").update({ email_2fa_enabled: true }).eq("id", user.id);
    }

    let deviceToken: string | null = null;
    if (trustDevice) {
      deviceToken = randomToken();
      await admin.from("trusted_devices").insert({
        user_id: user.id, token_hash: await sha256(deviceToken),
        label: (req.headers.get("user-agent") || "").slice(0, 120),
        expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
    }

    return json({ ok: true, deviceToken });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
