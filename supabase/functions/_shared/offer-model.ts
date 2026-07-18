// Shared: build the offer-letter model (company, candidate, job title, address,
// date) for an offer row, plus the rendered letter HTML. Used by the approval
// functions so the letter shown to approvers matches the signed letter.
import { buildLetterModel, letterHtml, type OfferRow, type LetterModel } from "./offer-letter.ts";
import { sendEmail, companyShell, button } from "./email.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export const OFFER_COLS =
  "id, company_id, candidate_id, status, approval_status, esign_status, base_salary, salary_currency, employment_type, start_date, expires_at, offer_job_title, message, signatory_name, signatory_title, reporting_to, work_location, created_at, token";

export type LetterContext = {
  model: LetterModel;
  companyName: string;
  logoUrl: string | null;
  candidateName: string;
  candEmail: string | null;
  jobTitle: string;
};

export async function loadLetterContext(admin: Admin, offer: Record<string, unknown>): Promise<LetterContext> {
  const companyId = offer.company_id as string;
  const { data: comp } = await admin.from("companies")
    .select("name, logo_url, address, address_street, address_city, address_state, address_postcode, address_country")
    .eq("id", companyId).maybeSingle();
  const companyName = comp?.name || "the hiring team";
  const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", offer.candidate_id).maybeSingle();
  const candidateName = cand?.full_name || "there";
  let jobTitle = (offer.offer_job_title as string) || "the role";
  if (!offer.offer_job_title) {
    const { data: app } = await admin.from("applications").select("jobs(title)")
      .eq("company_id", companyId).eq("candidate_id", offer.candidate_id)
      .order("created_at", { ascending: false }).limit(1);
    jobTitle = (app?.[0] as { jobs?: { title?: string } })?.jobs?.title || jobTitle;
  }
  const addressLine = [
    comp?.address_street || comp?.address, comp?.address_city,
    [comp?.address_state, comp?.address_postcode].filter(Boolean).join(" "), comp?.address_country,
  ].filter(Boolean).join(", ");
  const dateStr = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date((offer.created_at as string) || Date.now()));
  const model = buildLetterModel(offer as unknown as OfferRow, { companyName, candidateName, jobTitle, addressLine, dateStr });
  return { model, companyName, logoUrl: comp?.logo_url || null, candidateName, candEmail: cand?.email || null, jobTitle };
}

export { letterHtml };

// Email one approver the offer letter with a link to approve or decline.
export async function emailApprover(
  admin: Admin,
  offer: Record<string, unknown>,
  approval: { token: string; approver_email: string; approver_name?: string | null; step: number },
  total: number,
  base: string,
): Promise<boolean> {
  const ctx = await loadLetterContext(admin, offer);
  const link = `${base}/approve/${approval.token}`;
  const stepLine = total > 1 ? `<p style="margin:0 0 8px;color:#6b6b7b;font-size:13px;">Approval ${approval.step} of ${total}.</p>` : "";
  const letter = `<div style="border:1px solid #ECE7F5;border-radius:12px;padding:20px 22px;margin:14px 0 4px;background:#fff;">${letterHtml(ctx.model, ctx.logoUrl)}</div>`;
  const html = companyShell({
    companyName: ctx.companyName, logoUrl: ctx.logoUrl,
    heading: "Offer approval requested",
    preview: `Please review the offer for the ${ctx.jobTitle} role.`,
    bodyHtml: `${stepLine}<p style="margin:0 0 10px;">You've been asked to review and approve the following offer of employment for <strong>${ctx.candidateName}</strong> (${ctx.jobTitle}). Please review the letter below, then approve or decline.</p>${letter}${button("Review & respond", link)}`,
    signoff: false,
  });
  const r = await sendEmail({ to: approval.approver_email, subject: `Approve the ${ctx.jobTitle} offer for ${ctx.candidateName}`, html });
  return r.ok;
}
