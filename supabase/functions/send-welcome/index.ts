// Supabase Edge Function: send-welcome
// ---------------------------------------------------------------------------
// Sends the "welcome to Aster" email to a newly-provisioned company's owner.
// Invoked right after create_company_and_owner from any auth path; the
// companies.welcomed_at stamp makes it exactly-once, so repeat invocations
// (email-confirmation retries, SSO re-provision) are safe no-ops.
//
// This is a Tier 1 (platform) email: Aster-branded shell, wording editable by
// admins via the company_welcome template in /admin.
//
// Secrets: RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id, full_name, email").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: comp } = await admin.from("companies").select("name, slug, welcomed_at").eq("id", companyId).maybeSingle();
    if (!comp) return json({ error: "not found" }, 404);
    if (comp.welcomed_at) return json({ ok: true, skipped: "already_welcomed" });

    // Claim the welcome (guard against a concurrent second invocation).
    await admin.from("companies").update({ welcomed_at: new Date().toISOString() }).eq("id", companyId).is("welcomed_at", null);

    const to = profile?.email || user.email;
    if (!to) return json({ ok: true, skipped: "no_recipient" });

    const tpl = await loadTemplate(admin, "company_welcome", null, {
      subject: "Your {{company_name}} workspace is ready",
      body: `<p>Hi {{recipient_name}},</p>
<p>Your {{company_name}} workspace is set up and ready to go. Post your first role and share the apply link, and Aster reads every application as it arrives, scores each one against the role, and hands you a ranked shortlist. You start from the best-fit candidates instead of a pile of CVs.</p>
<p>Your workspace lives at <strong>{{workspace_url}}</strong>. Bookmark it for next time.</p>
<p><a href="{{cta_link}}">Open your dashboard</a></p>`,
    });
    const workspaceHost = comp.slug ? `${comp.slug}.hireaster.com` : "hireaster.com";
    const tokens = {
      recipient_name: (profile?.full_name || "there").split(" ")[0] || "there",
      company_name: comp.name || "your team",
      workspace_url: workspaceHost,
      cta_link: comp.slug ? `https://${comp.slug}.hireaster.com/dashboard` : `${SITE}/login`,
    };
    await sendEmail({
      to,
      subject: renderTemplate(tpl.subject, tokens),
      html: emailShell({
        heading: "Welcome to Aster",
        preview: `Your ${comp.name || "Aster"} workspace is ready.`,
        bodyHtml: renderTemplate(tpl.body, tokens),
        footnote: "You're receiving this because you created an Aster workspace.",
      }),
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
