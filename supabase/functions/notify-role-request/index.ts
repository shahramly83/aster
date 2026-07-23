// Supabase Edge Function: notify-role-request
// ---------------------------------------------------------------------------
// The interviewer role-request flow, by email (Aster-branded):
//   event "requested"            -> email the workspace's hiring managers (owner
//                                   + admins) that a new role needs review.
//   event "approved"/"rejected"  -> email the interviewer who requested it with
//                                   the hiring manager's decision.
//
// Called best-effort right after request_job / the approve-reject action, so a
// mail hiccup never blocks the request itself.
//
// Secrets: RESEND_API_KEY (optional — the send is skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, button, renderTemplate, paragraphs } from "../_shared/email.ts";
import { pushToUser, pushToCompanyAdmins } from "../_shared/push.ts";

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

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { job_id, event } = await req.json();
    if (!job_id || !["requested", "approved", "rejected"].includes(event)) {
      return json({ error: "job_id and a valid event are required" }, 400);
    }

    // Scope everything to the caller's own company.
    const { data: caller } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = caller?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: job } = await admin
      .from("jobs").select("title, created_by, company_id, details").eq("id", job_id).maybeSingle();
    if (!job || job.company_id !== companyId) return json({ error: "job not found" }, 404);

    const { data: comp } = await admin.from("companies").select("name, slug").eq("id", companyId).maybeSingle();
    const origin = comp?.slug ? `https://${comp.slug}.hireaster.com` : "https://hireaster.com";
    const details = (job.details || {}) as { requestedByName?: string };
    const roleTitle = job.title || "a role";

    if (event === "requested") {
      // Notify the hiring managers (owner + admins).
      const { data: recips } = await admin
        .from("profiles").select("email").eq("company_id", companyId)
        .in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
      const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
      if (!to.length) return json({ ok: true, skipped: "no_recipient" });

      const requesterName = details.requestedByName || "A teammate";
      const tokens = { requester_name: requesterName, job_title: roleTitle };
      await sendEmail({
        to,
        subject: renderTemplate("{{requester_name}} requested a new role: {{job_title}}", tokens),
        html: emailShell({
          heading: "New role requested",
          preview: `${requesterName} asked to open ${roleTitle}.`,
          bodyHtml: paragraphs(renderTemplate(
            "{{requester_name}} asked to open a new role, {{job_title}}.\n\nReview it and approve to publish, or decline, from your Jobs page. Approving opens the apply link right away.",
            tokens,
          )) + button("Review the request", `${origin}/jobs`),
          footnote: "You're getting this because you manage hiring for this workspace on Aster.",
        }),
      });
      await admin.from("activity_log").insert({
        company_id: companyId, type: "role_requested",
        title: `${requesterName} requested a new role`,
        description: roleTitle,
        job_id,
        actor_id: user.id,
      });
      await pushToCompanyAdmins(admin, companyId, {
        title: "New role to review",
        body: `${requesterName} asked to open ${roleTitle}`,
        data: { url: "aster://positions", type: "role_requested" },
      }, job.created_by || undefined);
      return json({ ok: true });
    }

    // Decision: notify the interviewer who requested the role.
    if (!job.created_by) return json({ ok: true, skipped: "no_requester" });
    const { data: requester } = await admin
      .from("profiles").select("email, full_name").eq("id", job.created_by).maybeSingle();
    const to = requester?.email;
    if (!to) return json({ ok: true, skipped: "no_recipient" });

    const firstName = (requester?.full_name || "there").split(" ")[0] || "there";
    const tokens = { recipient_name: firstName, job_title: roleTitle };
    const approved = event === "approved";
    await sendEmail({
      to,
      subject: renderTemplate(
        approved ? "Your role request was approved: {{job_title}}" : "Update on your role request: {{job_title}}",
        tokens,
      ),
      html: emailShell({
        heading: approved ? "Role request approved" : "Role request update",
        preview: approved ? `${roleTitle} was approved.` : `A decision on ${roleTitle}.`,
        bodyHtml: paragraphs(renderTemplate(
          approved
            ? "Hi {{recipient_name}},\n\nGood news. Your request to open {{job_title}} was approved and the role is now live, so applicants can start coming in. You'll find it under Open Roles, with its candidates ready to review."
            : "Hi {{recipient_name}},\n\nThanks for flagging {{job_title}}. Your hiring manager decided not to open this role for now. If you think it's worth another look, have a quick chat with them.",
          tokens,
        )) + button("Open your roles", `${origin}/open-roles`),
        footnote: "You're getting this because you requested a role on Aster.",
      }),
    });
    await pushToUser(admin, job.created_by, approved
      ? { title: "Role approved", body: `${roleTitle} is now open. Applicants can start coming in.`, data: { url: "aster://positions", type: "role_requested" } }
      : { title: "Role request update", body: `A decision was made on ${roleTitle}.`, data: { url: "aster://positions", type: "role_requested" } });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
