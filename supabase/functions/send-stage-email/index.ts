// Supabase Edge Function: send-stage-email
// ---------------------------------------------------------------------------
// Sends the candidate a Tier 2 (company-branded) email when their pipeline stage
// moves to a stage that warrants one: offer, hired, or rejected. The stage change
// itself is persisted by the app (applications.stage); this only sends the mail,
// so it rides on an already-persisted transition — no new schema needed.
//
// Called by the app right after it persists a REAL, HR-initiated stage change
// (not the "simulate the candidate's reply" preview). Verifies the caller belongs
// to the candidate's company before revealing/emailing any candidate PII.
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

// stage → { template key, default copy }. Keep keys + tokens in sync with the
// editor catalog (EMAIL_TEMPLATE_DEFS in resume-ai-preview.jsx).
// Note: 'offer' is intentionally NOT here — the offer email carries an accept /
// decline link and is sent by the dedicated send-offer function instead.
const STAGE_EMAIL: Record<string, { key: string; heading: string; subject: string; body: string }> = {
  hired: {
    key: "welcome_hired", heading: "Welcome to the team",
    subject: "Welcome to {{company_name}}, {{candidate_name}}!",
    body: "Hi {{candidate_name}},\n\nWe're thrilled you're joining {{company_name}} as our new {{job_title}}! Our HR team will reach out shortly with your onboarding details.",
  },
  rejected: {
    key: "rejection", heading: "Update on your application",
    subject: "Update on your application: {{job_title}}",
    body: "Hi {{candidate_name}},\n\nThank you for applying for the {{job_title}} role at {{company_name}} and for the time you invested.\n\nAfter careful consideration we've decided not to move forward at this time. We genuinely appreciate your interest and wish you all the best.",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const { candidate_id, stage } = await req.json();
    const def = STAGE_EMAIL[String(stage)];
    if (!candidate_id || !def) return json({ error: "nothing to send for this stage" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling, and which company are they in?
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    // Candidate must belong to the caller's company (tenant boundary for PII).
    const { data: candidate } = await admin
      .from("candidates").select("email, full_name, company_id").eq("id", candidate_id).maybeSingle();
    if (!candidate || candidate.company_id !== companyId) return json({ error: "not found" }, 404);
    if (!candidate.email) return json({ ok: true, skipped: "no_candidate_email" });

    // Company branding + the candidate's most recent role for the tokens.
    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    const { data: apps } = await admin
      .from("applications").select("created_at, jobs(title)")
      .eq("company_id", companyId).eq("candidate_id", candidate_id)
      .order("created_at", { ascending: false }).limit(1);
    const jobTitle = (apps?.[0] as { jobs?: { title?: string } })?.jobs?.title || "the role";

    const tpl = await loadTemplate(admin, def.key, companyId, { subject: def.subject, body: def.body });
    const tokens = {
      candidate_name: candidate.full_name || "there",
      job_title: jobTitle,
      company_name: companyName,
      hr_contact: `${companyName} HR`,
    };
    await sendEmail({
      to: candidate.email,
      subject: renderTemplate(tpl.subject, tokens),
      html: companyShell({
        companyName, logoUrl,
        heading: def.heading,
        preview: renderTemplate(tpl.subject, tokens),
        bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)),
      }),
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
