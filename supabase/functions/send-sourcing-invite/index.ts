// Supabase Edge Function: send-sourcing-invite
// ---------------------------------------------------------------------------
// Emails a candidate already in the database an invite to apply for an open role
// (the "Sourcing invite" re-engagement flow). Renders the editable
// `sourcing_invite` Tier-2 template with the candidate's name, the picked role's
// title, and a source-tagged apply link. Verifies the caller belongs to both the
// candidate's and the job's company before revealing any PII.
//
// Secrets: RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const DEFAULT = {
  subject: "A {{job_title}} role you might like",
  body: "Hi {{candidate_name}},\n\nIt has been a while since we last connected, but your background stood out to us and we are now hiring a {{job_title}}. If you are interested, tap the link below to see the role and apply with your latest resume. It only takes a minute.\n\n{{apply_link}}\n\nWe would love to reconnect.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const { candidate_id, job_id, origin } = await req.json();
    if (!candidate_id || !job_id) return json({ error: "candidate_id and job_id are required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // Both the candidate and the job must belong to the caller's company.
    const { data: candidate } = await admin
      .from("candidates").select("email, full_name, company_id").eq("id", candidate_id).maybeSingle();
    if (!candidate || candidate.company_id !== companyId) return json({ error: "not found" }, 404);
    if (!candidate.email) return json({ ok: true, skipped: "no_candidate_email" });

    const { data: job } = await admin
      .from("jobs").select("title, company_id, status").eq("id", job_id).maybeSingle();
    if (!job || job.company_id !== companyId) return json({ error: "job not found" }, 404);
    if (job.status !== "open") return json({ error: "job is not open" }, 400);

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;

    const base = (typeof origin === "string" && /^https?:\/\//.test(origin)) ? origin.replace(/\/+$/, "") : "https://hireaster.com";
    const applyLink = `${base}/apply/${job_id}?source=database`;

    const tpl = await loadTemplate(admin, "sourcing_invite", companyId, DEFAULT);
    const tokens = {
      candidate_name: candidate.full_name || "there",
      job_title: job.title || "the role",
      apply_link: applyLink,
      company_name: companyName,
    };
    // A clear CTA button in addition to whatever the template body says.
    const button = `<div style="text-align:center;margin:24px 0 4px;"><a href="${applyLink}" style="display:inline-block;background:#0B2AE0;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:12px;">View the role &amp; apply</a></div>`;
    await sendEmail({
      to: candidate.email,
      subject: renderTemplate(tpl.subject, tokens),
      html: companyShell({
        companyName, logoUrl,
        heading: "A role you might like",
        preview: renderTemplate(tpl.subject, tokens),
        bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) + button,
      }),
    });

    return json({ ok: true });
  } catch (e) {
    console.error("send-sourcing-invite", e);
    return json({ error: "unexpected error" }, 500);
  }
});
