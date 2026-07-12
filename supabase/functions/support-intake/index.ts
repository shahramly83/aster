// Supabase Edge Function: support-intake
// ---------------------------------------------------------------------------
// Files a public help-center ticket AND emails the requester a confirmation.
// The help portal calls this instead of the submit_support_ticket RPC directly,
// so the confirmation email is sent server-side (the browser never touches the
// Resend key). Filing still goes through the same SECURITY DEFINER RPC, so the
// honeypot + validation logic lives in one place (migration 0016).
//
// Public function — deploy with `--no-verify-jwt`. It can only file a
// company-less 'open' ticket via the RPC; it reads nothing back.
//
// Secrets:  RESEND_API_KEY (for the confirmation email; ticket still files without it)
// Auto-provided by Supabase:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, esc } from "../_shared/email.ts";
import { rateLimit, clientIp } from "../_shared/ratelimit.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Public endpoint that files a ticket AND sends email via Resend — throttle per
  // IP so it can't be used to burn the email quota or spam the queue. The RPC's
  // honeypot still catches naive bots; this caps volume from a single source.
  const ip = clientIp(req);
  if (!(await rateLimit(`support:${ip}`, 6, 300, 3))) return json({ error: "rate_limited" }, 429);

  try {
    const { name, email, subject, body, website } = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // File the ticket through the same RPC the client used to call. The RPC
    // handles the honeypot (returns 'T-0' and inserts nothing) and validation.
    const { data: id, error } = await admin.rpc("submit_support_ticket", {
      p_name: name, p_email: email, p_subject: subject, p_body: body ?? null, p_website: website ?? null,
    });
    if (error) return json({ error: error.message || "could not file ticket" }, 400);

    // Honeypot tripped (id 'T-0') → pretend success, send nothing.
    if (id && id !== "T-0" && email) {
      try {
        const firstName = String(name || "").trim().split(" ")[0] || "there";
        // Strip the "[Category] " prefix the client adds for a cleaner subject line.
        const cleanSubject = String(subject || "").replace(/^\[[^\]]+\]\s*/, "").trim();
        await sendEmail({
          to: email,
          subject: `We got your request (${id})`,
          replyTo: "support@hireaster.com",
          html: emailShell({
            heading: "Thanks — we're on it",
            preview: `Your support request ${id} has been logged.`,
            bodyHtml: `
              <p style="margin:0 0 14px;">Hi ${esc(firstName)},</p>
              <p style="margin:0 0 14px;">We've logged your request and our team will get back to you by email, usually within one business day.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;width:100%;background:#F6EEFF;border:1px solid #E7D7FB;border-radius:10px;">
                <tr><td style="padding:12px 14px;font-size:13px;color:#4A4560;">
                  <strong style="color:#171326;">Reference:</strong> ${esc(id)}<br>
                  ${cleanSubject ? `<strong style="color:#171326;">Subject:</strong> ${esc(cleanSubject)}` : ""}
                </td></tr>
              </table>
              <p style="margin:0;">Just reply to this email if you have anything to add.</p>`,
            footnote: `You're receiving this because you contacted Aster support.`,
          }),
        });
      } catch (e) {
        console.error("support confirmation email failed", e); // non-fatal
      }
    }

    return json({ id });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
