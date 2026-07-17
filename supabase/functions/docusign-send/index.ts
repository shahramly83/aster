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
  const rows: [string, string][] = [["Role", opts.jobTitle]];
  if (o.base_salary != null) {
    const sym = CURRENCY_SYMBOL[(o.salary_currency || "myr").toLowerCase()] || "";
    rows.push(["Base salary", `${sym}${Number(o.base_salary).toLocaleString("en-US")}`]);
  }
  if (o.employment_type) rows.push(["Employment type", EMPLOYMENT_LABEL[o.employment_type] || o.employment_type]);
  if (o.start_date) rows.push(["Start date", fmtDate(o.start_date)]);
  if (o.expires_at) rows.push(["Offer valid until", fmtDate(o.expires_at)]);
  const trs = rows.map(([k, v]) =>
    `<tr><td class="term-k">${esc(k)}</td><td class="term-v">${esc(v)}</td></tr>`).join("");
  const brand = opts.logo
    ? `<img src="${opts.logo}" alt="${esc(opts.companyName)}" style="height:42px;max-width:240px;object-fit:contain;display:block;">`
    : `<div class="serif" style="font-size:24px;font-weight:700;color:#1a1523;letter-spacing:-0.01em;">${esc(opts.companyName)}</div>`;
  const addr = opts.addressLine ? `<div class="muted" style="font-size:12.5px;margin-top:8px;">${esc(opts.addressLine)}</div>` : "";
  const foot = `${esc(opts.companyName)}${opts.addressLine ? ` &middot; ${esc(opts.addressLine)}` : ""}`;
  const body = opts.message
    ? messageToHtml(opts.message)
    : `<p>Dear ${esc(opts.candidateName)},</p><p>Following your interview, we are pleased to offer you the <strong>${esc(opts.jobTitle)}</strong> role at ${esc(opts.companyName)}, on the terms set out below.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#1a1523;line-height:1.65;font-size:14px;padding:56px 60px;max-width:664px;margin:0 auto;background:#ffffff;}
    p{margin:0 0 14px;}
    .serif{font-family:Georgia,'Times New Roman',serif;}
    .muted{color:#6b7280;}
    .head{padding-bottom:16px;}
    .rule{height:2px;background:#1a1523;margin:16px 0 0;}
    .date{text-align:right;font-size:13px;color:#6b7280;margin:16px 0 2px;}
    .eyebrow{font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#9a938a;margin:0 0 18px;font-weight:700;}
    .terms{width:100%;border-collapse:collapse;margin:20px 0 26px;background:#faf9f7;border:1px solid #ece9e4;}
    .terms td{padding:13px 22px;border-bottom:1px solid #ece9e4;vertical-align:middle;}
    .terms tr:last-child td{border-bottom:none;}
    .term-k{font-size:11px;letter-spacing:0.07em;text-transform:uppercase;color:#8a857d;width:190px;font-weight:600;}
    .term-v{font-size:15px;font-weight:700;color:#1a1523;}
    .sig-field{border-bottom:1.5px solid #1a1523;width:300px;height:30px;}
    .sig-caption{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#8a857d;margin:7px 0 0;}
    .foot{margin-top:44px;padding-top:14px;border-top:1px solid #ece9e4;font-size:11px;color:#a8a29a;line-height:1.6;}
    .anchor{color:#ffffff;font-size:1px;}
  </style></head><body>
    <div class="head">${brand}${addr}<div class="rule"></div></div>
    <div class="date">${esc(opts.dateStr)}</div>
    <div class="eyebrow">Offer of Employment</div>
    ${body}
    <table class="terms">${trs}</table>
    <p style="margin-top:4px;">To accept this offer, please sign below. We look forward to welcoming you to ${esc(opts.companyName)}.</p>
    <div style="margin-top:40px;">
      <div class="sig-field"><span class="anchor">/sig1/</span></div>
      <div class="sig-caption">Signature</div>
      <div class="sig-field" style="margin-top:30px;"><span class="anchor">/date1/</span></div>
      <div class="sig-caption">Date</div>
    </div>
    <div class="foot">${foot}<br>This letter constitutes a formal offer of employment.</div>
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
