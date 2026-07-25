// Supabase Edge Function: create-video-room
// ---------------------------------------------------------------------------
// Mints a ready-to-use video call room via the Daily.co REST API and returns its
// URL, so the hiring manager can generate a real, branded meeting link with one
// tap (no account or install needed at either end). Called from the interview
// panel's "Create a video room" button on web and mobile.
//
// Authed: requires a signed-in Supabase user (so anonymous callers can't burn
// the Daily quota). The Daily API key stays server-side.
//
// Secrets: DAILY_API_KEY (required — without it we return a soft error and the
//          client falls back to its built-in room generator).
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
    // 1) Authenticate the caller — a valid Supabase session is required.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const apiKey = Deno.env.get("DAILY_API_KEY");
    // Soft failure: not configured yet. The client falls back to its own room
    // generator so the button is never a dead end.
    if (!apiKey) return json({ error: "video_not_configured" }, 503);

    // 2) A short, readable, unique room name (Daily requires uniqueness). The
    //    candidate tag keeps two interviews from colliding; the random suffix
    //    guarantees a fresh room per click.
    const body = await req.json().catch(() => ({}));
    const tag = String(body?.candidate_id || "iv").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
    const rand = Math.random().toString(36).slice(2, 8);
    const name = `aster-${tag || "iv"}-${rand}`;
    // Auto-expire the room so stale rooms clean themselves up (14 days is well
    // past any scheduled interview + reschedules).
    const exp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;

    // 3) Create the room. privacy:"public" => anyone with the link can join, no
    //    Daily account required (same zero-friction join as the old rooms).
    const res = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        privacy: "public",
        properties: { exp, enable_chat: true, enable_prejoin_ui: true, enable_screenshare: true },
      }),
    });
    const room = await res.json().catch(() => ({}));
    if (!res.ok || !room?.url) {
      console.error("daily create room failed", res.status, room);
      return json({ error: room?.info || room?.error || "could not create room" }, 502);
    }

    return json({ url: room.url, name: room.name });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
