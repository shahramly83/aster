// Supabase Edge Function: offer-approval-submit
// ---------------------------------------------------------------------------
// The hiring manager submits an offer for sequential internal approval. Given an
// offer token + an ordered list of approver emails, it (re)creates the approval
// sequence, marks the offer pending approval (draft, not yet sent to the
// candidate), and emails the FIRST approver the offer letter with a link to
// approve or decline. Used for the initial submit and for resubmit after a
// decline. Verifies the caller belongs to the offer's company.
//
// Secrets: RESEND_API_KEY. Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailApprover, OFFER_COLS } from "../_shared/offer-model.ts";
import { pushToUser } from "../_shared/push.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { offerToken, approvers, message, origin, mode, terms } = await req.json();
    if (!offerToken) return json({ error: "offerToken is required" }, 400);
    const resume = mode === "resume";   // resubmit: keep already-approved steps, resume at the decliner

    const clean = (Array.isArray(approvers) ? approvers : [])
      .map((a: { email?: string; name?: string }) => ({ email: String(a?.email || "").trim().toLowerCase(), name: (a?.name || "").trim() || null }))
      .filter((a) => emailOk(a.email));
    if (!clean.length) return json({ error: "no valid approver emails" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(auth);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers").select(OFFER_COLS).eq("token", offerToken).maybeSingle();
    if (!offer || offer.company_id !== companyId) return json({ error: "not found" }, 404);

    // On resubmit, keep the steps that already approved so those approvers are not
    // asked again; the chain resumes at the first non-approved (the decliner).
    const approvedBy = new Map<string, string | null>();
    if (resume) {
      const { data: existing } = await admin.from("offer_approvals").select("approver_email, status, decided_at").eq("offer_id", offer.id);
      for (const rrow of existing || []) {
        if (rrow.status === "approved") approvedBy.set(String(rrow.approver_email).toLowerCase(), rrow.decided_at ?? null);
      }
    }

    // Persist the composed letter body + edited terms; mark pending approval
    // (draft: not yet sent to the candidate). Then rebuild the approval chain.
    const note = (typeof message === "string" && message.trim()) ? message.trim().slice(0, 20000) : null;
    const t = terms && typeof terms === "object" ? terms : null;
    const termCols = t ? {
      ...(t.jobTitle !== undefined ? { offer_job_title: t.jobTitle || null } : {}),
      ...(t.baseSalary !== undefined ? { base_salary: t.baseSalary === "" || t.baseSalary == null ? null : t.baseSalary } : {}),
      ...(t.currency !== undefined ? { salary_currency: t.currency || null } : {}),
      ...(t.employmentType !== undefined ? { employment_type: t.employmentType || null } : {}),
      ...(t.startDate !== undefined ? { start_date: t.startDate || null } : {}),
      ...(t.expiresAt !== undefined ? { expires_at: t.expiresAt || null } : {}),
    } : {};
    await admin.from("offers").update({
      approval_status: "pending", status: "draft", ...(note != null ? { message: note } : {}), ...termCols,
    }).eq("id", offer.id);
    await admin.from("offer_approvals").delete().eq("offer_id", offer.id);

    const rows = clean.map((a, i) => {
      const keep = resume && approvedBy.has(a.email);
      return {
        offer_id: offer.id, company_id: companyId, step: i + 1, approver_email: a.email, approver_name: a.name,
        status: keep ? "approved" : "pending", decided_at: keep ? approvedBy.get(a.email) : null,
      };
    });
    const { data: inserted, error: insErr } = await admin.from("offer_approvals").insert(rows).select("token, approver_email, approver_name, step, status");
    if (insErr || !inserted?.length) { console.error("insert approvals", insErr?.message); return json({ error: "could_not_create" }, 500); }

    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin.replace(/\/$/, "") : "https://hireaster.com";
    const ordered = inserted.sort((a: { step: number }, b: { step: number }) => a.step - b.step);
    // Email the first approver whose turn is live (skips any carried-over approvals).
    const target = ordered.find((r: { status: string }) => r.status !== "approved") || ordered[0];
    const sent = await emailApprover(admin, { ...offer, message: note ?? offer.message }, target, inserted.length, base);
    if (!sent) console.error("approver email failed for", target.approver_email);

    // Push the approver too, but only if their email belongs to an app account:
    // approvers are free-typed and can be external (a CFO who never opens Aster),
    // so email stays the guaranteed channel and push is a bonus for teammates.
    try {
      const { data: prof } = await admin.from("profiles")
        .select("id").eq("company_id", companyId).eq("status", "active")
        .ilike("email", target.approver_email).maybeSingle();
      if (prof?.id) {
        const { data: cand } = await admin.from("candidates").select("full_name").eq("id", offer.candidate_id).maybeSingle();
        await pushToUser(admin, prof.id, {
          title: "An offer needs your approval",
          body: `${cand?.full_name || "A candidate"} · ${offer.offer_job_title || "the role"}`,
          data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_approval" },
        });
      }
    } catch (e) { console.error("approver push failed", e); }

    return json({ ok: true, total: inserted.length, resumedAt: target.step });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error", detail: String((e as Error)?.message || e) }, 500);
  }
});
