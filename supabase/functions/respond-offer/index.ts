// Supabase Edge Function: respond-offer
// ---------------------------------------------------------------------------
// The public offer page (/offer/<token>, no login) calls this when the candidate
// accepts or declines. Token-gated (the unguessable offer token authorizes it):
// records the response, and on accept moves the candidate to hired, emails the
// company ("offer accepted") and the candidate ("welcome"). Idempotent.
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

async function jobTitleFor(admin: { from: (t: string) => any }, companyId: string, candidateId: string): Promise<string> {
  const { data } = await admin.from("applications").select("created_at, jobs(title)")
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as { jobs?: { title?: string } })?.jobs?.title || "the role";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { token, response } = await req.json();
    const accepted = response === "accepted";
    if (!token || (response !== "accepted" && response !== "declined")) {
      return json({ error: "token and a valid response are required" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: offer } = await admin
      .from("offers").select("id, company_id, candidate_id, status").eq("token", token).maybeSingle();
    if (!offer) return json({ error: "not found" }, 404);

    // First response wins; a repeat is a no-op (idempotent).
    const firstResponse = offer.status === "sent";
    if (firstResponse) {
      await admin.from("offers").update({ status: accepted ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", offer.id);
      // Decline is terminal (stage -> declined). Accept does NOT auto-hire: the
      // candidate says yes, then the hiring manager reviews and closes the process
      // by clicking "Mark as hired". So on accept we leave the application at the
      // 'offer' stage; the offer status flips to 'accepted' for HR to act on.
      if (!accepted) {
        await admin.from("applications").update({ stage: "declined" })
          .eq("company_id", offer.company_id).eq("candidate_id", offer.candidate_id);
      }
    }

    // Emails only on the first accept (a decline updates the stage, no email).
    if (firstResponse && accepted) {
      const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", offer.company_id).maybeSingle();
      const companyName = comp?.name || "the hiring team";
      const logoUrl = comp?.logo_url || null;
      const jobTitle = await jobTitleFor(admin, offer.company_id, offer.candidate_id);
      const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
      const candidateName = cand?.full_name || "The candidate";

      // 1) Notify the company's owners/admins (internal alert, no sign-off).
      try {
        const { data: recips } = await admin.from("profiles").select("email")
          .eq("company_id", offer.company_id).in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
        const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
        if (to.length) {
          const tpl = await loadTemplate(admin, "offer_accepted", offer.company_id, {
            subject: "{{candidate_name}} accepted your offer",
            body: "{{candidate_name}} accepted your offer for the {{job_title}} role. Open Aster to review the offer and mark them as hired when you're ready.",
          });
          const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
          await sendEmail({
            to,
            subject: renderTemplate(tpl.subject, tokens),
            html: companyShell({ companyName, logoUrl, heading: "Offer accepted", preview: `${candidateName} accepted the ${jobTitle} offer.`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)), signoff: false }),
          });
        }
      } catch (e) { console.error("offer-accepted company email failed", e); }

      // 2) Welcome the candidate.
      if (cand?.email) {
        try {
          const tpl = await loadTemplate(admin, "welcome_hired", offer.company_id, {
            subject: "Welcome to {{company_name}}, {{candidate_name}}!",
            body: "Hi {{candidate_name}},\n\nWe're thrilled you're joining {{company_name}} as our new {{job_title}}! Our HR team will reach out shortly with your onboarding details.",
          });
          const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
          await sendEmail({
            to: cand.email,
            subject: renderTemplate(tpl.subject, tokens),
            html: companyShell({ companyName, logoUrl, heading: "Welcome to the team", preview: `Welcome to ${companyName}!`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) }),
          });
        } catch (e) { console.error("welcome email failed", e); }
      }
    }

    return json({ ok: true, status: accepted ? "accepted" : "declined" });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
