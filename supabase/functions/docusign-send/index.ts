// Supabase Edge Function: docusign-send
// ---------------------------------------------------------------------------
// HR sends an existing offer (offers row + token) to the candidate for signature
// via DocuSign. Verifies the caller belongs to the offer's company, builds an
// offer-letter HTML document from the stored terms, creates a DocuSign envelope
// with the candidate as signer (anchor tabs), sends it, and records the
// envelope id + status on the offer. The DocuSign Connect webhook
// (docusign-connect) later flips the status to completed and stores the PDF.
//
// Secrets: DOCUSIGN_* (see _shared/docusign.ts), plus SUPABASE_* (auto).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dsAccessToken, dsConfigured } from "../_shared/docusign.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const CURRENCY_SYMBOL: Record<string, string> = { myr: "RM", usd: "$", sgd: "S$" };
const EMPLOYMENT_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };
function fmtDate(d: string | null): string {
  if (!d) return "";
  try { return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T00:00:00`)); } catch { return d; }
}
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Offer = {
  company_id: string; candidate_id: string; base_salary: number | null; salary_currency: string | null;
  employment_type: string | null; start_date: string | null; expires_at: string | null; offer_job_title: string | null;
};

// The offer letter as HTML. The /sig1/ and /date1/ anchors are where DocuSign
// drops the signature and date fields (hidden white text so they don't show).
function offerLetterHtml(o: Offer, opts: { companyName: string; candidateName: string; jobTitle: string }): string {
  const rows: [string, string][] = [["Role", opts.jobTitle]];
  if (o.base_salary != null) {
    const sym = CURRENCY_SYMBOL[(o.salary_currency || "myr").toLowerCase()] || "";
    rows.push(["Base salary", `${sym}${Number(o.base_salary).toLocaleString("en-US")}`]);
  }
  if (o.employment_type) rows.push(["Employment type", EMPLOYMENT_LABEL[o.employment_type] || o.employment_type]);
  if (o.start_date) rows.push(["Start date", fmtDate(o.start_date)]);
  if (o.expires_at) rows.push(["Offer valid until", fmtDate(o.expires_at)]);
  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:8px 24px 8px 0;color:#6b7280;">${esc(k)}</td><td style="padding:8px 0;font-weight:600;color:#111827;">${esc(v)}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;padding:48px;max-width:640px;margin:0 auto;}
    h1{font-size:20px;margin:0 0 4px;} .muted{color:#6b7280;font-size:13px;}
    table{border-collapse:collapse;margin:20px 0;font-size:14px;}
    .sigline{margin-top:56px;border-top:1px solid #111827;width:280px;padding-top:6px;font-size:13px;color:#6b7280;}
    .anchor{color:#ffffff;font-size:1px;}
  </style></head><body>
    <h1>${esc(opts.companyName)}</h1>
    <p class="muted">Offer of employment</p>
    <p>Dear ${esc(opts.candidateName)},</p>
    <p>Following your interview, we are pleased to offer you the <strong>${esc(opts.jobTitle)}</strong> role at ${esc(opts.companyName)}, on the terms below.</p>
    <table>${trs}</table>
    <p>To accept, please sign below. We look forward to welcoming you to the team.</p>
    <div class="sigline">Signature: <span class="anchor">/sig1/</span></div>
    <div class="muted" style="margin-top:8px;">Date: <span class="anchor">/date1/</span></div>
  </body></html>`;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    if (!dsConfigured()) return json({ error: "docusign_not_configured" }, 501);

    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { token: offerToken } = await req.json();
    if (!offerToken) return json({ error: "token is required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers")
      .select("company_id, candidate_id, base_salary, salary_currency, employment_type, start_date, expires_at, offer_job_title")
      .eq("token", offerToken).maybeSingle();
    if (!offer || offer.company_id !== companyId) return json({ error: "not found" }, 404);

    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
    if (!cand?.email) return json({ error: "candidate has no email" }, 422);

    const { data: comp } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    let jobTitle = offer.offer_job_title || "the role";
    if (!offer.offer_job_title) {
      const { data: app } = await admin.from("applications").select("jobs(title)")
        .eq("company_id", companyId).eq("candidate_id", offer.candidate_id)
        .order("created_at", { ascending: false }).limit(1);
      jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || jobTitle;
    }

    const html = offerLetterHtml(offer as Offer, { companyName, candidateName: cand.full_name || "there", jobTitle });

    const { token: accessToken, basePath } = await dsAccessToken();
    const accountId = Deno.env.get("DOCUSIGN_ACCOUNT_ID")!;

    const envelope = {
      emailSubject: `Your offer from ${companyName}`,
      documents: [{ documentBase64: toBase64(html), name: "Offer Letter", fileExtension: "html", documentId: "1" }],
      recipients: {
        signers: [{
          email: cand.email,
          name: cand.full_name || cand.email,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            signHereTabs: [{ anchorString: "/sig1/", anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-6" }],
            dateSignedTabs: [{ anchorString: "/date1/", anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-6" }],
          },
        }],
      },
      status: "sent",
    };

    const res = await fetch(`${basePath}/v2.1/accounts/${accountId}/envelopes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    const data = await res.json();
    if (!res.ok || !data.envelopeId) {
      console.error("docusign envelope create failed", res.status, data);
      return json({ error: "envelope_failed", detail: data.message || data.errorCode || res.status }, 502);
    }

    await admin.from("offers").update({
      esign_provider: "docusign",
      esign_envelope_id: data.envelopeId,
      esign_status: "sent",
    }).eq("token", offerToken);

    return json({ ok: true, envelopeId: data.envelopeId });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
