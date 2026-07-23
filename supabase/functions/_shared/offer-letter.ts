// Shared offer-letter model, used by both the public signing page (HTML preview
// via aster-sign?action=view) and the signed PDF (pdf-lib in aster-sign sign).
// One source of truth so what the candidate reads is exactly what gets signed.
//
// The letter reads as a standard business letter of offer: the terms are woven
// into prose (no key-value table), with a named company signatory.

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
  signatory_name?: string | null; signatory_title?: string | null;
  reporting_to?: string | null; work_location?: string | null;
};

export type LetterModel = {
  companyName: string;
  candidateName: string;
  jobTitle: string;
  addressLine: string;
  dateStr: string;
  subject: string;          // "Letter of Offer: <Position>"
  salutation: string;       // "Dear <First>,"
  paragraphs: string[];     // the letter body, in prose
  signatoryName: string;    // sign-off name (falls back to the company name)
  signatoryTitle: string;   // sign-off designation ("" if none)
};

// The letter body, in prose. If a body was composed/edited in the Send-offer
// modal (stored as message) it is used verbatim, so what HR writes is exactly
// what prints. Otherwise a standard body is generated from the terms.
export function letterBody(o: OfferRow, m: { candidateName: string; jobTitle: string; companyName: string }): string[] {
  if (o.message && o.message.trim()) {
    // Keep single newlines: a "HEADING\ntext" block renders the heading in bold.
    return o.message.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  }
  const paras: string[] = [];
  paras.push(`We are pleased to offer you the position of ${m.jobTitle} at ${m.companyName}, on the terms and conditions set out in this letter.`);

  const empLabel = (EMPLOYMENT_LABEL[o.employment_type || "full_time"] || "full-time").toLowerCase();
  let s1 = `You will be employed on a ${empLabel} basis`;
  if (o.start_date) s1 += `, with an expected commencement date of ${fmtDate(o.start_date)}`;
  s1 += ".";
  if (o.base_salary != null) {
    const sym = CURRENCY_SYMBOL[(o.salary_currency || "myr").toLowerCase()] || "";
    s1 += ` Your gross salary will be ${sym}${Number(o.base_salary).toLocaleString("en-US")} per month, subject to statutory deductions.`;
  }
  paras.push(s1);

  const extras: string[] = [];
  if (o.reporting_to && o.reporting_to.trim()) extras.push(`You will report to ${o.reporting_to.trim()}.`);
  if (o.work_location && o.work_location.trim()) extras.push(`Your place of work will be ${o.work_location.trim()}.`);
  if (extras.length) paras.push(extras.join(" "));

  let close = "";
  if (o.expires_at) close = `This offer remains open for your acceptance until ${fmtDate(o.expires_at)}. `;
  close += "To accept, please review the terms above and sign where indicated below.";
  paras.push(close);

  paras.push(`We are delighted at the prospect of you joining ${m.companyName} and look forward to welcoming you to the team.`);
  return paras;
}

export function buildLetterModel(o: OfferRow, m: { companyName: string; candidateName: string; jobTitle: string; addressLine: string; dateStr: string }): LetterModel {
  const first = (m.candidateName || "there").split(/\s+/)[0];
  return {
    companyName: m.companyName,
    candidateName: m.candidateName,
    jobTitle: m.jobTitle,
    addressLine: m.addressLine,
    dateStr: m.dateStr,
    subject: `Letter of Offer: ${m.jobTitle}`,
    salutation: `Dear ${first},`,
    paragraphs: letterBody(o, m),
    signatoryName: (o.signatory_name && o.signatory_name.trim()) || m.companyName,
    signatoryTitle: (o.signatory_title && o.signatory_title.trim()) || "",
  };
}

// HTML for the on-page preview (no signature block; the page renders that below).
// `logo` is a URL or data URI (or null).
export function letterHtml(model: LetterModel, logo: string | null): string {
  const brand = logo
    ? `<img src="${logo}" alt="${esc(model.companyName)}" style="height:34px;max-width:190px;object-fit:contain;display:block;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1f2328;letter-spacing:-0.01em;">${esc(model.companyName)}</div>`;
  // Render each block; a "HEADING\ntext" block shows the heading in bold caps.
  const renderBlock = (p: string): string => {
    const nl = p.indexOf("\n");
    const head = nl > 0 ? p.slice(0, nl).trim() : "";
    if (head && head.length <= 45 && head === head.toUpperCase() && /[A-Z]/.test(head)) {
      const rest = esc(p.slice(nl + 1).replace(/\n/g, " ").trim());
      return `<div style="margin:0 0 13px;"><div style="font-weight:700;font-size:11.5px;letter-spacing:0.03em;color:#1f2328;margin:0 0 3px;">${esc(head)}</div><div>${rest}</div></div>`;
    }
    return `<p style="margin:0 0 13px;">${esc(p.replace(/\n/g, " "))}</p>`;
  };
  const body = model.paragraphs.map(renderBlock).join("");
  const signatory = model.signatoryTitle
    ? `<div style="font-weight:700;color:#1f2328;">${esc(model.signatoryName)}</div><div style="color:#5b5f66;">${esc(model.signatoryTitle)}</div><div style="color:#5b5f66;">${esc(model.companyName)}</div>`
    : `<div style="font-weight:700;color:#1f2328;">${esc(model.signatoryName)}</div>${model.signatoryName !== model.companyName ? `<div style="color:#5b5f66;">${esc(model.companyName)}</div>` : ""}`;
  return `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#33373c;line-height:1.7;font-size:13px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:1px solid #eee;margin-bottom:24px;">
      ${brand}
      <span style="color:#9298a1;font-size:12px;white-space:nowrap;flex-shrink:0;">${esc(model.dateStr)}</span>
    </div>
    <p style="margin:0 0 12px;">${esc(model.salutation)}</p>
    <p style="margin:0 0 18px;font-weight:700;color:#1f2328;text-transform:uppercase;letter-spacing:0.02em;font-size:13px;">${esc(model.subject)}</p>
    ${body}
    <div style="margin:22px 0 0;">Yours sincerely,</div>
    <div style="margin-top:10px;">${signatory}</div>
    ${model.addressLine ? `<div style="margin-top:36px;padding-top:12px;border-top:1px solid #eee;font-size:11.5px;color:#8b8e94;line-height:1.6;">${esc(model.companyName)} · ${esc(model.addressLine)}</div>` : ""}
  </div>`;
}
