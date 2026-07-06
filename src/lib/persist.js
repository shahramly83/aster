// Customer write-through helpers. Each one persists a UI action to Supabase and
// is a no-op when Supabase isn't configured. The app keeps its optimistic
// session state either way, so these run alongside (not instead of) setState —
// callers gate them on a "workspace is live" check so demo ids never hit the DB.
import { supabase, hasSupabase } from "./supabase";

// Split a job form payload into the row's columns + its details jsonb.
// expires_at is a real column (used to stop intake once a posting closes), so
// it's lifted out of the details blob.
function splitJob(payload) {
  const { title, expires_at = null, ...details } = payload;
  return { title, expires_at, details };
}

export async function dbCreateJob(companyId, userId, payload) {
  if (!hasSupabase || !companyId) return null;
  const { title, expires_at, details } = splitJob(payload);
  const { data, error } = await supabase
    .from("jobs")
    .insert({ company_id: companyId, title, status: "open", created_by: userId || null, expires_at, details })
    .select("id")
    .single();
  if (error) { console.error("dbCreateJob", error.message); return null; }
  return data.id;
}

export async function dbUpdateJob(jobId, payload) {
  if (!hasSupabase) return;
  const { title, expires_at, details } = splitJob(payload);
  const { error } = await supabase.from("jobs").update({ title, expires_at, details }).eq("id", jobId);
  if (error) console.error("dbUpdateJob", error.message);
}

export async function dbSetJobStatus(jobId, status) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) console.error("dbSetJobStatus", error.message);
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
