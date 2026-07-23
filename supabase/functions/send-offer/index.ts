// Supabase Edge Function: send-offer
// ---------------------------------------------------------------------------
// After HR sends an offer (the app has inserted the offers row + token), this
// emails the candidate the offer with a link to /offer/<token> to accept or
// decline. Verifies the caller belongs to the offer's company. Best-effort send.
//
// Secrets: RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs, button } from "../_shared/email.ts";
import { pushToCompanyAdmins } from "../_shared/push.ts";

const SITE = "https://hireaster.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const CURRENCY_SYMBOL: Record<string, string> = { myr: "RM", usd: "$", sgd: "S$" };
const EMPLOYMENT_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };
function fmtDate(d: string | null): string {
  if (!d) return "";
  try { return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T00:00:00`)); } catch { return d; }
}
function fmtSalary(amount: number | null, currency: string | null): string {
  if (amount == null) return "";
  const sym = CURRENCY_SYMBOL[(currency || "myr").toLowerCase()] || "";
  try { return `${sym}${Number(amount).toLocaleString("en-US")}`; } catch { return `${sym}${amount}`; }
}
type OfferTerms = { base_salary: number | null; salary_currency: string | null; employment_type: string | null; start_date: string | null; expires_at: string | null };
function offerTermsHtml(o: OfferTerms, jobTitle: string): string {
  const rows: [string, string][] = [["Role", jobTitle]];
  const sal = fmtSalary(o.base_salary, o.salary_currency);
  if (sal) rows.push(["Base salary", sal]);
  if (o.employment_type) rows.push(["Employment type", EMPLOYMENT_LABEL[o.employment_type] || o.employment_type]);
  const sd = fmtDate(o.start_date);
  if (sd) rows.push(["Start date", sd]);
  const ed = fmtDate(o.expires_at);
  if (ed) rows.push(["Offer valid until", ed]);
  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 16px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B8699;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1523;font-weight:600;">${v}</td></tr>`
  ).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;border-collapse:collapse;">${trs}</table>`;
}

async function jobTitleFor(admin: { from: (t: string) => any }, companyId: string, candidateId: string): Promise<string> {
  const { data } = await admin.from("applications").select("created_at, jobs(title)")
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as { jobs?: { title?: string } })?.jobs?.title || "the role";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { token: offerToken } = await req.json();
    if (!offerToken) return json({ error: "token is required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "no company for this session" }, 403);

    const { data: offer } = await admin.from("offers")
      .select("company_id, candidate_id, base_salary, salary_currency, employment_type, start_date, expires_at, offer_job_title")
      .eq("token", offerToken).maybeSingle();
    if (!offer || offer.company_id !== companyId) return json({ error: "not found" }, 404);

    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
    if (!cand?.email) return json({ ok: true, skipped: "no_candidate_email" });

    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", companyId).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    const jobTitle = offer.offer_job_title || await jobTitleFor(admin, companyId, offer.candidate_id);

    const offerLink = `${SITE}/offer/${offerToken}`;
    const tpl = await loadTemplate(admin, "offer", companyId, {
      subject: "You've been selected for the {{job_title}} role",
      body: "Hi {{candidate_name}},\n\nCongratulations! Following your interview, we're delighted to offer you the {{job_title}} role at {{company_name}}. Open your offer to review the details and let us know your answer.",
    });
    const tokens = {
      candidate_name: cand.full_name || "there",
      job_title: jobTitle,
      company_name: companyName,
      hr_contact: `${companyName} HR`,
      offer_link: offerLink,
    };
    // The accept/decline link is a proper CTA button, not a raw URL in the prose.
    // The structured terms render as a small table between the note and the CTA.
    const bodyHtml = paragraphs(renderTemplate(tpl.body, tokens))
      + offerTermsHtml(offer as OfferTerms, jobTitle)
      + button("Review your offer", offerLink)
      + `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#8B8699;">If the button doesn't work, <a href="${offerLink}" style="color:#0B2AE0;text-decoration:underline;">open your offer here</a>.</p>`;
    await sendEmail({
      to: cand.email,
      subject: renderTemplate(tpl.subject, tokens),
      html: companyShell({
        companyName, logoUrl,
        heading: "You've received an offer",
        preview: `${companyName} has offered you the ${jobTitle} role.`,
        bodyHtml,
      }),
    });

    // Bell: a durable record so the event survives a dismissed push.
    await admin.from("activity_log").insert({
      company_id: companyId, type: "offer_sent",
      title: `Offer sent to ${cand.full_name || "a candidate"}`,
      description: `${jobTitle} · sent for review`,
      candidate_id: offer.candidate_id,
    });

    // Tell the rest of the team the offer went out, minus whoever sent it.
    // Best-effort; the offer email above is the real work.
    await pushToCompanyAdmins(admin, companyId, {
      title: "Offer sent",
      body: `${cand.full_name || "The candidate"} · ${jobTitle}`,
      data: { url: `aster://candidate/${offer.candidate_id}`, type: "offer_sent" },
    }, user.id);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
