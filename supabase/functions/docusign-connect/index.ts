// Supabase Edge Function: docusign-connect
// ---------------------------------------------------------------------------
// DocuSign Connect webhook. DocuSign POSTs envelope lifecycle events here as
// JSON. We map the event to esign_status on the matching offer; on completion we
// mark the offer accepted and pull the signed PDF into the private
// 'offer-letters' bucket. This function is PUBLIC (no Supabase JWT) because
// DocuSign calls it, so it verifies the optional Connect HMAC signature.
//
// Secrets: DOCUSIGN_* (for the PDF fetch), DOCUSIGN_CONNECT_HMAC_KEY (optional
// but recommended), SUPABASE_* (auto). Set --no-verify-jwt when deploying.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dsAccessToken } from "../_shared/docusign.ts";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs } from "../_shared/email.ts";

const EVENT_STATUS: Record<string, string> = {
  "envelope-sent": "sent",
  "envelope-delivered": "delivered",
  "envelope-completed": "completed",
  "envelope-declined": "declined",
  "envelope-voided": "voided",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function hmacOk(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("DOCUSIGN_CONNECT_HMAC_KEY");
  if (!secret) return true;        // HMAC not configured → skip (dev). Configure it in prod.
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin) === header;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (!(await hmacOk(raw, req.headers.get("X-DocuSign-Signature-1")))) {
      return json({ error: "bad signature" }, 401);
    }
    const body = JSON.parse(raw);
    const event: string = body.event || "";
    const envelopeId: string | undefined = body?.data?.envelopeId || body?.envelopeId;
    if (!envelopeId) return json({ ok: true, skipped: "no_envelope" });

    const status = EVENT_STATUS[event];
    if (!status) return json({ ok: true, skipped: `unhandled_event:${event}` });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: offer } = await admin.from("offers")
      .select("id, company_id, candidate_id, status").eq("esign_envelope_id", envelopeId).maybeSingle();
    if (!offer) return json({ ok: true, skipped: "offer_not_found" });
    const alreadySettled = offer.status === "accepted" || offer.status === "declined";

    const patch: Record<string, unknown> = { esign_status: status };
    if (status === "completed") { patch.status = "accepted"; patch.responded_at = new Date().toISOString(); }
    if (status === "declined") { patch.status = "declined"; patch.responded_at = new Date().toISOString(); }

    // On completion, pull the combined signed PDF and store it privately.
    if (status === "completed") {
      try {
        const { token, basePath } = await dsAccessToken();
        const accountId = Deno.env.get("DOCUSIGN_ACCOUNT_ID")!;
        const pdfRes = await fetch(
          `${basePath}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (pdfRes.ok) {
          const bytes = new Uint8Array(await pdfRes.arrayBuffer());
          const path = `${offer.company_id}/${envelopeId}.pdf`;
          const up = await admin.storage.from("offer-letters").upload(path, bytes, {
            contentType: "application/pdf", upsert: true,
          });
          if (!up.error) patch.signed_pdf_path = path;
          else console.error("signed pdf upload failed", up.error.message);
        } else {
          console.error("combined pdf fetch failed", pdfRes.status);
        }
      } catch (e) { console.error("signed pdf step failed", e); }
    }

    await admin.from("offers").update(patch).eq("id", offer.id);

    // On the FIRST completion, notify the team (offer accepted) and welcome the
    // candidate, mirroring respond-offer so DocuSign offers behave the same.
    // Idempotent: skip if the offer was already settled before this event.
    if (status === "completed" && !alreadySettled) {
      try {
        const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", offer.company_id).maybeSingle();
        const companyName = comp?.name || "the hiring team";
        const logoUrl = comp?.logo_url || null;
        const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
        const candidateName = cand?.full_name || "The candidate";
        const { data: app } = await admin.from("applications").select("jobs(title)")
          .eq("company_id", offer.company_id).eq("candidate_id", offer.candidate_id)
          .order("created_at", { ascending: false }).limit(1);
        const jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || "the role";

        // Log the event for the notification bell.
        await admin.from("activity_log").insert({ company_id: offer.company_id, type: "offer_signed", title: `${candidateName} signed the offer`, description: `Signed the offer for the ${jobTitle} role.`, candidate_id: offer.candidate_id });

        // 1) Team notification.
        const { data: recips } = await admin.from("profiles").select("email")
          .eq("company_id", offer.company_id).in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
        const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
        if (to.length) {
          const tpl = await loadTemplate(admin, "offer_accepted", offer.company_id, {
            subject: "{{candidate_name}} accepted your offer",
            body: "{{candidate_name}} accepted your offer for the {{job_title}} role. Open Aster to review the signed offer and mark them as hired when you're ready.",
          });
          const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
          await sendEmail({ to, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName, logoUrl, heading: "Offer accepted", preview: `${candidateName} accepted the ${jobTitle} offer.`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)), signoff: false }) }).catch((e) => console.error("offer-accepted team email", e));
        }

        // 2) Candidate welcome.
        if (cand?.email) {
          const tpl = await loadTemplate(admin, "welcome_hired", offer.company_id, {
            subject: "Welcome to {{company_name}}, {{candidate_name}}!",
            body: "Hi {{candidate_name}},\n\nWe're thrilled you're joining {{company_name}} as our new {{job_title}}! Our HR team will reach out shortly with your onboarding details and start date.",
          });
          const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
          await sendEmail({ to: cand.email, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName, logoUrl, heading: "Welcome to the team", preview: `Welcome to ${companyName}!`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) }) }).catch((e) => console.error("welcome email", e));
        }
      } catch (e) { console.error("docusign completion emails failed", e); }
    }
    return json({ ok: true, status });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
