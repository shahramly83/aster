// Supabase Edge Function: aster-sign  (PUBLIC — deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// Native e-signature ("Aster Sign"), replacing DocuSign. The candidate opens
// /offer/<token> (no login) and this function serves two actions:
//
//   action: "view"  → marks the offer viewed and returns the rendered letter HTML
//                     + candidate name, so the page can display the offer.
//   action: "sign"  → records the audit trail (signer identity via token, IP, UA,
//                     timestamp, explicit consent, SHA-256 letter hash), builds a
//                     signed PDF with a certificate of completion, stores it in the
//                     private 'offer-letters' bucket, flips the offer to accepted,
//                     then notifies the team and welcomes the candidate.
//
// A simple electronic signature with this audit trail is enforceable for
// employment offers (Malaysia ECA 2006, US ESIGN/UETA, EU eIDAS SES).
//
// Secrets: RESEND_API_KEY (emails). Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs as emailParagraphs } from "../_shared/email.ts";
import { buildLetterModel, letterHtml, type LetterModel, type OfferRow } from "../_shared/offer-letter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] };
  } catch { return null; }
}

async function fetchLogoBytes(url: string | null): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") || "image/png" };
  } catch { return null; }
}

// ── PDF: the signed offer letter + a certificate-of-completion page ──────────
async function buildSignedPdf(model: LetterModel, opts: {
  logo: { bytes: Uint8Array; mime: string } | null;
  signatureType: "typed" | "drawn";
  signedName: string;
  drawn: { bytes: Uint8Array; mime: string } | null;
  offerId: string; signerEmail: string; signedAtIso: string; ip: string; ua: string; docHash: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.12, 0.14, 0.16);
  const gray = rgb(0.6, 0.6, 0.63);
  const line = rgb(0.9, 0.9, 0.92);

  const W = 595.28, H = 841.89, M = 58;
  const maxW = W - M * 2;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const words = String(text).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const para = (text: string, f: typeof font, size: number, color = ink, leading = size * 1.5) => {
    for (const ln of wrap(text, f, size)) { page.drawText(ln, { x: M, y, size, font: f, color }); y -= leading; }
  };

  // Letterhead: logo (or company name) + date on the right.
  if (opts.logo) {
    try {
      const img = opts.logo.mime.includes("png") ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
      const h = 30, w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h + 6, width: Math.min(w, 200), height: h });
    } catch { page.drawText(model.companyName, { x: M, y: y - 6, size: 17, font: bold, color: ink }); }
  } else {
    page.drawText(model.companyName, { x: M, y: y - 6, size: 17, font: bold, color: ink });
  }
  const dateText = `Date: ${model.dateStr}`;
  page.drawText(dateText, { x: W - M - font.widthOfTextAtSize(dateText, 10), y: y - 4, size: 10, font, color: gray });
  y -= 44;

  // Body paragraphs.
  for (const p of model.paragraphs) { para(p, font, 10.5, ink, 15.5); y -= 6; }
  y -= 4;

  // Terms.
  for (const [k, v] of model.terms) {
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.5, color: line });
    page.drawText(k.toUpperCase(), { x: M, y, size: 8.5, font: bold, color: gray });
    const vw = wrap(v, bold, 11);
    let vy = y + 1;
    for (const ln of vw) { page.drawText(ln, { x: M + 175, y: vy, size: 11, font: bold, color: ink }); vy -= 14; }
    y -= Math.max(24, vw.length * 14 + 10);
  }
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.5, color: line });
  y -= 8;

  para(`To accept this offer, please review the terms above and sign below. We look forward to welcoming you to ${model.companyName}.`, font, 10.5, ink, 15.5);
  y -= 12;
  page.drawText("Warm regards,", { x: M, y, size: 10.5, font, color: ink }); y -= 15;
  page.drawText(model.companyName, { x: M, y, size: 10.5, font: bold, color: ink }); y -= 40;

  // Signature block.
  page.drawText("ACCEPTED AND AGREED", { x: M, y, size: 9, font: bold, color: gray }); y -= 30;
  if (opts.signatureType === "drawn" && opts.drawn) {
    try {
      const img = opts.drawn.mime.includes("png") ? await doc.embedPng(opts.drawn.bytes) : await doc.embedJpg(opts.drawn.bytes);
      const h = 40, w = Math.min((img.width / img.height) * h, 240);
      page.drawImage(img, { x: M, y: y - 4, width: w, height: h });
    } catch { page.drawText(opts.signedName, { x: M, y, size: 22, font: italic, color: ink }); }
  } else {
    page.drawText(opts.signedName, { x: M, y, size: 22, font: italic, color: ink });
  }
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: M + 280, y }, thickness: 1.2, color: ink });
  page.drawLine({ start: { x: M + 320, y }, end: { x: M + 480, y }, thickness: 1.2, color: ink });
  y -= 14;
  page.drawText(opts.signedName, { x: M, y, size: 11, font: bold, color: ink });
  const dsigned = new Date(opts.signedAtIso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  page.drawText(dsigned, { x: M + 320, y, size: 11, font: bold, color: ink });
  y -= 12;
  page.drawText("SIGNATURE", { x: M, y, size: 8, font, color: gray });
  page.drawText("DATE", { x: M + 320, y, size: 8, font, color: gray });

  // Footer.
  if (model.addressLine) {
    const foot = `${model.companyName} · ${model.addressLine}`;
    for (const ln of wrap(foot, font, 9)) { /* right-aligned */ page.drawText(ln, { x: W - M - font.widthOfTextAtSize(ln, 9), y: 54, size: 9, font, color: gray }); }
  }

  // ── Certificate of completion page ─────────────────────────────────────────
  const cert = doc.addPage([W, H]);
  let cy = H - M;
  cert.drawText("Certificate of Completion", { x: M, y: cy, size: 18, font: bold, color: ink }); cy -= 12;
  cert.drawText("Aster Sign — electronic signature record", { x: M, y: cy, size: 10, font, color: gray }); cy -= 28;
  cert.drawLine({ start: { x: M, y: cy }, end: { x: W - M, y: cy }, thickness: 0.5, color: line }); cy -= 22;

  const uaShort = opts.ua.length > 90 ? opts.ua.slice(0, 90) + "…" : opts.ua;
  const rows: [string, string][] = [
    ["Document", `Offer Letter — ${model.jobTitle}`],
    ["Offer reference", opts.offerId],
    ["Signer", model.candidateName],
    ["Signer email", opts.signerEmail],
    ["Signature method", opts.signatureType === "drawn" ? "Drawn signature" : "Typed signature"],
    ["Consent to sign electronically", "Yes, captured at signing"],
    ["Signed at (UTC)", new Date(opts.signedAtIso).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")],
    ["Signer IP address", opts.ip || "not available"],
    ["Signer device", uaShort || "not available"],
    ["Document hash (SHA-256)", opts.docHash],
  ];
  for (const [k, v] of rows) {
    cert.drawText(k.toUpperCase(), { x: M, y: cy, size: 8, font: bold, color: gray });
    const vlines = wrap(v, font, 10);
    let vy = cy;
    for (const ln of vlines) { cert.drawText(ln, { x: M + 200, y: vy, size: 10, font, color: ink }); vy -= 13; }
    cy -= Math.max(22, vlines.length * 13 + 9);
  }
  cy -= 8;
  cert.drawLine({ start: { x: M, y: cy }, end: { x: W - M, y: cy }, thickness: 0.5, color: line }); cy -= 20;
  const legal = "This document was signed electronically using Aster Sign. The signer confirmed their intent to sign and consented to conduct business electronically. This record, together with the signer identity (verified by possession of a unique emailed link), timestamp, IP address and document hash above, evidences a valid electronic signature under the Malaysia Electronic Commerce Act 2006, the US ESIGN Act / UETA and EU eIDAS (simple electronic signature).";
  for (const ln of wrap(legal, font, 8.5)) { cert.drawText(ln, { x: M, y: cy, size: 8.5, font, color: gray }); cy -= 12; }

  return await doc.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action === "sign" ? "sign" : "view";
    const token = String(body?.token || "");
    if (!token) return json({ error: "token is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: offer } = await admin.from("offers")
      .select("id, company_id, candidate_id, status, esign_status, base_salary, salary_currency, employment_type, start_date, expires_at, offer_job_title, message, created_at")
      .eq("token", token).maybeSingle();
    if (!offer) return json({ error: "not_found" }, 404);

    // Resolve company, candidate and job title (used by both actions).
    const { data: comp } = await admin.from("companies")
      .select("name, logo_url, address, address_street, address_city, address_state, address_postcode, address_country")
      .eq("id", offer.company_id).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
    const candidateName = cand?.full_name || "there";
    let jobTitle = offer.offer_job_title || "the role";
    if (!offer.offer_job_title) {
      const { data: app } = await admin.from("applications").select("jobs(title)")
        .eq("company_id", offer.company_id).eq("candidate_id", offer.candidate_id)
        .order("created_at", { ascending: false }).limit(1);
      jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || jobTitle;
    }
    const addressLine = [
      comp?.address_street || comp?.address, comp?.address_city,
      [comp?.address_state, comp?.address_postcode].filter(Boolean).join(" "), comp?.address_country,
    ].filter(Boolean).join(", ");
    const dateStr = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" }).format(new Date(offer.created_at || Date.now()));
    const model = buildLetterModel(offer as OfferRow, { companyName, candidateName, jobTitle, addressLine, dateStr });

    // ── VIEW: mark delivered, return the letter for display ──────────────────
    if (action === "view") {
      if (offer.status === "sent" && offer.esign_status !== "completed") {
        const patch: Record<string, unknown> = { esign_provider: "aster", esign_status: "delivered" };
        if (!offer.esign_status || offer.esign_status === "sent") patch.viewed_at = new Date().toISOString();
        await admin.from("offers").update(patch).eq("id", offer.id);
      }
      // The browser loads the logo URL directly, so no data URI is needed here
      // (and building one by spreading the byte array overflows the call stack on
      // large logos). The PDF path embeds the logo bytes separately.
      return json({ ok: true, html: letterHtml(model, comp?.logo_url || null), candidateName, companyName, jobTitle });
    }

    // ── SIGN: validate, build PDF, store, settle, notify ─────────────────────
    if (offer.status === "accepted" || offer.status === "declined") return json({ error: "already_settled" }, 409);
    const signatureType = body?.signatureType === "drawn" ? "drawn" : "typed";
    const signedName = String(body?.typedName || cand?.full_name || "").trim();
    const drawn = signatureType === "drawn" ? dataUrlToBytes(String(body?.drawnPng || "")) : null;
    if (body?.consent !== true) return json({ error: "consent_required" }, 400);
    if (signatureType === "typed" && !signedName) return json({ error: "signature_required" }, 400);
    if (signatureType === "drawn" && !drawn) return json({ error: "signature_required" }, 400);

    const signedAtIso = new Date().toISOString();
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
    const ua = req.headers.get("user-agent") || "";
    const docHash = await sha256Hex(JSON.stringify({ companyName, jobTitle, terms: model.terms, paragraphs: model.paragraphs, signedName, signedAtIso }));

    const logo = await fetchLogoBytes(comp?.logo_url || null);
    const pdf = await buildSignedPdf(model, {
      logo, signatureType, signedName: signedName || candidateName, drawn,
      offerId: offer.id, signerEmail: cand?.email || "not available", signedAtIso, ip, ua, docHash,
    });

    const path = `${offer.company_id}/${offer.id}.pdf`;
    const up = await admin.storage.from("offer-letters").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) { console.error("signed pdf upload failed", up.error.message); return json({ error: "storage_failed" }, 500); }

    await admin.from("offers").update({
      esign_provider: "aster", esign_status: "completed", status: "accepted", responded_at: signedAtIso,
      signed_pdf_path: path, signed_name: signedName || candidateName, signature_type: signatureType,
      signed_ip: ip, signed_user_agent: ua, signed_at: signedAtIso, doc_hash: docHash,
    }).eq("id", offer.id);

    // Notify the team (offer accepted) and welcome the candidate. Best-effort.
    try {
      const logoUrl = comp?.logo_url || null;
      await admin.from("activity_log").insert({ company_id: offer.company_id, type: "offer_signed", title: `${candidateName} signed the offer`, description: `Signed the offer for the ${jobTitle} role.`, candidate_id: offer.candidate_id });

      const { data: recips } = await admin.from("profiles").select("email")
        .eq("company_id", offer.company_id).in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
      const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
      if (to.length) {
        const tpl = await loadTemplate(admin, "offer_accepted", offer.company_id, {
          subject: "{{candidate_name}} accepted your offer",
          body: "{{candidate_name}} accepted your offer for the {{job_title}} role. Open Aster to review the signed offer and mark them as hired when you're ready.",
        });
        const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
        await sendEmail({ to, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName, logoUrl, heading: "Offer accepted", preview: `${candidateName} accepted the ${jobTitle} offer.`, bodyHtml: emailParagraphs(renderTemplate(tpl.body, tokens)), signoff: false }) }).catch((e) => console.error("offer-accepted team email", e));
      }
      if (cand?.email) {
        const tpl = await loadTemplate(admin, "welcome_hired", offer.company_id, {
          subject: "Welcome to {{company_name}}, {{candidate_name}}!",
          body: "Hi {{candidate_name}},\n\nWe're thrilled you're joining {{company_name}} as our new {{job_title}}! Our HR team will reach out shortly with your onboarding details and start date.",
        });
        const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
        await sendEmail({ to: cand.email, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName, logoUrl, heading: "Welcome to the team", preview: `Welcome to ${companyName}!`, bodyHtml: emailParagraphs(renderTemplate(tpl.body, tokens)) }) }).catch((e) => console.error("welcome email", e));
      }
    } catch (e) { console.error("aster-sign completion emails failed", e); }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
