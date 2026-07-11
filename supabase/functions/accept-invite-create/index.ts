// Supabase Edge Function: accept-invite-create
// ---------------------------------------------------------------------------
// Creates a teammate's account when they accept an emailed invite. Because the
// invite link (a secret token mailed only to that address) already proves they
// own the email, the account is created ALREADY CONFIRMED via the admin API.
// That removes the second "confirm your email" round-trip entirely — which also
// sidesteps Supabase's rate-limited built-in auth mailer (our invites go via
// Resend, but auth-confirmation mail does not). The client then signs in with
// the password and redeems the invite.
//
// Security: the account can only be created for the exact email the invite was
// issued to, and only while the token is unaccepted and unexpired. No caller
// auth is required (the invitee has no account yet); the token is the gate.
//
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { token, password, full_name } = await req.json();
    if (!token || !password) return json({ error: "token and password are required" }, 400);
    // Mirror the client's password rule so the API can't be used to set a weak one.
    const pw = String(password);
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      return json({ error: "Password must be at least 8 characters, with a letter and a number." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // The token is the gate: must be a real, unaccepted, unexpired invitation.
    const { data: inv } = await admin
      .from("invitations")
      .select("email, accepted_at, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) {
      return json({ error: "This invite is invalid or has expired." }, 400);
    }
    const email = String(inv.email).toLowerCase();

    // Create the account already confirmed. The invite link proved email ownership.
    const { error: cErr } = await admin.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { full_name: String(full_name || "").trim() },
    });
    if (cErr) {
      // Already have an account (e.g. re-invited, or a prior partial signup):
      // tell the client to switch to sign-in instead of erroring.
      if (/already.*(registered|exists)|been registered|duplicate/i.test(cErr.message)) {
        return json({ exists: true });
      }
      return json({ error: cErr.message || "Could not create the account." }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
