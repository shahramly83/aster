// Shared transactional email helper (Resend).
// ---------------------------------------------------------------------------
// One place that knows how to send a branded email through Resend. Every edge
// function imports sendEmail() from here rather than talking to Resend directly,
// so the from-address, brand shell, and error handling stay consistent.
//
// Secrets:
//   RESEND_API_KEY   (required)  — https://resend.com → API Keys
// Optional overrides (env):
//   EMAIL_FROM       default "Aster <notifications@hireaster.com>"
//   EMAIL_REPLY_TO   default "support@hireaster.com"
//
// The sending domain (hireaster.com) must be verified in Resend, otherwise the
// API rejects the message. sendEmail() never throws: it returns { ok, id?, error? }
// so a failed email can be logged without breaking the flow that triggered it.

const BRAND = "#0B2AE0";       // Aster primary blue
const BRAND_2 = "#3550EE";     // gradient end (lighter blue)
const BRAND_0 = "#5570F5";     // gradient start (light blue)
const SITE = "https://hireaster.com";

const DEFAULT_FROM = "Aster <notifications@hireaster.com>";
const DEFAULT_REPLY_TO = "support@hireaster.com";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;         // plain-text fallback; derived from html if omitted
  replyTo?: string;      // overrides EMAIL_REPLY_TO for this message
  from?: string;         // overrides EMAIL_FROM for this message
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;     // true when no API key is configured (soft no-op)
}

// Strip tags for a readable plain-text fallback when the caller gives only html.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Minimal HTML escaper for values interpolated into a template.
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A branded, email-client-safe shell (table layout, inline styles, light theme).
// `preview` seeds the inbox preview line; `heading` is the H1; `bodyHtml` is
// trusted HTML the caller has already escaped where needed.
export function emailShell(opts: { heading: string; bodyHtml: string; preview?: string; footnote?: string }): string {
  const { heading, bodyHtml, preview = "", footnote } = opts;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#F4F2FA;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FA;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ECE7F5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:26px 32px 0;">
          <a href="${SITE}" style="text-decoration:none;">
            <img src="${SITE}/aster-logo.png" height="30" alt="Aster" style="height:30px;width:auto;display:inline-block;border:0;">
          </a>
        </td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;color:#171326;font-weight:700;">${esc(heading)}</h1>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4A4560;">
          ${bodyHtml}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8B8699;text-align:center;">
          ${footnote ? esc(footnote) + "<br>" : ""}
          <a href="${SITE}" style="color:#8B8699;text-decoration:underline;">hireaster.com</a> &nbsp;·&nbsp; AI hiring, done right.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// A company-branded shell (Tier 2): a company's own hiring mail to applicants /
// candidates. Uses the company's uploaded logo (falling back to its name) in the
// header and signs off "Best Regards, {companyName}" in the body. It carries NO
// Aster footer — Tier 2 mail is the company's brand, not Aster's.
export function companyShell(opts: {
  companyName: string;
  logoUrl?: string | null;
  heading: string;
  bodyHtml: string;
  preview?: string;
  signoff?: boolean;    // append "Best Regards, {companyName}" (default true)
}): string {
  const { companyName, logoUrl, heading, bodyHtml, preview = "", signoff = true } = opts;
  const brand = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" height="34" style="max-height:34px;max-width:200px;display:inline-block;vertical-align:middle;border:0;">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:18px;color:#171326;vertical-align:middle;">${esc(companyName)}</span>`;
  const sign = signoff
    ? `<p style="margin:20px 0 0;">Best Regards,<br>${esc(companyName)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#F4F2FA;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FA;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ECE7F5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:26px 32px 0;">${brand}</td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;color:#171326;font-weight:700;">${esc(heading)}</h1>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4A4560;">
          ${bodyHtml}
          ${sign}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Replace {{token}} placeholders with escaped values. Unknown tokens render as
// empty. The surrounding template is trusted (code default or the editor); only
// the interpolated values are escaped, so applicant names can't break the layout.
export function renderTemplate(tpl: string, tokens: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => esc(tokens[k as string]));
}

// Turn an already-escaped plain-text body (blank-line separated) into HTML
// paragraphs, single newlines becoming <br>. Used to render company templates,
// which are authored as plain text in the editor.
export function paragraphs(text: string): string {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface EmailTemplate { subject: string; body: string; }

// Resolve a template for a send. A company override wins; then a platform
// default row; then the hardcoded `defaults` the caller ships. `admin` is a
// service-role Supabase client (bypasses RLS). Never throws — falls back to
// `defaults` on any error so a send is never blocked by a template lookup.
export async function loadTemplate(
  admin: { from: (table: string) => any },
  key: string,
  companyId: string | null,
  defaults: EmailTemplate,
): Promise<EmailTemplate> {
  try {
    if (companyId) {
      const { data } = await admin.from("email_templates")
        .select("subject, body, enabled")
        .eq("scope", "company").eq("company_id", companyId).eq("key", key).maybeSingle();
      if (data && data.enabled) return { subject: data.subject, body: data.body };
    }
    const { data: plat } = await admin.from("email_templates")
      .select("subject, body, enabled")
      .eq("scope", "platform").eq("key", key).maybeSingle();
    if (plat && plat.enabled) return { subject: plat.subject, body: plat.body };
  } catch (e) {
    console.error("[email] loadTemplate failed, using default for", key, e);
  }
  return defaults;
}

// A simple purple call-to-action button (bulletproof-ish for common clients).
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;"><tr>
    <td style="border-radius:10px;background:linear-gradient(135deg,${BRAND_0},${BRAND} 45%,${BRAND_2});">
      <a href="${esc(href)}" style="display:inline-block;padding:11px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
    </td></tr></table>`;
}

// Send one email. Never throws — returns a result object the caller can log.
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", input.to);
    return { ok: false, skipped: true, error: "no_api_key" };
  }
  const from = input.from || Deno.env.get("EMAIL_FROM") || DEFAULT_FROM;
  const replyTo = input.replyTo || Deno.env.get("EMAIL_REPLY_TO") || DEFAULT_REPLY_TO;
  const text = input.text || htmlToText(input.html);

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        reply_to: replyTo,
        subject: input.subject,
        html: input.html,
        text,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[email] resend error", resp.status, body);
      return { ok: false, error: `resend_${resp.status}` };
    }
    const data = await resp.json().catch(() => ({}));
    return { ok: true, id: (data as { id?: string }).id };
  } catch (e) {
    console.error("[email] send failed", e);
    return { ok: false, error: "network" };
  }
}
