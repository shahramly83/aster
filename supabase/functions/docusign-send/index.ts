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
// The HR note, rendered into the letter (blank lines split paragraphs).
function messageToHtml(msg: string): string {
  return msg.trim().split(/\n{2,}/).map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`).join("");
}

type Offer = {
  company_id: string; candidate_id: string; base_salary: number | null; salary_currency: string | null;
  employment_type: string | null; start_date: string | null; expires_at: string | null; offer_job_title: string | null;
};

// Fetch the company logo and inline it as a data URI so it renders reliably in
// DocuSign's PDF (external image URLs are unreliable in the renderer).
async function logoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:${ct};base64,${btoa(bin)}`;
  } catch { return null; }
}

// The offer letter as HTML. The /sig1/ and /date1/ anchors are where DocuSign
// drops the signature and date fields (hidden white text so they don't show).
function offerLetterHtml(o: Offer, opts: { companyName: string; candidateName: string; jobTitle: string; logo: string | null; addressLine: string; dateStr: string; message: string | null }): string {
  const accent = "#C1272D"; // letter accent (a per-company brand colour can override this later)
  const rows: [string, string][] = [["Position", opts.jobTitle]];
  if (o.base_salary != null) {
    const sym = CURRENCY_SYMBOL[(o.salary_currency || "myr").toLowerCase()] || "";
    rows.push(["Base salary", `${sym}${Number(o.base_salary).toLocaleString("en-US")}`]);
  }
  if (o.employment_type) rows.push(["Employment type", EMPLOYMENT_LABEL[o.employment_type] || o.employment_type]);
  if (o.start_date) rows.push(["Start date", fmtDate(o.start_date)]);
  if (o.expires_at) rows.push(["Offer valid until", fmtDate(o.expires_at)]);
  const trs = rows.map(([k, v]) =>
    `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join("");
  const brand = opts.logo
    ? `<img src="${opts.logo}" alt="${esc(opts.companyName)}" style="height:40px;max-width:250px;object-fit:contain;display:block;">`
    : `<div class="serif" style="font-size:26px;font-weight:700;color:#1f2328;letter-spacing:-0.01em;">${esc(opts.companyName)}</div>`;
  const body = opts.message
    ? messageToHtml(opts.message)
    : `<p>Dear ${esc(opts.candidateName)},</p><p>Following your interview, we're delighted to offer you the <strong>${esc(opts.jobTitle)}</strong> role at ${esc(opts.companyName)}. The full terms of your offer are set out below.</p>`;
  const contact = `<div class="cn">${esc(opts.companyName)}</div>${opts.addressLine ? `<div>${esc(opts.addressLine)}</div>` : ""}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#33373c;line-height:1.75;font-size:13.5px;padding:60px 64px 52px;max-width:640px;margin:0 auto;background:#ffffff;}
    p{margin:0 0 16px;}
    strong{color:#1f2328;}
    .serif{font-family:Georgia,'Times New Roman',serif;}
    .title{color:${accent};font-size:15px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin:24px 0 32px;}
    .date{text-align:right;color:#9298a1;font-size:13px;margin:0 0 30px;}
    .facts{width:100%;border-collapse:collapse;margin:8px 0 24px;}
    .facts td{padding:12px 0;border-bottom:1px solid #eeeeee;vertical-align:top;}
    .facts tr:last-child td{border-bottom:none;}
    .facts .k{color:#9a9a9a;text-transform:uppercase;letter-spacing:0.08em;font-size:11px;font-weight:600;width:180px;padding-top:14px;}
    .facts .v{color:#1f2328;font-weight:600;font-size:14px;}
    .signoff{margin:22px 0 0;}
    .signoff .co{font-weight:700;color:#1f2328;}
    .accept{margin-top:42px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#9a9a9a;font-weight:600;}
    .sig-line{border-bottom:1.5px solid #1f2328;width:280px;height:36px;margin-top:6px;}
    .sig-name{font-weight:700;color:#1f2328;margin-top:8px;font-size:14px;}
    .sig-cap{color:#9a9a9a;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;}
    .contact{margin-top:48px;text-align:right;font-size:12.5px;color:#77797d;line-height:1.7;}
    .contact .cn{font-weight:700;color:#1f2328;font-size:13.5px;}
    .anchor{color:#ffffff;font-size:1px;}
  </style></head><body>
    ${brand}
    <div class="title">Offer of Employment</div>
    <div class="date">Date: ${esc(opts.dateStr)}</div>
    ${body}
    <table class="facts">${trs}</table>
    <p>To accept this offer, please review the terms above and sign below. We look forward to welcoming you to ${esc(opts.companyName)}.</p>
    <div class="signoff">Warm regards,<br><span class="co">${esc(opts.companyName)}</span></div>
    <div class="accept">Accepted and agreed</div>
    <div class="sig-line"><span class="anchor">/sig1/</span></div>
    <div class="sig-name">${esc(opts.candidateName)}</div>
    <div class="sig-cap">Signature</div>
    <div class="sig-line" style="width:200px;margin-top:26px;"><span class="anchor">/date1/</span></div>
    <div class="sig-cap">Date</div>
    <div class="contact">${contact}</div>
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
    const { token: offerToken, message } = await req.json();
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

    const { data: comp } = await admin.from("companies")
      .select("name, logo_url, address, address_street, address_city, address_state, address_postcode, address_country")
      .eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logo = await logoDataUri(comp?.logo_url || null);
    const addressLine = [
      comp?.address_street || comp?.address,
      comp?.address_city,
      [comp?.address_state, comp?.address_postcode].filter(Boolean).join(" "),
      comp?.address_country,
    ].filter(Boolean).join(", ");
    const dateStr = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
    let jobTitle = offer.offer_job_title || "the role";
    if (!offer.offer_job_title) {
      const { data: app } = await admin.from("applications").select("jobs(title)")
        .eq("company_id", companyId).eq("candidate_id", offer.candidate_id)
        .order("created_at", { ascending: false }).limit(1);
      jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || jobTitle;
    }

    // The HR note goes INTO the offer letter (under the company's own logo/name),
    // not into DocuSign's email — otherwise DocuSign prints "Message from <our
    // DocuSign account>", which is wrong in a multi-company setup.
    const note = (typeof message === "string" && message.trim()) ? message.trim().slice(0, 8000) : null;
    const html = offerLetterHtml(offer as Offer, { companyName, candidateName: cand.full_name || "there", jobTitle, logo, addressLine, dateStr, message: note });

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
