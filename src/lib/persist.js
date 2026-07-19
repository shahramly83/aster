// Customer write-through helpers. Each one persists a UI action to Supabase and
// is a no-op when Supabase isn't configured. The app keeps its optimistic
// session state either way, so these run alongside (not instead of) setState —
// callers gate them on a "workspace is live" check so demo ids never hit the DB.
import { supabase, hasSupabase } from "./supabase";

// Split a job form payload into the row's columns + its details jsonb.
// expires_at and status are real columns (status is 'open' | 'closed' | 'draft'),
// so they're lifted out of the details blob.
function splitJob(payload) {
  const { title, expires_at = null, status, ...details } = payload;
  return { title, expires_at, status, details };
}

export async function dbCreateJob(companyId, userId, payload) {
  if (!hasSupabase || !companyId) return null;
  const { title, expires_at, status, details } = splitJob(payload);
  const { data, error } = await supabase
    .from("jobs")
    .insert({ company_id: companyId, title, status: status || "open", created_by: userId || null, expires_at, details })
    .select("id")
    .single();
  // P0001 from trg_charge_job_post: the plan's job-posting credits are spent.
  // Surfaced rather than swallowed, or the form silently does nothing.
  if (error) {
    console.error("dbCreateJob", error.message);
    if (error.code === "P0001") return { error: "limit_reached" };
    return null;
  }
  return data.id;
}

// Persist a finished bulk-import run so the "Recent imports" log survives reloads.
// Stores the whole UI run object; returns it with the DB id (or null on failure).
export async function dbSaveImportRun(companyId, userId, run) {
  if (!hasSupabase || !companyId) return null;
  const { data, error } = await supabase
    .from("import_runs")
    .insert({ company_id: companyId, created_by: userId || null, file_count: run.fileCount || 0, run })
    .select("id, run")
    .single();
  if (error) { console.error("dbSaveImportRun", error.message); return null; }
  return { ...(data.run || {}), id: data.id };
}

// Update an existing import run in place (same DB row), so a duplicate resolution
// the user makes AFTER the batch finished persists across a reload instead of
// resetting to the default. Keyed by the row's DB id.
export async function dbUpdateImportRun(id, run) {
  if (!hasSupabase || !id) return null;
  const { data, error } = await supabase
    .from("import_runs")
    .update({ file_count: run.fileCount || 0, run })
    .eq("id", id)
    .select("id, run")
    .single();
  if (error) { console.error("dbUpdateImportRun", error.message); return null; }
  return { ...(data.run || {}), id: data.id };
}

// Load recent import runs for the company (newest first), mapped to UI run shape.
export async function dbListImportRuns(companyId, limit = 50) {
  if (!hasSupabase || !companyId) return [];
  const { data, error } = await supabase
    .from("import_runs")
    .select("id, run")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("dbListImportRuns", error.message); return []; }
  return (data || []).map((r) => ({ ...(r.run || {}), id: r.id }));
}

// Interviewer requests a new role. jobs RLS blocks their direct insert, so this
// goes through the request_job SECURITY DEFINER RPC, which saves it as a pending
// draft tagged with the requester. approvalStatus/requestedBy are set on the
// server (trusted), so strip them + status/expires from the details we send.
export async function dbRequestJob(payload) {
  if (!hasSupabase) return null;
  const { title, ...rest } = payload;
  delete rest.status; delete rest.expires_at; delete rest.approvalStatus; delete rest.requestedBy; delete rest.requestedByName;
  const { data, error } = await supabase.rpc("request_job", { p_title: title, p_details: rest });
  if (error) { console.error("dbRequestJob", error.message); return null; }
  // Email the hiring managers that a role needs review (best-effort; the request
  // is already filed, so a mail hiccup never blocks it).
  if (data) supabase.functions.invoke("notify-role-request", { body: { job_id: data, event: "requested" } }).catch(() => {});
  return data || null;
}

export async function dbUpdateJob(jobId, payload) {
  if (!hasSupabase) return;
  const { title, expires_at, status, details } = splitJob(payload);
  const row = { title, expires_at, details };
  if (status) row.status = status; // publish / save-as-draft can change it
  const { error } = await supabase.from("jobs").update(row).eq("id", jobId);
  if (error) console.error("dbUpdateJob", error.message);
}

export async function dbSetJobStatus(jobId, status) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  // P0001 = trg_charge_job_post refused: no job-post credits left this cycle.
  if (error) { console.error("dbSetJobStatus", error.message); return { error: error.code === "P0001" ? "limit_reached" : error.message }; }
  return { error: null };
}

// Delete a job outright. Callers restrict this to drafts (which have no
// applicants). Any applications/views cascade via FK.
export async function dbDeleteJob(jobId) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("jobs").delete().eq("id", jobId);
  if (error) console.error("dbDeleteJob", error.message);
}

