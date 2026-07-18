// Shared offer-letter model, used by both the public signing page (HTML preview
// via aster-sign?action=view) and the signed PDF (pdf-lib in aster-sign sign).
// One source of truth so what the candidate reads is exactly what gets signed.

export const CURRENCY_SYMBOL: Record<string, string> = { myr: "RM", usd: "$", sgd: "S$" };
export const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship",
};

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T00:00:00`)); } catch { return String(d); }
}

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type OfferRow = {
  base_salary: number | null; salary_currency: string | null; employment_type: string | null;
  start_date: string | null; expires_at: string | null; offer_job_title: string | null; message: string | null;
};

export type LetterModel = {
  companyName: string;
  candidateName: string;
  jobTitle: string;
  addressLine: string;
  dateStr: string;
  paragraphs: string[];      // the letter body, already split into paragraphs
  terms: [string, string][]; // label / value rows
};

// The structured terms rows (Position first, then whatever was filled in).
export function termsRows(o: OfferRow, jobTitle: string): [string, string][] {
  const rows: [string, string][] = [["Position", jobTitle]];
  if (o.base_salary != null) {
    const sym = CURRENCY_SYMBOL[(o.salary_currency || "myr").toLowerCase()] || "";
    rows.push(["Base salary", `${sym}${Number(o.base_salary).toLocaleString("en-US")}`]);
  }
  if (o.employment_type) rows.push(["Employment type", EMPLOYMENT_LABEL[o.employment_type] || o.employment_type]);
  if (o.start_date) rows.push(["Start date", fmtDate(o.start_date)]);
  if (o.expires_at) rows.push(["Offer valid until", fmtDate(o.expires_at)]);
  return rows;
}

// The letter body. A stored HR message wins (split on blank lines); otherwise a
// sensible default. Kept as plain paragraphs so both HTML and PDF can lay it out.
export function letterParagraphs(o: OfferRow, m: { candidateName: string; jobTitle: string; companyName: string }): string[] {
  if (o.message && o.message.trim()) {
    return o.message.trim().split(/\n{2,}/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  }
  return [
    `Dear ${m.candidateName},`,
    `Following your interview, we are delighted to offer you the ${m.jobTitle} role at ${m.companyName}. The full terms of your offer are set out below.`,
  ];
}

export function buildLetterModel(o: OfferRow, m: { companyName: string; candidateName: string; jobTitle: string; addressLine: string; dateStr: string }): LetterModel {
  return {
    companyName: m.companyName,
    candidateName: m.candidateName,
    jobTitle: m.jobTitle,
    addressLine: m.addressLine,
    dateStr: m.dateStr,
    paragraphs: letterParagraphs(o, m),
    terms: termsRows(o, m.jobTitle),
  };
}

// HTML for the on-page preview (no signature block; the page renders that below).
// `logo` is a data URI or null.
export function letterHtml(model: LetterModel, logo: string | null): string {
  const brand = logo
    ? `<img src="${logo}" alt="${esc(model.companyName)}" style="height:38px;max-width:230px;object-fit:contain;display:block;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1f2328;letter-spacing:-0.01em;">${esc(model.companyName)}</div>`;
  const body = model.paragraphs.map((p) => `<p style="margin:0 0 15px;">${esc(p)}</p>`).join("");
  const trs = model.terms.map(([k, v], i) =>
    `<tr><td style="padding:11px 0;border-bottom:${i === model.terms.length - 1 ? "none" : "1px solid #eee"};color:#9a9a9a;text-transform:uppercase;letter-spacing:0.08em;font-size:10.5px;font-weight:600;width:170px;vertical-align:top;">${esc(k)}</td><td style="padding:11px 0;border-bottom:${i === model.terms.length - 1 ? "none" : "1px solid #eee"};color:#1f2328;font-weight:600;font-size:13.5px;vertical-align:top;">${esc(v)}</td></tr>`).join("");
  return `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#33373c;line-height:1.7;font-size:13px;">
    ${brand}
    <div style="text-align:right;color:#9298a1;font-size:12px;margin:22px 0 22px;">Date: ${esc(model.dateStr)}</div>
    ${body}
    <table style="width:100%;border-collapse:collapse;margin:6px 0 20px;">${trs}</table>
    <p style="margin:0 0 15px;">To accept this offer, please review the terms above and sign below. We look forward to welcoming you to ${esc(model.companyName)}.</p>
    <div style="margin:18px 0 0;">Warm regards,<br><span style="font-weight:700;color:#1f2328;">${esc(model.companyName)}</span></div>
    ${model.addressLine ? `<div style="margin-top:34px;text-align:right;font-size:12px;color:#77797d;line-height:1.6;"><span style="font-weight:700;color:#1f2328;">${esc(model.companyName)}</span><br>${esc(model.addressLine)}</div>` : ""}
  </div>`;
}
