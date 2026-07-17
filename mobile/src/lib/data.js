// The mobile data layer. Every read/write goes straight to the same Supabase
// tables the web app uses; RLS scopes rows to the interviewer. Shapes returned
// here match what the web app already renders so behaviour stays consistent.
import { supabase } from "./supabase";
import { recommendationFromRatings } from "@aster/shared";

const SIGNED_URL_TTL = 3600; // seconds

// ---- Interviews assigned to me -------------------------------------------------

// Upcoming + recent interviews where I am the interviewer, newest-relevant first.
// Returns enriched rows with candidate name, job title and resume/photo URLs.
export async function loadMyInterviews(companyId, userId) {
  const { data: ivs, error } = await supabase
    .from("interviews")
    .select("id, candidate_id, job_id, scheduled_at, status, provider, meeting_link, attendees")
    .eq("company_id", companyId)
    .eq("interviewer_id", userId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  const rows = ivs || [];
  if (!rows.length) return [];

  const candIds = [...new Set(rows.map((r) => r.candidate_id).filter(Boolean))];
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];

  const [cands, jobs] = await Promise.all([
    candIds.length
      ? supabase.from("candidates").select("id, parsed, full_name, photo_path, resume_path").in("id", candIds)
      : { data: [] },
    jobIds.length
      ? supabase.from("jobs").select("id, title").in("id", jobIds)
      : { data: [] },
  ]);

  const candById = Object.fromEntries((cands.data || []).map((c) => [c.id, c]));
  const jobTitle = Object.fromEntries((jobs.data || []).map((j) => [j.id, j.title]));

  // Mint signed URLs for any resumes/photos in one batch.
  const paths = [
    ...new Set((cands.data || []).flatMap((c) => [c.photo_path, c.resume_path]).filter(Boolean)),
  ];
  const urlByPath = await signedUrls(paths);

  return rows.map((iv) => {
    const c = candById[iv.candidate_id] || {};
    return {
      id: iv.id,
      candidateId: iv.candidate_id,
      jobId: iv.job_id,
      candidateName: c.parsed?.name || c.full_name || "Candidate",
      jobTitle: jobTitle[iv.job_id] || "Interview",
      scheduledAt: iv.scheduled_at,
      provider: iv.provider || "google",
      meetingLink: iv.meeting_link || null,
      avatarUrl: c.photo_path ? urlByPath[c.photo_path] || null : null,
      resumeUrl: c.resume_path ? urlByPath[c.resume_path] || null : null,
    };
  });
}

// Full detail for one candidate (parsed resume blob + signed URLs).
export async function loadCandidate(candidateId) {
  const { data } = await supabase
    .from("candidates")
    .select("id, parsed, full_name, email, file_name, has_photo, photo_path, resume_path")
    .eq("id", candidateId)
    .maybeSingle();
  if (!data) return null;
  const urlByPath = await signedUrls([data.photo_path, data.resume_path].filter(Boolean));
  return {
    id: data.id,
    name: data.parsed?.name || data.full_name || "Candidate",
    email: data.parsed?.email || data.email || null,
    parsed: data.parsed || null,
    fileName: data.file_name || "resume.pdf",
    avatarUrl: data.photo_path ? urlByPath[data.photo_path] || null : null,
    resumeUrl: data.resume_path ? urlByPath[data.resume_path] || null : null,
  };
}

// AI-generated interview questions for this candidate+role, if any were saved.
export async function loadInterviewQuestions(candidateId, jobId) {
  const q = supabase.from("interview_questions").select("questions").eq("candidate_id", candidateId);
  const { data } = jobId ? await q.eq("job_id", jobId).maybeSingle() : await q.maybeSingle();
  return Array.isArray(data?.questions) ? data.questions : [];
}

// ---- Scorecards ----------------------------------------------------------------

// All scorecards for a candidate (read is RLS-scoped to my assigned jobs).
export async function loadScorecards(candidateId) {
  const { data } = await supabase
    .from("scorecards")
    .select("id, interviewer_id, ratings, notes, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  return (data || []).map((s) => ({
    id: s.id,
    interviewerId: s.interviewer_id,
    ratings: s.ratings || {},
    notes: s.notes || "",
    recommendation: recommendationFromRatings(s.ratings),
    createdAt: s.created_at,
  }));
}

// Submit my scorecard. job_id is REQUIRED by the interviewer RLS insert policy
// (`job_id in assigned_job_ids()`), so callers must pass the interview's job.
export async function submitScorecard({ companyId, userId, candidateId, jobId, ratings, notes }) {
  if (!jobId) throw new Error("A job is required to submit a scorecard.");
  const { data, error } = await supabase
    .from("scorecards")
    .insert({
      company_id: companyId,
      interviewer_id: userId,
      candidate_id: candidateId,
      job_id: jobId,
      ratings,
      notes: notes || "",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

// ---- Open positions + applicants ----------------------------------------------

// Jobs I'm assigned to, with a light applicant count.
export async function loadOpenPositions(companyId, assignedJobIds) {
  if (!assignedJobIds.length) return [];
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, status, details, created_at")
    .eq("company_id", companyId)
    .in("id", assignedJobIds)
    .order("created_at", { ascending: false });
  return (jobs || []).map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    location: j.details?.location || j.details?.city || "",
    postedAt: j.created_at,
  }));
}

// Applicants for one job, with stage and AI match score.
export async function loadApplicants(companyId, jobId) {
  const { data: apps } = await supabase
    .from("applications")
    .select("id, candidate_id, stage, match_score, created_at")
    .eq("company_id", companyId)
    .eq("job_id", jobId)
    .order("match_score", { ascending: false, nullsFirst: false });
  const rows = apps || [];
  if (!rows.length) return [];

  const candIds = [...new Set(rows.map((r) => r.candidate_id))];
  const { data: cands } = await supabase
    .from("candidates")
    .select("id, parsed, full_name, photo_path")
    .in("id", candIds);
  const candById = Object.fromEntries((cands || []).map((c) => [c.id, c]));
  const urlByPath = await signedUrls((cands || []).map((c) => c.photo_path).filter(Boolean));

  return rows.map((a) => {
    const c = candById[a.candidate_id] || {};
    return {
      applicationId: a.id,
      candidateId: a.candidate_id,
      name: c.parsed?.name || c.full_name || "Candidate",
      stage: a.stage || "applied",
      matchScore: typeof a.match_score === "number" ? a.match_score : null,
      avatarUrl: c.photo_path ? urlByPath[c.photo_path] || null : null,
    };
  });
}

// Move an applicant to a new pipeline stage. RLS lets interviewers update stage
// only on their assigned jobs' applications.
export async function setApplicantStage(applicationId, stage) {
  const { error } = await supabase.from("applications").update({ stage }).eq("id", applicationId);
  if (error) throw error;
}

// ---- helpers -------------------------------------------------------------------

async function signedUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.storage.from("resumes").createSignedUrls(unique, SIGNED_URL_TTL);
  const out = {};
  (data || []).forEach((s) => {
    if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
  });
  return out;
}
