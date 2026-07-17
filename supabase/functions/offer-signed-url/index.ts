// Supabase Edge Function: offer-signed-url
// ---------------------------------------------------------------------------
// Returns a short-lived download URL for a candidate's signed offer letter PDF.
// The 'offer-letters' bucket is private (only the service role can read it), so
// the app can't sign the URL itself. Verifies the caller belongs to the offer's
// company, then mints a signed URL for the stored PDF.
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
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { candidateId } = await req.json();
    if (!candidateId) return json({ error: "candidateId is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers")
      .select("signed_pdf_path")
      .eq("company_id", companyId).eq("candidate_id", candidateId)
      .not("signed_pdf_path", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!offer?.signed_pdf_path) return json({ error: "no signed document" }, 404);

    const { data: signed, error } = await admin.storage.from("offer-letters")
      .createSignedUrl(offer.signed_pdf_path, 300, { download: "offer-letter-signed.pdf" });
    if (error || !signed?.signedUrl) return json({ error: "could not sign url" }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