// Reopening a closed role starts a fresh pipeline: remove its applications so the
// reopened role has zero applicants. The candidates themselves are untouched (they
// stay in the candidate database, searchable and reusable), only the job link
// (the application row) is deleted. RLS scopes it to the caller's company.
export async function dbClearJobApplicants(companyId, jobId) {
  if (!hasSupabase || !companyId || !jobId) return;
  const { error } = await supabase.from("applications").delete().eq("company_id", companyId).eq("job_id", jobId);
  if (error) console.error("dbClearJobApplicants", error.message);
}

// The app models pipeline stage per candidate (not per application), so a stage
// change updates every application that candidate has in this workspace.
export async function dbSetCandidateStage(companyId, candidateId, stage) {
  if (!hasSupabase || !companyId) return;
  const { error } = await supabase
    .from("applications")
    .update({ stage })
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId);
  if (error) console.error("dbSetCandidateStage", error.message);
}

// Delete a candidate. Applications, interviews and scorecards cascade via FK;
// a DB trigger prunes any now-unused industry from the company's taxonomy.
export async function dbDeleteCandidate(candidateId) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("candidates").delete().eq("id", candidateId);
  if (error) console.error("dbDeleteCandidate", error.message);
}

// Upload a company logo to the public `logos` bucket under the company's folder
// (logos/{companyId}/logo) and return its public URL. Upserts a fixed path so a
// replaced logo overwrites the old file instead of orphaning it. The ?v= query
// busts the CDN/browser cache when the logo changes at the same URL.
export async function uploadCompanyLogo(companyId, file) {
  if (!hasSupabase || !companyId || !file) return null;
  const path = `${companyId}/logo`;
  const { error } = await supabase.storage
    .from("logos")
    .upload(path, file, { upsert: true, contentType: file.type || "image/png" });
  if (error) { console.error("uploadCompanyLogo", error.message); return null; }
  const { data } = supabase.storage.from("logos").getPublicUrl(path);
  return data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : null;
}

