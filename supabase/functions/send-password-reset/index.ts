// Supabase Edge Function: send-password-reset
// ---------------------------------------------------------------------------
// Emails a password-reset link through Resend (the same sender as every other
// Aster email), instead of Supabase's built-in auth email, so it delivers
// reliably. Generates a recovery link with the admin API, then sends it via the
// shared email helper. Always returns ok, so it never reveals whether an account
// exists for the address (no user enumeration).
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt (called by signed-out users on the forgot screen).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, button } from "../_shared/email.ts";

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
    const { email, redirect } = await req.json().catch(() => ({}));
    const addr = String(email || "").trim().toLowerCase();
    if (!addr || !addr.includes("@")) return json({ ok: true });   // no enumeration

    const site = (typeof redirect === "string" && redirect.startsWith("http"))
      ? redirect.replace(/\/$/, "") : "https://hireaster.com";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: addr,
      options: { redirectTo: `${site}/forgot-password` },
    });
    // No account (or any error): pretend success so the response is identical.
    const link = data?.properties?.action_link;
    if (error || !link) return json({ ok: true });

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:460px;margin:0 auto;padding:32px 24px;color:#0F172A">
        <img src="https://hireaster.com/aster-logo.png" alt="Aster" height="20" style="height:20px;margin-bottom:28px" />
        <h1 style="font-size:19px;margin:0 0 8px">Reset your password</h1>
        <p style="font-size:14px;color:#475569;margin:0 0 8px">Click the button below to set a new password for your Aster account. This link expires in 60 minutes.</p>
        ${button("Set a new password", link)}
        <p style="font-size:12px;color:#94A3B8;margin:22px 0 0">If you didn't request this, you can safely ignore this email. Your password stays the same.</p>
      </div>`;
    const r = await sendEmail({ to: addr, subject: "Reset your Aster password", html });
    if (!r.ok) console.error("send-password-reset email failed", r.error || r.skipped);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: true });   // still no enumeration on unexpected errors
  }
});
