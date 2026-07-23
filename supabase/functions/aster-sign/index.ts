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
import { PDFDocument, StandardFonts, rgb, degrees } from "https://esm.sh/pdf-lib@1.17.1";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs as emailParagraphs } from "../_shared/email.ts";
import { pushToCompanyAdmins } from "../_shared/push.ts";
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

// Base64-encode bytes in chunks (spreading a whole PDF into fromCharCode overflows).
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
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

// Wrap text to a max width, hard-breaking a token wider than the column.
function wrapToWidth(text: string, f: { widthOfTextAtSize(s: string, n: number): number }, size: number, mw: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let w of String(text).split(/\s+/).filter(Boolean)) {
    while (f.widthOfTextAtSize(w, size) > mw && w.length > 1) {
      let i = 1;
      while (i < w.length && f.widthOfTextAtSize(w.slice(0, i + 1), size) <= mw) i++;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, i)); w = w.slice(i);
    }
    const t = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) > mw && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// The Certificate of Completion page — the audit trail. Shared by both the
// composed-letter PDF and the uploaded-letter PDF so the certificate is
// identical whichever mode the offer was sent in.
// deno-lint-ignore no-explicit-any
async function appendCertificatePage(doc: any, opts: {
  documentTitle: string; offerId: string; signerName: string; signerEmail: string;
  signatureType: "typed" | "drawn"; signedAtIso: string; ip: string; ua: string; docHash: string;
}) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.16);
  const gray = rgb(0.6, 0.6, 0.63);
  const line = rgb(0.9, 0.9, 0.92);
  const W = 595.28, H = 841.89, M = 58;

  const cert = doc.addPage([W, H]);
  let cy = H - M;
  cert.drawText("Certificate of Completion", { x: M, y: cy, size: 18, font: bold, color: ink }); cy -= 12;
  cert.drawText("Aster Sign — electronic signature record", { x: M, y: cy, size: 10, font, color: gray }); cy -= 28;
  cert.drawLine({ start: { x: M, y: cy }, end: { x: W - M, y: cy }, thickness: 0.5, color: line }); cy -= 22;

  const uaShort = opts.ua.length > 90 ? opts.ua.slice(0, 90) + "…" : opts.ua;
  const rows: [string, string][] = [
    ["Document", opts.documentTitle],
    ["Offer reference", opts.offerId],
    ["Signer", opts.signerName],
    ["Signer email", opts.signerEmail],
    ["Signature method", opts.signatureType === "drawn" ? "Drawn signature" : "Typed signature"],
    ["Consent to sign electronically", "Yes, captured at signing"],
    ["Signed at (UTC)", new Date(opts.signedAtIso).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")],
    ["Signer IP address", opts.ip || "not available"],
    ["Signer device", uaShort || "not available"],
    ["Document hash (SHA-256)", opts.docHash],
  ];
  const valX = M + 200;
  const valMaxW = W - M - valX;
  for (const [k, v] of rows) {
    cert.drawText(k.toUpperCase(), { x: M, y: cy, size: 8, font: bold, color: gray });
    const vlines = wrapToWidth(v, font, 10, valMaxW);
    let vy = cy;
    for (const ln of vlines) { cert.drawText(ln, { x: valX, y: vy, size: 10, font, color: ink }); vy -= 13; }
    cy -= Math.max(22, vlines.length * 13 + 9);
  }
  cy -= 8;
  cert.drawLine({ start: { x: M, y: cy }, end: { x: W - M, y: cy }, thickness: 0.5, color: line }); cy -= 20;
  const legal = "This document was signed electronically using Aster Sign. The signer confirmed their intent to sign and consented to conduct business electronically. This record, together with the signer identity (verified by possession of a unique emailed link), timestamp, IP address and document hash above, evidences a valid electronic signature under the Malaysia Electronic Commerce Act 2006, the US ESIGN Act / UETA and EU eIDAS (simple electronic signature).";
  for (const ln of wrapToWidth(legal, font, 8.5, W - M * 2)) { cert.drawText(ln, { x: M, y: cy, size: 8.5, font, color: gray }); cy -= 12; }
}

