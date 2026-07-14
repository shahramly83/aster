// Supabase Edge Function: support-reply
// ---------------------------------------------------------------------------
// An Aster admin (super or support role) replies to a support ticket. This
// function verifies the caller is an active admin with the right role, loads the
// ticket, emails the requester the reply, and optionally marks the ticket
// resolved. The admin console calls it from the Support queue.
//
// verify_jwt stays ON (default) so Supabase rejects unauthenticated calls; we
// additionally check the caller's admin_users row before doing anything.
//
// Secrets:  RESEND_API_KEY (required for the reply email)
// Auto-provided by Supabase:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, esc } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Turn a plain-text reply (with blank-line paragraphs) into safe HTML.
function paragraphs(text: string): string {
  return String(text).trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // --- Authenticate the caller from their bearer token ---
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    // Must be an active admin with a support-capable role.
    const { data: adminRow } = await admin
      .from("admin_users").select("role, status, full_name").eq("id", userData.user.id).maybeSingle();
    if (!adminRow || adminRow.status !== "active" || !["super", "support"].includes(adminRow.role)) {
      return json({ error: "forbidden" }, 403);
    }

    const { ticket_id, message, resolve } = await req.json();
    if (!ticket_id || !String(message || "").trim()) {
      return json({ error: "ticket_id and message are required" }, 400);
    }

    // --- Load the ticket (service role; admins have no RLS read on tickets) ---
    const { data: ticket } = await admin
      .from("support_tickets")
      .select("id, subject, requester_name, requester_email, status")
      .eq("id", ticket_id).maybeSingle();
    if (!ticket) return json({ error: "ticket not found" }, 404);
    if (!ticket.requester_email) return json({ error: "ticket has no requester email" }, 422);

    // --- Email the requester the reply ---
    const firstName = String(ticket.requester_name || "").trim().split(" ")[0] || "there";
    const cleanSubject = String(ticket.subject || "").replace(/^\[[^\]]+\]\s*/, "").trim();
    const emailRes = await sendEmail({
      to: ticket.requester_email,
      subject: `Re: ${cleanSubject || "your support request"} (${ticket.id})`,
      replyTo: "support@hireaster.com",
      html: emailShell({
        heading: "A reply from Aster support",
        preview: `Update on your request ${ticket.id}.`,
        bodyHtml: `
          <p style="margin:0 0 14px;">Hi ${esc(firstName)},</p>
          ${paragraphs(message)}
          <p style="margin:16px 0 0;color:#8B8699;font-size:13px;">Regarding request <strong style="color:#4A4560;">${esc(ticket.id)}</strong>${cleanSubject ? `, ${esc(cleanSubject)}` : ""}. Reply to this email to continue the conversation.</p>`,
        footnote: `${esc(adminRow.full_name || "Aster support")} · Aster support team`,
      }),
    });
    if (!emailRes.ok && !emailRes.skipped) {
      return json({ error: "email_failed", detail: emailRes.error }, 502);
    }

    // --- Optionally resolve the ticket ---
    let resolved = false;
    if (resolve) {
      const { error: updErr } = await admin
        .from("support_tickets").update({ status: "resolved" }).eq("id", ticket_id);
      resolved = !updErr;
    }

    return json({ ok: true, resolved, email_sent: emailRes.ok, email_skipped: !!emailRes.skipped });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
