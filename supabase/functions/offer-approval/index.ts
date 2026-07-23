// Supabase Edge Function: offer-approval  (PUBLIC — deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// The approver's page at /approve/<token>. Actions:
//   view    → returns the offer letter + who's approving + progress.
//   approve → records approval; emails the next approver, or (if last) sends the
//             offer to the candidate for signature and notifies the team.
//   decline → records a decline + reason; halts the chain and notifies the team
//             so the hiring manager can revise + resubmit, or close the offer.
// Sequential: an approver may only act on their turn (all earlier steps approved).
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs, button } from "../_shared/email.ts";
import { loadLetterContext, letterHtml, emailApprover, OFFER_COLS } from "../_shared/offer-model.ts";
import { pushToUser, pushToCompanyAdmins } from "../_shared/push.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function notifyTeam(admin: any, companyId: string, subject: string, heading: string, bodyHtml: string) {
  const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
  const { data: recips } = await admin.from("profiles").select("email")
    .eq("company_id", companyId).in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
  const to = (recips || []).map((r: { email: string }) => r.email).filter(Boolean);
  if (!to.length) return;
  await sendEmail({ to, subject, html: companyShell({ companyName: comp?.name || "Aster", logoUrl: comp?.logo_url || null, heading, bodyHtml, signoff: false }) }).catch((e) => console.error("notifyTeam", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = ["approve", "decline"].includes(body?.action) ? body.action : "view";
    const token = String(body?.token || "");
    if (!token) return json({ error: "token is required" }, 400);
    const base = (typeof body?.origin === "string" && body.origin.startsWith("http")) ? body.origin.replace(/\/$/, "") : "https://hireaster.com";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: appr } = await admin.from("offer_approvals").select("id, offer_id, company_id, step, approver_email, approver_name, status, reason").eq("token", token).maybeSingle();
    if (!appr) return json({ error: "not_found" }, 404);
    const { data: offer } = await admin.from("offers").select(OFFER_COLS).eq("id", appr.offer_id).maybeSingle();
    if (!offer) return json({ error: "not_found" }, 404);

    const { data: allSteps } = await admin.from("offer_approvals").select("step, status, approver_name, approver_email").eq("offer_id", appr.offer_id).order("step", { ascending: true });
    const total = allSteps?.length || 1;

    const ctx = await loadLetterContext(admin, offer);

    if (action === "view") {
      return json({
        ok: true, html: letterHtml(ctx.model, ctx.logoUrl),
        companyName: ctx.companyName, candidateName: ctx.candidateName, jobTitle: ctx.jobTitle,
        approverName: appr.approver_name, step: appr.step, total,
        status: appr.status, reason: appr.reason, offerApprovalStatus: offer.approval_status,
      });
    }

    // Act: must be this approver's live turn.
    if (appr.status !== "pending") return json({ error: "already_decided", status: appr.status });
    const priorNotApproved = (allSteps || []).some((s) => s.step < appr.step && s.status !== "approved");
    if (priorNotApproved) return json({ error: "not_your_turn" }, 409);

    if (action === "decline") {
      const reason = String(body?.reason || "").trim().slice(0, 2000);
      await admin.from("offer_approvals").update({ status: "declined", reason: reason || null, decided_at: new Date().toISOString() }).eq("id", appr.id);
      await admin.from("offers").update({ approval_status: "declined" }).eq("id", offer.id);
      await admin.from("activity_log").insert({ company_id: offer.company_id, type: "offer_approval_declined", title: `Offer approval declined for ${ctx.candidateName}`, description: `${appr.approver_name || appr.approver_email} declined the ${ctx.jobTitle} offer${reason ? `: ${reason}` : "."}`, candidate_id: offer.candidate_id });
      await notifyTeam(admin, offer.company_id, `Offer declined in approval: ${ctx.jobTitle}`, "Offer approval declined",
        `<p style="margin:0 0 8px;"><strong>${appr.approver_name || appr.approver_email}</strong> declined the offer for <strong>${ctx.candidateName}</strong> (${ctx.jobTitle}) at approval step ${appr.step} of ${total}.</p>${reason ? `<p style="margin:0 0 8px;">Reason: ${reason}</p>` : ""}<p style="margin:0;">Open Aster to revise and resubmit, or close the offer.</p>`);
      await pushToCompanyAdmins(admin, offer.company_id, {
        title: "Offer approval declined",
        body: `${appr.approver_name || appr.approver_email} declined ${ctx.candidateName}'s ${ctx.jobTitle} offer`,
        data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_approval" },
      });
      return json({ ok: true, result: "declined" });
    }

    // approve
    await admin.from("offer_approvals").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", appr.id);
    const next = (allSteps || []).find((s) => s.step === appr.step + 1);
    if (next) {
      const { data: nextRow } = await admin.from("offer_approvals").select("token, approver_email, approver_name, step").eq("offer_id", offer.id).eq("step", appr.step + 1).maybeSingle();
      if (nextRow) {
        await emailApprover(admin, offer, nextRow, total, base);
        try {
          const { data: np } = await admin.from("profiles").select("id").eq("company_id", offer.company_id).eq("status", "active").ilike("email", nextRow.approver_email).maybeSingle();
          if (np?.id) await pushToUser(admin, np.id, { title: "An offer needs your approval", body: `${ctx.candidateName} · ${ctx.jobTitle}`, data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_approval" } });
        } catch (e) { console.error("next approver push", e); }
      }
      await admin.from("activity_log").insert({ company_id: offer.company_id, type: "offer_approval_step", title: `Offer approval ${appr.step}/${total} for ${ctx.candidateName}`, description: `${appr.approver_name || appr.approver_email} approved. Sent to the next approver.`, candidate_id: offer.candidate_id });
      return json({ ok: true, result: "approved", next: true });
    }

    // Final approval → send the offer to the candidate for signature.
    await admin.from("offers").update({ approval_status: "approved", status: "sent", esign_provider: "aster", esign_status: "sent" }).eq("id", offer.id);
    if (ctx.candEmail) {
      const tpl = await loadTemplate(admin, "offer", offer.company_id, {
        subject: "Your offer from {{company_name}}",
        body: "You've received an offer for the {{job_title}} role at {{company_name}}. Review the terms and sign, it only takes a minute.",
      });
      const tokens = { candidate_name: ctx.candidateName, job_title: ctx.jobTitle, company_name: ctx.companyName };
      const signUrl = `${base}/offer/${offer.token}`;
      await sendEmail({ to: ctx.candEmail, subject: renderTemplate(tpl.subject, tokens), html: companyShell({ companyName: ctx.companyName, logoUrl: ctx.logoUrl, heading: "You've received an offer", preview: `Your offer for the ${ctx.jobTitle} role at ${ctx.companyName}.`, bodyHtml: `${paragraphs(renderTemplate(tpl.body, tokens))}${button("Review & sign", signUrl)}` }) }).catch((e) => console.error("candidate email", e));
    }
    await admin.from("activity_log").insert({ company_id: offer.company_id, type: "offer_approved", title: `Offer approved for ${ctx.candidateName}`, description: `All ${total} approvals complete. The offer was sent to ${ctx.candidateName} to sign.`, candidate_id: offer.candidate_id });
    await notifyTeam(admin, offer.company_id, `Offer approved and sent: ${ctx.jobTitle}`, "Offer fully approved",
      `<p style="margin:0;">All ${total} approvals are complete for <strong>${ctx.candidateName}</strong> (${ctx.jobTitle}). The offer has been sent to the candidate to review and sign.</p>`);
    await pushToCompanyAdmins(admin, offer.company_id, {
      title: "Offer approved & sent",
      body: `${ctx.candidateName}'s ${ctx.jobTitle} offer cleared approval and went to the candidate to sign.`,
      data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_approved" },
    });
    return json({ ok: true, result: "approved", next: false, sent: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