// Persist company branding + billing details via the owner/admin-only RPC.
// Returns { ok, error? } so the settings form can surface a failure.
// Billing address is stored as five discrete columns (street/city/state/
// postcode/country); the RPC also derives the display-ready `address` block
// from them server-side, so callers pass the structured `address` object.
export async function dbUpdateCompany(companyId, { name, address = {}, registrationNo, logoUrl }) {
  if (!hasSupabase || !companyId) return { ok: false };
  const { error } = await supabase.rpc("update_company_details", {
    p_name: name ?? null,
    p_street: address.street ?? null,
    p_city: address.city ?? null,
    p_state: address.state ?? null,
    p_postcode: address.postcode ?? null,
    p_country: address.country ?? null,
    p_registration_no: registrationNo ?? null,
    p_logo_url: logoUrl ?? null,
  });
  if (error) { console.error("dbUpdateCompany", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Manager-only: the whole panel's shortlists for a job, keyed by application id
// (0099). Returns { [applicationId]: ["Rahim Ghazali", "Ivan Reviewer"] }. Admins
// only server-side; interviewers never see each other's picks.
export async function dbListJobShortlists(jobId) {
  if (!hasSupabase || !jobId) return {};
  const { data, error } = await supabase.rpc("get_job_shortlists", { p_job_id: jobId });
  if (error) { console.error("dbListJobShortlists", error.message); return {}; }
  const map = {};
  (data || []).forEach((r) => { (map[r.application_id] ||= []).push(r.name || "Interviewer"); });
  return map;
}

// Stamp a job as just AI-Ranked (0098), so the run locks for everyone until a new
// candidate applies. Server-gated to admins or an interviewer assigned to the job.
export async function dbStampJobRanked(jobId) {
  if (!hasSupabase || !jobId) return { ok: false };
  const { error } = await supabase.rpc("stamp_job_ranked", { p_job_id: jobId });
  if (error) { console.error("dbStampJobRanked", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Reset a reopened role's apply-page view analytics to zero (0096). Admin-gated
// server-side. Best-effort: a failure just leaves the old view count.
export async function dbClearJobViews(jobId) {
  if (!hasSupabase || !jobId) return { ok: false };
  const { error } = await supabase.rpc("clear_job_views", { p_job_id: jobId });
  if (error) { console.error("dbClearJobViews", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Persist the workspace's billing currency preference (0095). Owner-only, enforced
// server-side by set_company_currency. Governs fresh checkouts + credit top-ups.
export async function dbSetCompanyCurrency(currency) {
  if (!hasSupabase) return { ok: false };
  const { error } = await supabase.rpc("set_company_currency", { p_currency: currency });
  if (error) { console.error("dbSetCompanyCurrency", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Read this company's email-template overrides (Tier 2). Returns rows keyed by
// template `key`; an empty list means the app falls back to the code defaults.
export async function dbListEmailTemplates(companyId) {
  if (!hasSupabase || !companyId) return [];
  const { data, error } = await supabase
    .from("email_templates")
    .select("key, subject, body, enabled")
    .eq("scope", "company")
    .eq("company_id", companyId);
  if (error) { console.error("dbListEmailTemplates", error.message); return []; }
  return data || [];
}

// Upsert one company email-template override. RLS lets only owners/admins write,
// so a non-privileged user gets { ok:false, error }. Returns { ok, error? } so
// the editor can surface a failure banner.
export async function dbSaveEmailTemplate(companyId, key, { subject, body }) {
  if (!hasSupabase || !companyId) return { ok: false };
  const { error } = await supabase
    .from("email_templates")
    .upsert(
      { scope: "company", company_id: companyId, key, subject, body },
      { onConflict: "company_id,key" },
    );
  if (error) { console.error("dbSaveEmailTemplate", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Persist a pending interview invite (HR proposed times, awaiting the candidate)
// and return its public booking token. interviewer_id is left null: the
// scheduling roster is client-side and not necessarily real profiles, so the
// interviewer's name/email are denormalised for notifications instead.
export async function dbCreateInterviewInvite(companyId, { candidateId, jobId = null, interviewerName = null, interviewerEmail = null, proposedSlots = [], provider = "google", attendees = [] }) {
  if (!hasSupabase || !companyId || !candidateId) return null;
  const { data, error } = await supabase
    .from("interviews")
    .insert({
      company_id: companyId,
      candidate_id: candidateId,
      job_id: jobId,
      interviewer_name: interviewerName,
      interviewer_email: interviewerEmail,
      proposed_slots: proposedSlots,
      provider,
      status: "sent",
      attendees,
    })
    .select("token")
    .single();
  if (error) { console.error("dbCreateInterviewInvite", error.message); return null; }
  // Sending times (whether from a poll or set directly) moves them to "Interview".
  advanceToInterviewing(companyId, candidateId, jobId);
  return data?.token || null;
}

// Advance a candidate's pipeline stage to "interviewing" — forward-only, so it
// never regresses someone already at interviewing/offer/hired. Job-scoped when a
// job is known. Best-effort; a failure just leaves the stage where it was.
function advanceToInterviewing(companyId, candidateId, jobId) {
  if (!hasSupabase || !companyId || !candidateId) return;
  let q = supabase.from("applications").update({ stage: "interviewing" })
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .in("stage", ["applied", "shortlisted"]);
  if (jobId) q = q.eq("job_id", jobId);
  q.then(() => {}, () => {});
}

// Record which panel members actually attended the interview, by marking each
// attendee in the scheduled interview's attendees jsonb with an `attended` flag.
// The hiring manager sets this; it drives who owes a scorecard before a decision
// can be made. Best-effort: RLS (interviews_admin) allows owner/admin to update.
// Replace the whole interview panel (used when the hiring manager substitutes an
// interviewer who's dropped out). Writes the attendees jsonb of the candidate's
// scheduled interview. RLS (interviews_admin) allows owner/admin to update.
// Confirm a proposed interview to a chosen slot: flip the candidate's most recent
// 'sent' interview to 'scheduled' and stamp the time. Used when the interview is
// confirmed from inside the app (the public /book page uses the confirm-booking
// edge function instead). RLS (interviews_admin) allows owner/admin to update.
export async function dbConfirmBooking(companyId, candidateId, startIso) {
  if (!hasSupabase || !companyId || !candidateId || !startIso) return;
  const { data } = await supabase
    .from("interviews").select("id").eq("company_id", companyId).eq("candidate_id", candidateId).eq("status", "sent")
    .limit(1).maybeSingle();
  if (!data) return;
  const { error } = await supabase.from("interviews").update({ status: "scheduled", scheduled_at: startIso }).eq("id", data.id);
  if (error) console.error("dbConfirmBooking", error.message);
}

export async function dbSetInterviewAttendees(companyId, candidateId, attendees = []) {
  if (!hasSupabase || !companyId || !candidateId) return;
  const { data } = await supabase
    .from("interviews").select("id").eq("company_id", companyId).eq("candidate_id", candidateId).eq("status", "scheduled")
    .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return;
  const { error } = await supabase.from("interviews").update({ attendees }).eq("id", data.id);
  if (error) console.error("dbSetInterviewAttendees", error.message);
}

export async function dbSetAttendance(companyId, candidateId, attendedIds = []) {
  if (!hasSupabase || !companyId || !candidateId) return;
  const { data } = await supabase
    .from("interviews")
    .select("id, attendees")
    .eq("company_id", companyId).eq("candidate_id", candidateId).eq("status", "scheduled")
    .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return;
  const set = new Set(attendedIds);
  const attendees = (Array.isArray(data.attendees) ? data.attendees : []).map((a) => ({ ...a, attended: set.has(a.id) }));
  const { error } = await supabase.from("interviews").update({ attendees }).eq("id", data.id);
  if (error) console.error("dbSetAttendance", error.message);
}

// Persist an offer sent to a candidate and return its public token, so the app
// can email the candidate a link to /offer/<token> to accept or decline.
export async function dbCreateOffer(companyId, { candidateId, jobId = null, terms = null }) {
  if (!hasSupabase || !companyId || !candidateId) return null;
  const row = { company_id: companyId, candidate_id: candidateId, job_id: jobId, status: "sent" };
  if (terms) {
    // Only send the columns that exist (0103). A pre-0103 workspace ignores the
    // extra keys via the fallback insert below.
    if (terms.baseSalary != null && terms.baseSalary !== "") row.base_salary = Number(terms.baseSalary);
    if (terms.currency) row.salary_currency = terms.currency;
    if (terms.employmentType) row.employment_type = terms.employmentType;
    if (terms.startDate) row.start_date = terms.startDate;
    if (terms.expiresAt) row.expires_at = terms.expiresAt;
    if (terms.jobTitle) row.offer_job_title = terms.jobTitle;
    // Letter fields (0112): named signatory + optional prose details.
    if (terms.signatoryName) row.signatory_name = terms.signatoryName;
    if (terms.signatoryTitle) row.signatory_title = terms.signatoryTitle;
    if (terms.reportingTo) row.reporting_to = terms.reportingTo;
    if (terms.workLocation) row.work_location = terms.workLocation;
  }
  let { data, error } = await supabase.from("offers").insert(row).select("token").single();
  // 0103 not applied yet: retry with just the base columns so the offer still sends.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await supabase
      .from("offers")
      .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId, status: "sent" })
      .select("token").single());
  }
  if (error) { console.error("dbCreateOffer", error.message); return null; }
  return data?.token || null;
}

// Latest offer for a candidate (RLS scopes offers to the caller's company), so
// the candidate profile can show its status + e-sign state after a reload.
export async function dbGetOffer(companyId, candidateId) {
  if (!hasSupabase || !companyId || !candidateId) return null;
  const terms = "message, base_salary, salary_currency, employment_type, start_date, offer_job_title";
  const cols = `id, token, status, approval_status, esign_provider, esign_status, signed_pdf_path, expires_at, created_at, ${terms}`;
  let { data, error } = await supabase
    .from("offers")
    .select(cols)
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Pre-approval workspace (no approval_status column): retry without it.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await supabase
      .from("offers")
      .select(`id, token, status, esign_provider, esign_status, signed_pdf_path, expires_at, created_at, ${terms}`)
      .eq("company_id", companyId).eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle());
  }
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return null; // pre-esign columns
    console.error("dbGetOffer", error.message);
    return null;
  }
  return data || null;
}

// The approval sequence for an offer (RLS company-scoped), so the Decision panel
// can show who's approved / pending / declined and in what order.
export async function dbListOfferApprovals(offerId) {
  if (!hasSupabase || !offerId) return [];
  const { data, error } = await supabase
    .from("offer_approvals")
    .select("step, approver_email, approver_name, status, reason, decided_at")
    .eq("offer_id", offerId).order("step", { ascending: true });
  if (error) { if (error.code !== "42P01") console.error("dbListOfferApprovals", error.message); return []; }
  return data || [];
}

// Submit an offer for sequential approval (or resubmit after a decline). approvers
// is an ordered array of { email, name }. Returns true on success.
export async function dbSubmitApproval({ offerToken, approvers, message = null, terms = null, mode = null }) {
  if (!hasSupabase || !offerToken) return false;
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const { data, error } = await supabase.functions.invoke("offer-approval-submit", { body: { offerToken, approvers, message, terms, mode, origin } });
  if (error || data?.error) { console.error("dbSubmitApproval", data?.error || error?.message); return false; }
  return true;
}

// Close (withdraw) an offer that's in approval: delete it (approvals cascade).
export async function dbCloseOffer(offerId) {
  if (!hasSupabase || !offerId) return false;
  const { error } = await supabase.from("offers").delete().eq("id", offerId);
  if (error) { console.error("dbCloseOffer", error.message); return false; }
  return true;
}

// Decline + void an offer whose expiry date has passed (server-verified).
// Fire-and-forget from the UI; idempotent on the server.
export async function dbExpireOffer(candidateId) {
  if (!hasSupabase || !candidateId) return;
  const { error } = await supabase.functions.invoke("expire-offer", { body: { candidateId } });
  if (error) console.error("dbExpireOffer", error.message);
}

// Short-lived download URL for the signed offer PDF (private bucket, minted by
// the offer-signed-url edge function). Returns a URL string or null.
export async function dbSignedOfferUrl(candidateId) {
  if (!hasSupabase || !candidateId) return null;
  const { data, error } = await supabase.functions.invoke("offer-signed-url", { body: { candidateId } });
  if (error || !data?.url) { console.error("dbSignedOfferUrl", error?.message || "no url"); return null; }
  return data.url;
}

// The notification bell's authoritative feed (0106). Company-scoped by RLS.
export async function dbListActivity(companyId, limit = 60) {
  if (!hasSupabase || !companyId) return [];
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, type, title, description, candidate_id, job_id, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return []; // pre-0106
    console.error("dbListActivity", error.message);
    return [];
  }
  return data || [];
}

// Append an in-app event to the feed (fire-and-forget; company-gated server-side).
export async function dbLogActivity(type, title, { description = null, candidateId = null, jobId = null } = {}) {
  if (!hasSupabase || !type || !title) return;
  const { error } = await supabase.rpc("log_activity", {
    p_type: type, p_title: title, p_description: description, p_candidate_id: candidateId, p_job_id: jobId,
  });
  if (error && error.code !== "42883" && error.code !== "PGRST202") console.error("dbLogActivity", error.message);
}

export async function dbAddScorecard(companyId, userId, { candidateId, jobId = null, ratings, notes }) {
  if (!hasSupabase || !companyId) return;
  const { error } = await supabase.from("scorecards").insert({
    company_id: companyId,
    candidate_id: candidateId,
    job_id: jobId,
    interviewer_id: userId || null,
    ratings: ratings || {},
    notes: notes || null,
  });
  if (error) console.error("dbAddScorecard", error.message);
}

// Suspend a teammate: revokes their access on the next request (every tenancy
// helper re-checks profiles.status = 'active'), drops their job assignments, and
// keeps the row so scorecards and interviews they authored stay attached.
// Returns an error message, or null on success.
export async function dbRemoveTeammate(profileId) {
  if (!hasSupabase || !profileId) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("remove_teammate", { p_profile: profileId });
  if (!error) return null;
  console.error("dbRemoveTeammate", error.message);
  if (error.code === "42501") return "Only an owner or admin can remove a teammate.";
  if (error.code === "P0001") return error.message;   // self-removal, or sole owner
  if (error.code === "42883") return "Run migration 0043: remove_teammate doesn't exist yet.";
  return error.message || "Couldn't remove that teammate.";
}

// Job interviewer pool. A job_assignments row links an interviewer to a job so
// they can see its applicants (RLS-scoped) and request interviews. Admins see
// every job regardless; assignment only matters for interviewers.
export async function dbListJobAssignments(companyId) {
  if (!hasSupabase || !companyId) return [];
  const { data, error } = await supabase
    .from("job_assignments")
    .select("job_id, profile_id")
    .eq("company_id", companyId);
  if (error) { console.error("dbListJobAssignments", error.message); return []; }
  return data || [];
}

// Add a teammate to a job's interviewer pool. Admin-gated (assign_interviewer).
// Returns an error message, or null on success.
export async function dbAssignInterviewer(jobId, profileId) {
  if (!hasSupabase || !jobId || !profileId) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("assign_interviewer", { p_job_id: jobId, p_profile_id: profileId });
  if (!error) return null;
  console.error("dbAssignInterviewer", error.message);
  if (error.code === "42501") return "Only an owner or admin can assign interviewers.";
  if (error.code === "42883") return "Run migration 0021: assign_interviewer doesn't exist yet.";
  return error.message || "Couldn't add that interviewer.";
}

// Remove a teammate from a job's interviewer pool. Admin-gated.
export async function dbUnassignInterviewer(jobId, profileId) {
  if (!hasSupabase || !jobId || !profileId) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("unassign_interviewer", { p_job_id: jobId, p_profile_id: profileId });
  if (!error) return null;
  console.error("dbUnassignInterviewer", error.message);
  if (error.code === "42501") return "Only an owner or admin can change interviewers.";
  return error.message || "Couldn't remove that interviewer.";
}

// AI interview questions per candidate+job. Generated once by HR, read by the
// whole pool. Returns rows [{candidate_id, job_id, questions}].
export async function dbListInterviewQuestions(companyId) {
  if (!hasSupabase || !companyId) return [];
  const { data, error } = await supabase
    .from("interview_questions")
    .select("candidate_id, job_id, questions")
    .eq("company_id", companyId);
  if (error) { console.error("dbListInterviewQuestions", error.message); return []; }
  return data || [];
}

// Store the generated set. Generate-once: a duplicate (candidate, job) is
// ignored server-side by the unique constraint. Returns an error message or null.
export async function dbSaveInterviewQuestions(companyId, userId, { candidateId, jobId, questions }) {
  if (!hasSupabase || !companyId || !candidateId || !jobId) return "Not connected to a live workspace.";
  const { error } = await supabase
    .from("interview_questions")
    .upsert({ company_id: companyId, candidate_id: candidateId, job_id: jobId, questions: questions || [], generated_by: userId || null },
            { onConflict: "candidate_id,job_id", ignoreDuplicates: true });
  if (error) { console.error("dbSaveInterviewQuestions", error.message); return error.message || "Couldn't save the questions."; }
  return null;
}

// Interviewer flags a candidate as ready for the hiring manager to schedule.
// Idempotent server-side: the first request per application wins. Returns an
// error message, or null on success.
// The signed-in user's own candidate shortlist (application ids they've starred).
// RLS returns every pick for a manager, so we scope to the caller's own rows.
export async function dbListMyShortlist(companyId, userId) {
  if (!hasSupabase || !companyId || !userId) return [];
  const { data, error } = await supabase
    .from("candidate_shortlists").select("application_id")
    .eq("company_id", companyId).eq("profile_id", userId);
  if (error) { console.error("dbListMyShortlist", error.message); return []; }
  return (data || []).map((r) => r.application_id).filter(Boolean);
}

// Star / unstar a candidate for the signed-in user. profile_id must equal
// auth.uid() (RLS enforces it); passing userId here just satisfies the insert.
export async function dbSetShortlist(companyId, userId, applicationId, on) {
  if (!hasSupabase || !companyId || !userId || !applicationId) return;
  if (on) {
    const { error } = await supabase
      .from("candidate_shortlists")
      .upsert({ company_id: companyId, application_id: applicationId, profile_id: userId }, { onConflict: "application_id,profile_id" });
    if (error) console.error("dbSetShortlist add", error.message);
  } else {
    const { error } = await supabase
      .from("candidate_shortlists").delete()
      .eq("application_id", applicationId).eq("profile_id", userId);
    if (error) console.error("dbSetShortlist remove", error.message);
  }
}

export async function dbRequestScheduling(applicationId) {
  if (!hasSupabase || !applicationId) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("request_scheduling", { p_application_id: applicationId });
  if (error) {
    console.error("dbRequestScheduling", error.message);
    if (error.code === "42501") return "You can only request interviews for jobs you're assigned to.";
    return error.message || "Couldn't send that request. Try again in a moment.";
  }
  // Email the hiring managers so they know to set it up. Best-effort: the request
  // is already recorded, so a mail hiccup never blocks or fails it. The function
  // claims notified_at atomically, so re-requests don't double-email.
  supabase.functions.invoke("notify-scheduling-request", { body: { application_id: applicationId } }).catch(() => {});
  return null;
}

// Upload the signed-in user's avatar into the private, company-scoped bucket.
// Returns the storage path (not a URL) — reads go through a signed URL, because
// a teammate's headshot should not be world-readable the way a company logo is.
export async function uploadAvatar(companyId, userId, file) {
  if (!hasSupabase || !companyId || !userId || !file) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${companyId}/${userId}.${ext || "jpg"}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) { console.error("uploadAvatar", error.message); return null; }
  return path;
}

// A short-lived read URL for a private avatar path.
export async function signedAvatarUrl(path) {
  if (!hasSupabase || !path) return null;
  const { data, error } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  if (error) { console.error("signedAvatarUrl", error.message); return null; }
  return data?.signedUrl || null;
}

// Writes only the caller's own row, via a definer RPC with a fixed column list:
// profiles has no self-UPDATE policy, and adding one would expose `role`.
// Returns an error message, or null on success.
export async function dbUpdateMyProfile({ fullName, phone, avatarPath, notifyPrefs, calendarProvider } = {}) {
  if (!hasSupabase) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("update_my_profile", {
    p_full_name: fullName ?? null,
    p_phone: phone ?? null,
    p_avatar_path: avatarPath ?? null,
    p_notify_prefs: notifyPrefs ?? null,
    p_calendar_provider: calendarProvider ?? null,
  });
  if (!error) return null;
  console.error("dbUpdateMyProfile", error.message);
  if (error.code === "42883") return "Run migration 0044: update_my_profile doesn't exist yet.";
  return error.message || "Couldn't save your profile.";
}

// Persist an AI Rank run so the scores survive a reload. Nothing else in the
// codebase ever wrote applications.match_score — the loader read it, but no edge
// function or client path populated it, so the Applicants board always ranked on
// an empty set. `score` is 0..1 here and stored as 0..100, matching the column's
// int type and the loader's `match_score > 1 ? /100 : score` normalisation.
export async function dbSaveMatchScores(companyId, jobId, results = []) {
  // NOTE: no companyId guard here. The RPC resolves the company from the caller's
  // JWT, so it must run even when the caller (an interviewer) has no companyId prop
  // handy. Guarding on companyId used to silently skip the save for interviewers,
  // so their AI Rank locked the job but never persisted the scores.
  if (!hasSupabase || !jobId || !results.length) return { ok: false, error: "nothing to save" };
  // Route through the definer RPC (0098) so an assigned INTERVIEWER's run persists
  // too — applications RLS is read-only for them. Falls back to a direct update
  // (admins only) if the RPC isn't deployed yet.
  const p_scores = results.map(({ candidateId, score, rationale }) => ({
    candidate_id: candidateId, score: Math.round((Number(score) || 0) * 100), reasons: rationale || null,
  }));
  const { error } = await supabase.rpc("save_match_scores", { p_job_id: jobId, p_scores });
  if (error && (error.code === "42883" || error.code === "PGRST202")) {
    if (!companyId) return { ok: false, error: "save_match_scores RPC is missing (apply migration 0100)" };
    let firstErr = null;
    await Promise.all(results.map(({ candidateId, score, rationale }) =>
      supabase.from("applications")
        .update({ match_score: Math.round((Number(score) || 0) * 100), match_reasons: rationale || null })
        .eq("company_id", companyId).eq("job_id", jobId).eq("candidate_id", candidateId)
        .then(({ error: e }) => { if (e && !firstErr) firstErr = e.message; })
    ));
    return firstErr ? { ok: false, error: firstErr } : { ok: true };
  }
  if (error) { console.error("dbSaveMatchScores", error.message); return { ok: false, error: `${error.code || ""} ${error.message}`.trim() }; }
  return { ok: true };
}

// Persist a "Why this fit" (See Why) explanation on the application, so it
// survives reloads and AI Rank re-runs and doesn't cost another credit to
// re-view. Needs the applications.see_why column (migration 0066); a missing
// column just logs and no-ops.
export async function dbSaveSeeWhy(companyId, jobId, candidateId, text) {
  if (!hasSupabase || !companyId || !jobId || !candidateId) return;
  const { error } = await supabase.from("applications")
    .update({ see_why: text || null })
    .eq("company_id", companyId).eq("job_id", jobId).eq("candidate_id", candidateId);
  if (error) console.error("dbSaveSeeWhy", error.message);
}

// ---- Interview availability polls (web parity with the mobile app) ------------
// The hiring manager runs a panel poll (proposes a few time ranges); the assigned
// interviewers mark the ones they can make. A panelist counts as "voted" only
// once they've picked >=2 ranges, matching the propose-2 rule the candidate sees.

// Load the candidate's latest poll with its slots and votes, from the viewer's
// perspective (which slots they've marked). Returns null when there's no poll.
export async function dbGetPanelPoll(companyId, candidateId, myProfileId) {
  if (!hasSupabase || !companyId || !candidateId) return null;
  const { data: poll, error } = await supabase
    .from("interview_polls")
    .select("id, job_id, status, chosen_slot, created_by, proposed_by, created_at")
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("dbGetPanelPoll", error.message); return null; }
  if (!poll) return null;
  const [{ data: slots }, { data: votes }] = await Promise.all([
    supabase.from("interview_poll_slots").select("id, slot_ts, slot_end").eq("poll_id", poll.id).order("slot_ts", { ascending: true }),
    supabase.from("interview_poll_votes").select("slot_id, profile_id, voter_name").eq("poll_id", poll.id),
  ]);
  const bySlot = {};
  (votes || []).forEach((v) => { (bySlot[v.slot_id] ||= []).push(v); });
  const byProfile = {};
  (votes || []).forEach((v) => { byProfile[v.profile_id] = (byProfile[v.profile_id] || 0) + 1; });
  // Round-1 panel poll needs >=2 picks (overlap); a round-2 candidate poll only
  // offers a couple of set times, so marking even one counts as a vote.
  const need = poll.proposed_by === "candidate" ? 1 : 2;
  return {
    id: poll.id,
    jobId: poll.job_id,
    status: poll.status,
    chosenSlot: poll.chosen_slot,
    createdBy: poll.created_by,
    proposedBy: poll.proposed_by || "panel", // 'panel' (round 1) | 'candidate' (round 2)
    voterIds: Object.keys(byProfile).filter((id) => byProfile[id] >= need),
    slots: (slots || []).map((s) => {
      const vs = bySlot[s.id] || [];
      return {
        id: s.id, ts: s.slot_ts, end: s.slot_end || null,
        count: vs.length,
        voters: vs.map((v) => v.voter_name || "Teammate"),
        mine: vs.some((v) => v.profile_id === myProfileId),
      };
    }),
  };
}

// Create a panel poll from time ranges [{ start, end }] (ISO). Managers only.
export async function dbCreatePanelPoll({ companyId, candidateId, candidateName, jobId, createdBy, slots = [] }) {
  if (!hasSupabase) return { ok: false, error: "Not connected." };
  const clean = slots.filter((s) => s && s.start);
  if (clean.length < 3) return { ok: false, error: "Add at least three time ranges." };
  const { data: poll, error } = await supabase
    .from("interview_polls")
    .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId || null, created_by: createdBy })
    .select("id").single();
  if (error || !poll) return { ok: false, error: error?.message || "Couldn't create the poll." };
  const rows = clean.map((s) => ({ poll_id: poll.id, company_id: companyId, slot_ts: s.start, slot_end: s.end || null }));
  const { error: se } = await supabase.from("interview_poll_slots").insert(rows);
  if (se) return { ok: false, error: se.message };
  // Starting to coordinate an interview moves the candidate into "Interview".
  // Forward-only: never pull someone back from offer/hired/interviewing.
  advanceToInterviewing(companyId, candidateId, jobId);
  // Notify the panel (activity feed + push), best-effort — mirrors the mobile app.
  supabase.rpc("log_activity", {
    p_type: "interview_poll",
    p_title: `Interview availability poll · ${candidateName || "candidate"}`,
    p_description: `Mark the times you can make (${clean.length} options).`,
    p_candidate_id: candidateId,
    p_job_id: jobId || null,
  }).then(() => {}, () => {});
  supabase.functions.invoke("notify-poll", {
    body: { candidate_id: candidateId, job_id: jobId || null, candidate_name: candidateName || null },
  }).then(() => {}, () => {});
  return { ok: true, id: poll.id };
}

// Toggle the viewer's availability for one slot.
export async function dbTogglePollVote({ companyId, pollId, slotId, profileId, voterName, on }) {
  if (!hasSupabase) return "Not connected.";
  if (on) {
    const { error } = await supabase.from("interview_poll_votes")
      .insert({ poll_id: pollId, slot_id: slotId, company_id: companyId, profile_id: profileId, voter_name: voterName || null });
    if (error && error.code !== "23505") return error.message; // duplicate is fine
    return null;
  }
  const { error } = await supabase.from("interview_poll_votes")
    .delete().eq("slot_id", slotId).eq("profile_id", profileId);
  return error ? error.message : null;
}

// Close a poll, recording the chosen time.
export async function dbClosePanelPoll(pollId, chosenIso) {
  if (!hasSupabase) return "Not connected.";
  const { error } = await supabase.from("interview_polls")
    .update({ status: "closed", chosen_slot: chosenIso || null, closed_at: new Date().toISOString() })
    .eq("id", pollId);
  return error ? error.message : null;
}

// Open availability polls the signed-in user can act on — so interviewers see
// "polls that need your vote" without hunting inside candidate profiles. RLS
// scopes interviewers to their assigned roles. Excludes polls the user created
// (they don't vote on their own) and candidates whose interview is already out.
export async function dbListOpenPolls(companyId, userId) {
  if (!hasSupabase || !companyId) return [];
  const { data: polls, error } = await supabase
    .from("interview_polls")
    .select("id, candidate_id, job_id, created_by, proposed_by, created_at")
    .eq("company_id", companyId).eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) { console.error("dbListOpenPolls", error.message); return []; }
  let rows = (polls || []).filter((p) => p.created_by !== userId);
  if (!rows.length) return [];
  const allCandIds = [...new Set(rows.map((p) => p.candidate_id).filter(Boolean))];
  const { data: iv } = await supabase
    .from("interviews").select("candidate_id, status")
    .eq("company_id", companyId).in("status", ["scheduled", "sent"]).in("candidate_id", allCandIds);
  const settled = new Set((iv || []).map((s) => s.candidate_id));
  rows = rows.filter((p) => !settled.has(p.candidate_id));
  if (!rows.length) return [];
  const pollIds = rows.map((p) => p.id);
  const candIds = [...new Set(rows.map((p) => p.candidate_id).filter(Boolean))];
  const jobIds = [...new Set(rows.map((p) => p.job_id).filter(Boolean))];
  const [mv, cs, js] = await Promise.all([
    supabase.from("interview_poll_votes").select("poll_id, profile_id").eq("company_id", companyId).eq("profile_id", userId).in("poll_id", pollIds),
    candIds.length ? supabase.from("candidates").select("id, parsed, full_name").in("id", candIds) : Promise.resolve({ data: [] }),
    jobIds.length ? supabase.from("jobs").select("id, title").in("id", jobIds) : Promise.resolve({ data: [] }),
  ]);
  // A voter "voted" only once they've picked >=2 times (the propose-2 rule), so a
  // single stray tap doesn't clear the prompt.
  const myCounts = {};
  (mv.data || []).forEach((v) => { myCounts[v.poll_id] = (myCounts[v.poll_id] || 0) + 1; });
  const candById = Object.fromEntries((cs.data || []).map((c) => [c.id, c]));
  const jobTitle = Object.fromEntries((js.data || []).map((j) => [j.id, j.title]));
  return rows.map((p) => {
    const c = candById[p.candidate_id] || {};
    return {
      pollId: p.id,
      candidateId: p.candidate_id,
      jobId: p.job_id,
      candidateName: c.parsed?.name || c.full_name || "Candidate",
      jobTitle: jobTitle[p.job_id] || "Role",
      voted: (myCounts[p.id] || 0) >= (p.proposed_by === "candidate" ? 1 : 2),
    };
  });
}

// Reschedule a scheduled interview (e.g. a no-show): reset it to a fresh
// scheduling cycle so the HM can propose new times. Empty proposed_slots marks it
// HM-initiated (vs a candidate-proposed reschedule, which keeps the slots).
export async function dbRescheduleInterview(companyId, candidateId) {
  if (!hasSupabase || !companyId || !candidateId) return { ok: false, error: "Not connected." };
  const { data } = await supabase.from("interviews").select("id")
    .eq("company_id", companyId).eq("candidate_id", candidateId).eq("status", "scheduled")
    .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { ok: false, error: "No scheduled interview to reschedule." };
  const { error } = await supabase.from("interviews").update({
    status: "reschedule", scheduled_at: null, proposed_slots: [], meeting_link: null,
    reschedule_note: null, reschedule_at: new Date().toISOString(),
  }).eq("id", data.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// HM confirms a slot from a candidate-proposed (round 2) poll: the candidate
// already offered these times, so confirming reuses confirm-booking (schedules +
// emails the candidate + panel) via the interview token, then closes the poll.
export async function dbConfirmPollSlot({ token, pollId, startIso }) {
  if (!hasSupabase) return { ok: false, error: "Not connected." };
  if (!token) return { ok: false, error: "This interview can't be confirmed (no booking link)." };
  if (!startIso) return { ok: false, error: "Pick a time to confirm." };
  const { data, error } = await supabase.functions.invoke("confirm-booking", { body: { token, start: startIso } });
  if (error || data?.error) return { ok: false, error: data?.error || error?.message || "Couldn't confirm the time." };
  if (pollId) await dbClosePanelPoll(pollId, startIso).catch(() => {});
  return { ok: true };
}
