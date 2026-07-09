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
  if (error) { console.error("dbCreateJob", error.message); return null; }
  return data.id;
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
  if (error) console.error("dbSetJobStatus", error.message);
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
export async function dbUpdateCompany(companyId, { name, address, registrationNo, logoUrl }) {
  if (!hasSupabase || !companyId) return { ok: false };
  const { error } = await supabase.rpc("update_company_details", {
    p_name: name ?? null,
    p_address: address ?? null,
    p_registration_no: registrationNo ?? null,
    p_logo_url: logoUrl ?? null,
  });
  if (error) { console.error("dbUpdateCompany", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
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
