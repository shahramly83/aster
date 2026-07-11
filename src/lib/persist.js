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
  return data?.token || null;
}

// Persist an offer sent to a candidate and return its public token, so the app
// can email the candidate a link to /offer/<token> to accept or decline.
export async function dbCreateOffer(companyId, { candidateId, jobId = null }) {
  if (!hasSupabase || !companyId || !candidateId) return null;
  const { data, error } = await supabase
    .from("offers")
    .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId, status: "sent" })
    .select("token")
    .single();
  if (error) { console.error("dbCreateOffer", error.message); return null; }
  return data?.token || null;
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

// Interviewer flags a candidate as ready for the hiring manager to schedule.
// Idempotent server-side: the first request per application wins. Returns an
// error message, or null on success.
export async function dbRequestScheduling(applicationId) {
  if (!hasSupabase || !applicationId) return "Not connected to a live workspace.";
  const { error } = await supabase.rpc("request_scheduling", { p_application_id: applicationId });
  if (!error) return null;
  console.error("dbRequestScheduling", error.message);
  if (error.code === "42501") return "You can only request interviews for jobs you're assigned to.";
  return error.message || "Couldn't send that request. Try again in a moment.";
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
  if (!hasSupabase || !companyId || !jobId || !results.length) return;
  await Promise.all(results.map(({ candidateId, score, rationale }) =>
    supabase.from("applications")
      .update({ match_score: Math.round((Number(score) || 0) * 100), match_reasons: rationale || null })
      .eq("company_id", companyId).eq("job_id", jobId).eq("candidate_id", candidateId)
      .then(({ error }) => { if (error) console.error("dbSaveMatchScores", error.message); })
  ));
}
