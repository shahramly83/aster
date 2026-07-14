// Supabase Edge Function: disable-email-2fa
// ---------------------------------------------------------------------------
// Turns email two-factor off for the signed-in account and clears its trusted
// devices and any outstanding codes. The person is already authenticated in
// Settings, so no code is required to switch it off, the same as turning off TOTP.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("profiles").update({ email_2fa_enabled: false }).eq("id", user.id);
    await admin.from("trusted_devices").delete().eq("user_id", user.id);
    await admin.from("login_codes").delete().eq("user_id", user.id);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
