// Supabase Edge Function: send-teammate-invite
// ---------------------------------------------------------------------------
// An owner/admin invites a teammate. This verifies the caller, creates (or
// refreshes) the invitation via the admin-gated invite_teammate RPC — run AS
// the caller so its role + seat-limit checks apply — then emails the invitee a
// link to accept. The email is a Tier 1 (platform) template, so an Aster admin
// can edit its wording in /admin; sending is best-effort (the invite is still
// created if the email fails).
//
// Secrets:  RESEND_API_KEY (for the email; optional — skipped if unset)
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, loadTemplate, renderTemplate } from "../_shared/email.ts";

const SITE = "https://hireaster.com";
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
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const { email, role, name } = await req.json();
    const inviteEmail = String(email || "").toLowerCase().trim();
    const inviteRole = role === "admin" ? "admin" : "interviewer";
    if (!inviteEmail) return json({ error: "email is required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is inviting?
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    // Create/refresh the invitation AS the caller, so invite_teammate's own
    // owner/admin gate and seat-limit checks apply. Returns the invite token.
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: inviteToken, error: rpcErr } = await asUser.rpc("invite_teammate", {
      p_email: inviteEmail, p_role: inviteRole,
    });
    if (rpcErr) {
      // 42501 forbidden, 23505 already a member, others (seat limit P0001, bad
      // input) → 400. Pass the DB message through so the UI can show it.
      const status = rpcErr.code === "42501" ? 403 : rpcErr.code === "23505" ? 409 : 400;
      return json({ error: rpcErr.message || "could not create invite" }, status);
    }

    // Resolve inviter name + company for the email tokens (service role).
    const { data: inviter } = await admin
      .from("profiles").select("full_name, company_id, companies(name)").eq("id", user.id).maybeSingle();
    const companyId = inviter?.company_id || null;
    const companyName = (inviter as { companies?: { name?: string } })?.companies?.name || "your workspace";
    const inviterName = inviter?.full_name || "A teammate";
    // No name is collected at invite time (the teammate names themselves at
    // sign-up), so greet them warmly rather than with their email handle.
    const recipientName = String(name || "").trim() || "there";
    const ctaLink = `${SITE}/?invite=${inviteToken}`;

    // Send the Tier 1 invite email (company override → platform default → code default).
    try {
      const tpl = await loadTemplate(admin, "teammate_invite", companyId, {
        subject: "{{inviter_name}} invited you to {{company_name}} on Aster",
        body: `<p>Hi {{recipient_name}},</p>
<p>{{inviter_name}} has invited you to join <strong>{{company_name}}</strong> on Aster as {{role}}. Aster is where your team reviews applicants, runs interviews, and keeps every hire moving forward, all in one place.</p>
<p>Accepting takes about a minute. Set your password and you're in.</p>
<p style="margin:22px 0 6px;"><a href="{{cta_link}}" style="display:inline-block;padding:11px 22px;border-radius:10px;background:#0B2AE0;color:#ffffff;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Accept the invite</a></p>
<p style="font-size:13px;color:#8B8699;">This invite is just for you and expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>`,
      });
      const roleLabel = inviteRole === "admin" ? "a hiring manager" : "an interviewer";
      const tokens = {
        recipient_name: recipientName, inviter_name: inviterName,
        company_name: companyName, role: roleLabel, cta_link: ctaLink,
      };
      await sendEmail({
        to: inviteEmail,
        subject: renderTemplate(tpl.subject, tokens),
        html: emailShell({
          heading: `You're invited to ${companyName}`,
          preview: `${inviterName} invited you to join ${companyName} on Aster.`,
          bodyHtml: renderTemplate(tpl.body, tokens),
          footnote: "You received this because someone invited you to a workspace on Aster.",
        }),
      });
    } catch (e) {
      console.error("teammate invite email failed", e); // non-fatal; invite still created
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
