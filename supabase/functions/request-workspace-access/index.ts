// Supabase Edge Function: request-workspace-access
// ---------------------------------------------------------------------------
// Someone signed up, found their company already has an Aster workspace, and was
// told to ask their admin for an invite. This is the "ask" — it emails the owner
// so the new starter does not have to go and find them.
//
// Telling a person they are blocked, and leaving them to work out who can unblock
// them, is a dead end dressed up as an explanation. One button closes it.
//
// The caller must be signed in and email-confirmed, and we only ever mail the owner
// of the workspace that matches THEIR OWN email domain. Nothing else is disclosed.
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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.email) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Only someone who does NOT already belong to a workspace can ask to join one.
    const { data: mine } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (mine) return json({ error: "you already belong to a workspace" }, 409);

    const domain = user.email.split("@")[1]?.toLowerCase() || "";
    if (!domain) return json({ error: "bad email" }, 400);

    // The workspace for THEIR domain, and its owner. Scoped to their own domain, so
    // this cannot be used to look up who owns some other company's account.
    const { data: rows } = await admin
      .from("profiles")
      .select("email, full_name, role, status, companies!inner(id, name, slug, deleted_at)")
      .eq("role", "owner").eq("status", "active");

    const match = (rows || []).find((r: Record<string, any>) =>
      String(r.email || "").toLowerCase().endsWith(`@${domain}`) && !r.companies?.deleted_at);
    if (!match) return json({ error: "no workspace for your domain" }, 404);

    const owner = match as Record<string, any>;
    const company = owner.companies;
    const key = Deno.env.get("RESEND_API_KEY");
    // Never return the owner's address. The caller does not need it, and echoing it
    // would put back the disclosure this endpoint exists to avoid: it would just be
    // in the network tab instead of on the page.
    if (!key) return json({ ok: true, emailed: false, company: company.name });

    const asker = (user.user_metadata?.full_name as string) || user.email;
    const teamUrl = `https://${company.slug}.hireaster.com/interviewers`;

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0F172A">
        <img src="https://hireaster.com/aster-logo.png" alt="Aster" height="20" style="height:20px;margin-bottom:28px" />
        <h1 style="font-size:20px;margin:0 0 12px">${esc(asker)} wants to join ${esc(company.name)}</h1>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 8px">
          They tried to sign up for Aster with <strong>${esc(user.email)}</strong>, and we told them your
          company already has a workspace. Invite them and they'll join this one.
        </p>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px">
          If you don't recognise them, ignore this. Nothing has been shared with them.
        </p>
        <a href="${teamUrl}" style="display:inline-block;background:#0B2AE0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:12px">
          Invite them
        </a>
        <p style="font-size:12px;color:#94A3B8;margin:28px 0 0">Sent by Aster because someone at your company asked to join your workspace.</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Aster <noreply@hireaster.com>",
        to: [owner.email],
        reply_to: user.email,          // so the owner can just hit reply
        subject: `${asker} wants to join ${company.name} on Aster`,
        html,
      }),
    });
    if (!res.ok) console.error("resend", await res.text());

    return json({ ok: true, emailed: res.ok, company: company.name });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