// Upload mode: stamp the candidate signature + date onto HR's own PDF at the
// placed box, then append the certificate. signField is normalized 0..1 to the
// page as the candidate saw it (top-left origin); we map it into pdf-lib's
// bottom-left page space and counter-rotate the content for rotated pages.
async function stampUploadedPdf(sourceBytes: Uint8Array, signField: {
  page: number; x: number; y: number; w: number; h: number;
}, opts: {
  signatureType: "typed" | "drawn"; signedName: string; drawn: { bytes: Uint8Array; mime: string } | null;
  documentTitle: string; offerId: string; signerEmail: string; signedAtIso: string; ip: string; ua: string; docHash: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.12, 0.14, 0.16);

  const pages = doc.getPages();
  const idx = Math.max(0, Math.min(pages.length - 1, Math.floor(signField.page ?? 0)));
  const page = pages[idx];
  const pw = page.getWidth(), ph = page.getHeight();
  const R = (((page.getRotation()?.angle ?? 0) % 360) + 360) % 360;
  const dispW = (R === 90 || R === 270) ? ph : pw;
  const dispH = (R === 90 || R === 270) ? pw : ph;
  const th = (-R * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  // display-normalized (top-left) → unrotated page-normalized (top-left)
  const dispToPageNorm = (u: number, v: number): [number, number] => {
    switch (R) {
      case 90: return [v, 1 - u];
      case 180: return [1 - u, 1 - v];
      case 270: return [1 - v, u];
      default: return [u, v];
    }
  };
  const toPage = (u: number, v: number): [number, number] => {
    const [up, vp] = dispToPageNorm(u, v);
    return [up * pw, ph * (1 - vp)];
  };
  // Bottom-left draw anchor for content of (w,h) centered in the box, given the
  // content is rotated by th about that anchor: anchor = C - Rot(th)·(w/2, h/2).
  const anchorFor = (Cx: number, Cy: number, w: number, h: number): [number, number] => [
    Cx - (w / 2 * cos - h / 2 * sin),
    Cy - (w / 2 * sin + h / 2 * cos),
  ];

  const [Cx, Cy] = toPage(signField.x + signField.w / 2, signField.y + signField.h / 2);
  const boxW = signField.w * dispW, boxH = signField.h * dispH;

  let drew = false;
  if (opts.signatureType === "drawn" && opts.drawn) {
    try {
      const img = opts.drawn.mime.includes("png") ? await doc.embedPng(opts.drawn.bytes) : await doc.embedJpg(opts.drawn.bytes);
      const ar = img.width / img.height;
      let w = boxW, h = w / ar;
      if (h > boxH) { h = boxH; w = h * ar; }
      const [ax, ay] = anchorFor(Cx, Cy, w, h);
      page.drawImage(img, { x: ax, y: ay, width: w, height: h, rotate: degrees(-R) });
      drew = true;
    } catch { /* fall through to a typed name */ }
  }
  if (!drew) {
    const size = Math.min(boxH * 0.75, 26);
    const w = Math.min(italic.widthOfTextAtSize(opts.signedName, size), boxW);
    const [ax, ay] = anchorFor(Cx, Cy, w, size);
    page.drawText(opts.signedName, { x: ax, y: ay, size, font: italic, color: ink, rotate: degrees(-R) });
  }
  // Note: no date is stamped beside the signature (the signed date still lives on
  // the certificate page). Only the candidate's signature goes on their letter.

  await appendCertificatePage(doc, {
    documentTitle: opts.documentTitle, offerId: opts.offerId, signerName: opts.signedName,
    signerEmail: opts.signerEmail, signatureType: opts.signatureType, signedAtIso: opts.signedAtIso,
    ip: opts.ip, ua: opts.ua, docHash: opts.docHash,
  });
  return await doc.save();
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

  // Wrap to an explicit max width, hard-breaking any single token wider than the
  // column (e.g. a SHA-256 hash or a long user-agent string).
  const wrapW = (text: string, f: typeof font, size: number, mw: number): string[] => {
    const lines: string[] = [];
    let cur = "";
    for (let w of String(text).split(/\s+/).filter(Boolean)) {
      while (f.widthOfTextAtSize(w, size) > mw && w.length > 1) {
        let i = 1;
        while (i < w.length && f.widthOfTextAtSize(w.slice(0, i + 1), size) <= mw) i++;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > mw && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const wrap = (text: string, f: typeof font, size: number): string[] => wrapW(text, f, size, maxW);
  const firstPage = page;
  const ensure = (need: number) => { if (y < M + need) { page = doc.addPage([W, H]); y = H - M; } };
  const para = (text: string, f: typeof font, size: number, color = ink, leading = size * 1.5) => {
    for (const ln of wrap(text, f, size)) { ensure(leading); page.drawText(ln, { x: M, y, size, font: f, color }); y -= leading; }
  };

  // Letterhead: a larger logo (or company name) top-left, the date top-right, a
  // hairline rule beneath, and generous breathing room before the letter body.
  const headTop = y;
  let logoH = 26;
  if (opts.logo) {
    try {
      const img = opts.logo.mime.includes("png") ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
      logoH = 34;
      const w = Math.min((img.width / img.height) * logoH, 190);
      page.drawImage(img, { x: M, y: headTop - logoH, width: w, height: logoH });
    } catch { page.drawText(model.companyName, { x: M, y: headTop - 20, size: 18, font: bold, color: ink }); logoH = 26; }
  } else {
    page.drawText(model.companyName, { x: M, y: headTop - 20, size: 18, font: bold, color: ink });
  }
  page.drawText(model.dateStr, { x: W - M - font.widthOfTextAtSize(model.dateStr, 10), y: headTop - 18, size: 10, font, color: gray });
  y = headTop - logoH - 24;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
  y -= 30;

  // Salutation + subject line.
  para(model.salutation, font, 10.5, ink, 15.5);
  y -= 8;
  para(model.subject.toUpperCase(), bold, 11.5, ink, 16);
  y -= 14;

  // Body blocks — a "HEADING\ntext" block prints the heading in bold caps.
  for (const blk of model.paragraphs) {
    const nl = blk.indexOf("\n");
    const head = nl > 0 ? blk.slice(0, nl).trim() : "";
    if (head && head.length <= 45 && head === head.toUpperCase() && /[A-Z]/.test(head)) {
      ensure(28);
      para(head, bold, 9.5, ink, 14);
      y -= 3;   // clear gap so the body starts on its own line under the heading
      para(blk.slice(nl + 1).replace(/\n/g, " ").trim(), font, 10.5, ink, 15.5);
    } else {
      para(blk.replace(/\n/g, " ").trim(), font, 10.5, ink, 15.5);
    }
    y -= 11;
  }
  y -= 6;

  // Sign-off with the named company signatory.
  ensure(64);
  page.drawText("Yours sincerely,", { x: M, y, size: 10.5, font, color: ink }); y -= 28;
  page.drawText(model.signatoryName, { x: M, y, size: 10.5, font: bold, color: ink }); y -= 14;
  if (model.signatoryTitle) { page.drawText(model.signatoryTitle, { x: M, y, size: 10, font, color: gray }); y -= 13; }
  if (model.signatoryName !== model.companyName) { page.drawText(model.companyName, { x: M, y, size: 10, font, color: gray }); y -= 13; }
  y -= 28;

  // Candidate signature block — single column: signature, then the date below it.
  ensure(220);
  const sigW = 320;
  const sigRule = rgb(0.55, 0.57, 0.6);   // thin, soft signature/date rules
  page.drawText("ACCEPTED AND AGREED", { x: M, y, size: 9, font: bold, color: gray });
  y -= 22;
  // Signature mark (drawn image or typed), larger, sitting just above its line.
  const sigLineY = y - 58;
  if (opts.signatureType === "drawn" && opts.drawn) {
    try {
      const img = opts.drawn.mime.includes("png") ? await doc.embedPng(opts.drawn.bytes) : await doc.embedJpg(opts.drawn.bytes);
      const h = 62, w = Math.min((img.width / img.height) * h, 320);
      page.drawImage(img, { x: M, y: sigLineY + 3, width: w, height: h });
    } catch { page.drawText(opts.signedName, { x: M, y: sigLineY + 12, size: 30, font: italic, color: ink }); }
  } else {
    page.drawText(opts.signedName, { x: M, y: sigLineY + 12, size: 30, font: italic, color: ink });
  }
  page.drawLine({ start: { x: M, y: sigLineY }, end: { x: M + sigW, y: sigLineY }, thickness: 0.6, color: sigRule });
  y = sigLineY - 15;
  page.drawText(opts.signedName, { x: M, y, size: 11, font: bold, color: ink }); y -= 12;
  page.drawText("SIGNATURE", { x: M, y, size: 8, font, color: gray }); y -= 40;
  // Date, below the name.
  const dsigned = new Date(opts.signedAtIso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  page.drawText(dsigned, { x: M, y, size: 11, font: bold, color: ink });
  const dateLineY = y - 7;
  page.drawLine({ start: { x: M, y: dateLineY }, end: { x: M + sigW, y: dateLineY }, thickness: 0.6, color: sigRule });
  y = dateLineY - 15;
  page.drawText("DATE", { x: M, y, size: 8, font, color: gray });

  // Footer on the first page.
  if (model.addressLine) {
    const foot = wrap(`${model.companyName} · ${model.addressLine}`, font, 9)[0];
    firstPage.drawText(foot, { x: W - M - font.widthOfTextAtSize(foot, 9), y: 38, size: 9, font, color: gray });
  }

  // ── Certificate of completion page (shared with upload mode) ────────────────
  await appendCertificatePage(doc, {
    documentTitle: `Offer Letter — ${model.jobTitle}`, offerId: opts.offerId, signerName: model.candidateName,
    signerEmail: opts.signerEmail, signatureType: opts.signatureType, signedAtIso: opts.signedAtIso,
    ip: opts.ip, ua: opts.ua, docHash: opts.docHash,
  });

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
      .select("id, company_id, candidate_id, status, esign_status, base_salary, salary_currency, employment_type, start_date, expires_at, offer_job_title, message, signatory_name, signatory_title, reporting_to, work_location, created_at, offer_mode, source_pdf_path, sign_field")
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
    const isUpload = offer.offer_mode === "upload";
    // Compose mode builds a letter model; upload mode has no structured letter.
    const model = isUpload ? null : buildLetterModel(offer as OfferRow, { companyName, candidateName, jobTitle, addressLine, dateStr });

    // Mark the offer delivered/viewed (both modes).
    const markViewed = async () => {
      if (offer.status === "sent" && offer.esign_status !== "completed") {
        const patch: Record<string, unknown> = { esign_provider: "aster", esign_status: "delivered" };
        if (!offer.esign_status || offer.esign_status === "sent") patch.viewed_at = new Date().toISOString();
        await admin.from("offers").update(patch).eq("id", offer.id);
      }
    };

    // ── VIEW: mark delivered, return the letter (compose) or the PDF (upload) ──
    if (action === "view") {
      await markViewed();
      if (isUpload) {
        // Hand the candidate page a short-lived URL to HR's uploaded PDF plus the
        // placed signature box; the page renders it with pdf.js.
        let pdfUrl: string | null = null;
        if (offer.source_pdf_path) {
          const { data: signed } = await admin.storage.from("offer-letters").createSignedUrl(offer.source_pdf_path, 600);
          pdfUrl = signed?.signedUrl || null;
        }
        return json({ ok: true, mode: "upload", pdfUrl, signField: offer.sign_field || null, candidateName, companyName, jobTitle });
      }
      // The browser loads the logo URL directly, so no data URI is needed here
      // (and building one by spreading the byte array overflows the call stack on
      // large logos). The PDF path embeds the logo bytes separately.
      return json({ ok: true, mode: "compose", html: letterHtml(model!, comp?.logo_url || null), candidateName, companyName, jobTitle });
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

    let pdf: Uint8Array;
    let docHash: string;
    if (isUpload) {
      // Stamp the candidate signature onto HR's own PDF at the placed box.
      if (!offer.source_pdf_path || !offer.sign_field) return json({ error: "offer_incomplete" }, 400);
      const dl = await admin.storage.from("offer-letters").download(offer.source_pdf_path);
      if (dl.error || !dl.data) { console.error("source pdf download failed", dl.error?.message); return json({ error: "storage_failed" }, 500); }
      const sourceBytes = new Uint8Array(await dl.data.arrayBuffer());
      // Hash the source PDF bytes — stronger evidence than a letter-model hash.
      docHash = await sha256Hex(bytesToBase64(sourceBytes));
      pdf = await stampUploadedPdf(sourceBytes, offer.sign_field as { page: number; x: number; y: number; w: number; h: number }, {
        signatureType, signedName: signedName || candidateName, drawn,
        documentTitle: `Offer Letter — ${jobTitle}`, offerId: offer.id,
        signerEmail: cand?.email || "not available", signedAtIso, ip, ua, docHash,
      });
    } else {
      docHash = await sha256Hex(JSON.stringify({ companyName, jobTitle, subject: model!.subject, paragraphs: model!.paragraphs, signatory: [model!.signatoryName, model!.signatoryTitle], signedName, signedAtIso }));
      const logo = await fetchLogoBytes(comp?.logo_url || null);
      pdf = await buildSignedPdf(model!, {
        logo, signatureType, signedName: signedName || candidateName, drawn,
        offerId: offer.id, signerEmail: cand?.email || "not available", signedAtIso, ip, ua, docHash,
      });
    }

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
      // A signed offer is the moment a hire lands. Push the team so it doesn't
      // sit unseen in an inbox. Best-effort, never blocks the signature.
      await pushToCompanyAdmins(admin, offer.company_id, {
        title: "Offer signed",
        body: `${candidateName} signed the ${jobTitle} offer. Mark them hired when ready.`,
        data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_signed" },
      });

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
          body: "Hi {{candidate_name}},\n\nWe're thrilled you're joining {{company_name}} as our new {{job_title}}! Our HR team will reach out shortly with your onboarding details.",
        });
        const tokens = { candidate_name: candidateName, job_title: jobTitle, company_name: companyName };
        // Attach the candidate's signed offer letter (PDF + certificate) for their records.
        const attachments = [{ filename: "signed-offer-letter.pdf", content: bytesToBase64(pdf), contentType: "application/pdf" }];
        const welcomeBody = `${emailParagraphs(renderTemplate(tpl.body, tokens))}<p style="margin:16px 0 0;color:#6b6b7b;font-size:13px;">A signed copy of your offer letter is attached to this email for your records.</p>`;
        await sendEmail({ to: cand.email, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName, logoUrl, heading: "Welcome to the team", preview: `Welcome to ${companyName}!`, bodyHtml: welcomeBody }), attachments }).catch((e) => console.error("welcome email", e));
      }
    } catch (e) { console.error("aster-sign completion emails failed", e); }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
