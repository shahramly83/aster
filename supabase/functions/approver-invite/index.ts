// Supabase Edge Function: approver-invite
// ---------------------------------------------------------------------------
// HR adds a person to the company's "Approvers" list (people who can approve
// offers WITHOUT a workspace account). Inserts/refreshes an offer_approvers row
// and emails them a one-time confirm link. They confirm (no sign-up), and from
// then on they can be picked as approvers and receive only approve/decline
// emails. Also used to re-send the confirm email to a pending approver.
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, button, paragraphs } from "../_shared/email.ts";

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
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { email: rawEmail, name: rawName, origin } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    const name = (typeof rawName === "string" ? rawName.trim() : "").slice(0, 120) || null;
    if (!email || !email.includes("@")) return json({ error: "a valid email is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // Insert, or refresh an existing row for this email. A confirmed approver
    // stays confirmed (just update the name); a pending one keeps its token so
    // this doubles as "resend confirmation".
    const { data: existing } = await admin.from("offer_approvers")
      .select("id, status, confirm_token, name").eq("company_id", companyId).ilike("email", email).maybeSingle();

    let row = existing;
    if (!existing) {
      const ins = await admin.from("offer_approvers")
        .insert({ company_id: companyId, email, name, status: "pending" })
        .select("id, status, confirm_token, name").single();
      if (ins.error) { console.error("approver insert", ins.error.message); return json({ error: "save_failed" }, 500); }
      row = ins.data;
    } else if (name && name !== existing.name) {
      await admin.from("offer_approvers").update({ name }).eq("id", existing.id);
    }

    // Already confirmed → nothing to email, just report it.
    if (row!.status === "confirmed") return json({ ok: true, status: "confirmed", already: true });

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin.replace(/\/$/, "") : "https://hireaster.com";
    const confirmUrl = `${base}/approver-confirm/${row!.confirm_token}`;

    const html = companyShell({
      companyName, logoUrl: comp?.logo_url || null,
      heading: "Confirm you'll approve offers",
      preview: `${companyName} added you as an offer approver.`,
      bodyHtml: `${paragraphs(`${name ? name + "," : "Hello,"}\n\n${companyName} has added you as an approver for their employment offers on Aster. Confirm below and you'll receive an email whenever there's an offer to approve. You don't need an account or a password, just this email.`)}${button("Confirm & activate", confirmUrl)}`,
    });
    const r = await sendEmail({ to: email, subject: `Confirm you'll approve offers for ${companyName}`, html });
    if (!r.ok) { console.error("approver-invite email failed", r.error || r.skipped); return json({ error: "email_failed" }, 502); }

    return json({ ok: true, status: "pending" });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
