// Supabase Edge Function: send-login-code
// ---------------------------------------------------------------------------
// Email-code two-factor, the "send" half. Called after a correct password when the
// account has email 2FA on (purpose 'login'), or from Settings while turning it on
// (purpose 'enable').
//
// For a login it first checks whether THIS device is already trusted: if so it
// returns { trusted: true } and sends nothing, so a person is not emailed a code on
// every sign-in from their own laptop. Otherwise it generates a 6-digit code, stores
// only its hash, and emails it via Resend.
//
// Secrets: RESEND_API_KEY
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { deviceToken, purpose } = await req.json().catch(() => ({}));
    const kind = purpose === "enable" ? "enable" : "login";

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.email) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Already-trusted device on a login? Skip the code entirely.
    if (kind === "login" && typeof deviceToken === "string" && deviceToken.length >= 20) {
      const { data: dev } = await admin.from("trusted_devices")
        .select("id, expires_at").eq("user_id", user.id).eq("token_hash", await sha256(deviceToken)).maybeSingle();
      if (dev && new Date(dev.expires_at) > new Date()) {
        await admin.from("trusted_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", dev.id);
        return json({ ok: true, trusted: true });
      }
    }

    // Throttle: reuse an unexpired code rather than spraying emails on refresh.
    const { data: recent } = await admin.from("login_codes")
      .select("created_at").eq("user_id", user.id).eq("purpose", kind)
      .is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 30_000) {
      return json({ ok: true, trusted: false, sent: true, throttled: true });
    }

    // Fresh 6-digit code. Store only the hash, bound to the user id.
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();   // 10 minutes
    await admin.from("login_codes").insert({
      user_id: user.id, code_hash: await sha256(`${code}:${user.id}`), purpose: kind, expires_at: expires,
    });

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ ok: true, trusted: false, sent: false, reason: "email not configured" });

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:460px;margin:0 auto;padding:32px 24px;color:#0F172A">
        <img src="https://hireaster.com/aster-logo.png" alt="Aster" height="20" style="height:20px;margin-bottom:28px" />
        <h1 style="font-size:19px;margin:0 0 8px">Your sign-in code</h1>
        <p style="font-size:14px;color:#475569;margin:0 0 20px">Enter this code to finish signing in. It expires in 10 minutes.</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:.32em;background:#F1F5F9;border-radius:12px;padding:16px 0;text-align:center;color:#0B2AE0">${code}</div>
        <p style="font-size:12px;color:#94A3B8;margin:22px 0 0">If you did not just sign in, someone has your password. Change it, and turn on two-factor if it is not already on.</p>
      </div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Aster <noreply@hireaster.com>", to: [user.email], subject: `Aster sign-in code: ${code}`, html }),
    });
    if (!res.ok) console.error("resend login code", await res.text());

    return json({ ok: true, trusted: false, sent: res.ok });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
