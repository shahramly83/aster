// The mobile data layer. Every read/write goes straight to the same Supabase
// tables the web app uses; RLS scopes rows to the interviewer. Shapes returned
// here match what the web app already renders so behaviour stays consistent.
import { supabase } from "./supabase";
import { recommendationFromRatings, planLimits } from "@aster/shared";

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

// The candidate's next scheduled interview time (if any), for the profile.
export async function loadCandidateInterview(companyId, candidateId) {
  const { data } = await supabase
    .from("interviews")
    .select("scheduled_at")
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.scheduled_at || null;
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

// Roles for the Positions screen, with live per-stage counts.
// - Managers (admin/owner/recruiter) see EVERY role in the company.
// - Interviewers see only the roles they're on the panel for (assignedJobIds).
// RLS enforces the same boundary server-side; this just scopes the query.
export async function loadOpenPositions(companyId, { manager = false, assignedJobIds = [] } = {}) {
  let q = supabase
    .from("jobs")
    .select("id, title, status, details, created_at, ai_ranked_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (!manager) {
    if (!assignedJobIds.length) return [];
    q = q.in("id", assignedJobIds);
  }
  const { data: jobs } = await q;
  const rows = jobs || [];
  if (!rows.length) return [];

  // Per-job stage counts in one query, so each card can show a pipeline bar.
  const jobIds = rows.map((j) => j.id);
  const { data: apps } = await supabase
    .from("applications")
    .select("job_id, stage")
    .eq("company_id", companyId)
    .in("job_id", jobIds);
  const countsByJob = {};
  (apps || []).forEach((a) => {
    (countsByJob[a.job_id] ||= {});
    const s = a.stage || "applied";
    countsByJob[a.job_id][s] = (countsByJob[a.job_id][s] || 0) + 1;
  });

  return rows.map((j) => {
    const counts = countsByJob[j.id] || {};
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return {
      id: j.id,
      title: j.title,
      status: j.status,
      location: j.details?.location || j.details?.city || "",
      postedAt: j.created_at,
      aiRankedAt: j.ai_ranked_at || null,
      counts,
      applicantCount: total,
    };
  });
}

// Advanced analytics for the manager dashboard. Computes conversion/rate metrics
// and a composite pipeline-health score from the applications table. Rates are
// based on current pipeline composition (we store the current stage per
// candidate), so they describe the live funnel, not historical progression.
export async function loadAnalytics(companyId) {
  const { data: apps } = await supabase
    .from("applications")
    .select("stage, created_at")
    .eq("company_id", companyId);
  const rows = apps || [];
  const c = { applied: 0, shortlisted: 0, interviewing: 0, offer: 0, hired: 0, rejected: 0, declined: 0 };
  let newThisWeek = 0;
  const weekAgo = Date.now() - 7 * 86400000;
  rows.forEach((a) => {
    const s = a.stage || "applied";
    if (c[s] != null) c[s] += 1;
    if (a.created_at && new Date(a.created_at).getTime() >= weekAgo) newThisWeek += 1;
  });
  const total = rows.length;
  const offered = c.offer + c.hired + c.declined;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

  const advanced = pct(c.shortlisted + c.interviewing + c.offer + c.hired, total);
  const interview = pct(c.interviewing + c.offer + c.hired, total);
  const offerAccept = pct(c.hired, offered);
  const hireRate = pct(c.hired, total);

  // Composite health: transparent weighted blend of the rates shown below.
  const health = total === 0 ? 0 : Math.round(advanced * 0.3 + interview * 0.35 + offerAccept * 0.35);

  const { count: openRoles } = await supabase
    .from("jobs").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "open");

  return {
    total,
    counts: c,
    newThisWeek,
    openRoles: openRoles || 0,
    awaitingDecision: c.interviewing + c.offer,
    health,
    metrics: [
      { key: "advanced", label: "Advanced", desc: "past the applied stage", pct: advanced, tone: "#A9B8FF" },
      { key: "interview", label: "In interview", desc: "reached interview or beyond", pct: interview, tone: "#FFFFFF" },
      { key: "offerAccept", label: "Offer acceptance", desc: offered ? "of candidates offered" : "no offers yet", pct: offerAccept, tone: "#7DE2A8" },
      { key: "hire", label: "Hire rate", desc: "of all applicants", pct: hireRate, tone: "#FFD27D" },
    ],
  };
}

// Live dashboard updates: subscribe to changes on the tables the dashboard reads
// (applications, jobs, activity_log) for this company and call onChange on any
// event. Returns an unsubscribe fn. Requires realtime enabled on those tables
// (migration 0110); where it isn't, the dashboard's polling fallback covers it.
//
// Each call gets a UNIQUE channel topic. Supabase reuses the channel instance
// when a topic name repeats, and you can't add postgres_changes handlers to an
// already-subscribed channel — so several screens subscribing at once (dashboard
// + the auto-refresh hook) would otherwise collide.
let _dashChanSeq = 0;
export function subscribeDashboard(companyId, onChange) {
  const channel = supabase
    .channel(`dashboard:${companyId}:${++_dashChanSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: `company_id=eq.${companyId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `company_id=eq.${companyId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `company_id=eq.${companyId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Top applicant sources for the dashboard. Counts applications by their `source`
// channel (LinkedIn, career page, referral, job boards…) and returns the ranked
// breakdown with shares. Remaining channels roll up into "Other".
export async function loadTopSources(companyId, limit = 5) {
  const { data } = await supabase
    .from("applications")
    .select("source")
    .eq("company_id", companyId);
  const rows = data || [];
  const counts = {};
  rows.forEach((a) => {
    const s = (a.source && String(a.source).trim()) || "Direct";
    counts[s] = (counts[s] || 0) + 1;
  });
  const total = rows.length;
  const share = (n) => (total ? Math.round((n / total) * 100) : 0);
  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count, pct: share(count) }))
    .sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) {
    const c = rest.reduce((s, r) => s + r.count, 0);
    top.push({ name: "Other", count: c, pct: share(c), other: true });
  }
  return { total, sources: top };
}

// AI credit metering for the dashboard. Pulls this cycle's usage for each AI
// feature (same RPCs the web billing meter uses) and pairs it with the plan's
// monthly allowance so we can show remaining credits. Each RPC is company-scoped
// server-side (security definer), so no args are needed.
export async function loadCredits(plan) {
  const lim = planLimits(plan);
  const call = async (fn) => {
    try {
      const { data } = await supabase.rpc(fn);
      const r = Array.isArray(data) ? data[0] : data;
      return { used: Number(r?.used) || 0, resetsAt: r?.resets_at || null, limit: r?.monthly_limit ?? null };
    } catch {
      return { used: 0, resetsAt: null, limit: null };
    }
  };
  const [rank, insight, iq, appl] = await Promise.all([
    call("get_ai_rank_usage"),
    call("get_ai_insight_usage"),
    call("get_interview_q_usage"),
    call("get_applicant_parse_usage"),
  ]);

  const mk = (key, label, icon, color, u, planLimit) => {
    const limit = u.limit ?? planLimit;
    const unlimited = !isFinite(limit);
    const remaining = unlimited ? Infinity : Math.max(0, limit - u.used);
    const pct = unlimited ? 100 : limit > 0 ? Math.round((remaining / limit) * 100) : 0;
    return { key, label, icon, color, used: u.used, limit, unlimited, remaining, pct };
  };

  return {
    resetsAt: rank.resetsAt || insight.resetsAt || iq.resetsAt || appl.resetsAt || null,
    items: [
      mk("rank", "AI Rank", "zap", "#7DE2A8", rank, lim.aiRunsPerMonth),
      mk("insight", "AI Insights", "activity", "#A9B8FF", insight, lim.aiInsightsPerMonth),
      mk("iq", "Interview Q's", "help-circle", "#FFD27D", iq, lim.interviewQuestionsPerMonth),
      mk("screen", "Screening", "user-check", "#FFFFFF", appl, lim.parseApplicant),
    ],
  };
}

// Recent hiring activity for the dashboard feed. Reads the company's activity
// log (new applicants, scorecards, interviews, offers, hires), newest first.
export async function loadRecentActivity(companyId, limit = 8) {
  const { data } = await supabase
    .from("activity_log")
    .select("id, type, title, description, candidate_id, job_id, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data || []).map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    candidateId: a.candidate_id,
    jobId: a.job_id,
    createdAt: a.created_at,
  }));
}

// Company-wide pipeline summary for the manager dashboard: total per stage plus
// a few headline numbers. One lightweight query over applications.
export async function loadPipelineSummary(companyId) {
  const { data: apps } = await supabase
    .from("applications")
    .select("stage, created_at")
    .eq("company_id", companyId);
  const rows = apps || [];
  const byStage = {};
  let newThisWeek = 0;
  const weekAgo = Date.now() - 7 * 86400000;
  rows.forEach((a) => {
    const s = a.stage || "applied";
    byStage[s] = (byStage[s] || 0) + 1;
    if (a.created_at && new Date(a.created_at).getTime() >= weekAgo) newThisWeek += 1;
  });
  const { count: openRoles } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "open");
  return {
    total: rows.length,
    byStage,
    newThisWeek,
    openRoles: openRoles || 0,
    // "Needs action": people sitting in interviewing/offer waiting on a decision.
    awaitingDecision: (byStage.interviewing || 0) + (byStage.offer || 0),
  };
}

// Applicants for one job, with stage and AI match score.
export async function loadApplicants(companyId, jobId) {
  const { data: apps } = await supabase
    .from("applications")
    .select("id, candidate_id, stage, match_score, fit, created_at")
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
    const p = c.parsed || {};
    return {
      applicationId: a.id,
      candidateId: a.candidate_id,
      name: p.name || c.full_name || "Candidate",
      title: p.currentTitle || p.headline || (Array.isArray(p.experience) && p.experience[0]?.title) || null,
      location: p.location || null,
      skills: Array.isArray(p.skills) ? p.skills.slice(0, 3) : [],
      years: typeof p.years_of_experience === "number" ? p.years_of_experience : null,
      appliedAt: a.created_at || null,
      stage: a.stage || "applied",
      fit: a.fit || null, // "other" = talent pool (weak fit); anything else = strong
      matchScore: typeof a.match_score === "number" ? a.match_score : null,
      avatarUrl: c.photo_path ? urlByPath[c.photo_path] || null : null,
    };
  });
}

// ---- AI Rank (mirrors the web per-job flow) --------------------------------
// AI Rank only scores candidates still early in the pipeline: Applied and
// Shortlisted. Once someone is interviewing / offer / hired (or rejected), they
// are out of the ranking pool.
const RANKABLE_STAGES = ["applied", "shortlisted"];

// The last time this job was AI-Ranked (jobs.ai_ranked_at). Drives the per-job
// lock: once ranked, AI Rank is locked for EVERYONE until a genuinely new
// candidate applies (an application newer than this stamp).
export async function loadJobRankedAt(jobId) {
  if (!jobId) return null;
  const { data } = await supabase.from("jobs").select("ai_ranked_at").eq("id", jobId).single();
  return data?.ai_ranked_at || null;
}

// Persist an AI Rank run's scores. Routes through the definer RPC (0098) so an
// assigned interviewer's run persists too (applications RLS is read-only for
// them); falls back to a direct update for admins if the RPC isn't deployed.
async function saveMatchScores(companyId, jobId, results) {
  const p_scores = results.map(({ candidateId, score, rationale }) => ({
    candidate_id: candidateId, score: Math.round((Number(score) || 0) * 100), reasons: rationale || null,
  }));
  const { error } = await supabase.rpc("save_match_scores", { p_job_id: jobId, p_scores });
  if (error && (error.code === "42883" || error.code === "PGRST202")) {
    if (!companyId) return { ok: false, error: "save_match_scores RPC missing (apply migration 0100)" };
    let firstErr = null;
    await Promise.all(results.map(({ candidateId, score, rationale }) =>
      supabase.from("applications")
        .update({ match_score: Math.round((Number(score) || 0) * 100), match_reasons: rationale || null })
        .eq("company_id", companyId).eq("job_id", jobId).eq("candidate_id", candidateId)
        .then(({ error: e }) => { if (e && !firstErr) firstErr = e.message; })
    ));
    return firstErr ? { ok: false, error: firstErr } : { ok: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Rank a role's active applicants against the role, then persist + lock.
// Returns { ok:true, count, units } on success, or { ok:false, reason?, error? }
// where reason is "min" (fewer than 2 rankable) or "limit" (out of credits).
// The rank-candidates edge function charges the AI Rank credit itself (server
// side), only on a successful ranking — we never charge on failure.
export async function runAiRank({ companyId, jobId, job }) {
  if (!jobId) return { ok: false, error: "Missing job." };

  // Active pool: applications not in a terminal stage, whose candidate is parsed.
  const { data: apps } = await supabase
    .from("applications")
    .select("candidate_id, stage, fit, match_reasons")
    .eq("company_id", companyId)
    .eq("job_id", jobId);
  // Rankable = Applied/Shortlisted AND a strong match (a manual shortlist overrides
  // the AI's "other" call and counts as strong).
  const active = (apps || []).filter((a) =>
    RANKABLE_STAGES.includes(a.stage || "applied") && (a.fit !== "other" || a.stage === "shortlisted"));
  const prevReason = {};
  active.forEach((a) => { if (a.match_reasons) prevReason[a.candidate_id] = a.match_reasons; });
  const candIds = [...new Set(active.map((a) => a.candidate_id))];
  if (candIds.length < 2) return { ok: false, reason: "min" };

  const { data: cands } = await supabase
    .from("candidates").select("id, parsed, full_name").in("id", candIds);
  const pool = (cands || []).filter((c) => c && c.parsed).slice(0, 40); // 1 credit / 10, capped at 40
  if (pool.length < 2) return { ok: false, reason: "min" };
  const units = Math.max(1, Math.ceil(pool.length / 10));

  // Fresh role info (description/requirements live in jobs.details).
  const { data: jobRow } = await supabase.from("jobs").select("title, details").eq("id", jobId).single();
  const details = jobRow?.details || job?.details || {};
  const roleInfo = {
    title: jobRow?.title || job?.title || "",
    description: details.description || "",
    requirements: details.requirements || [],
  };
  const payload = pool.map((c) => ({
    id: c.id,
    name: c.parsed?.name || c.full_name || "Candidate",
    role: (Array.isArray(c.parsed?.experience) && c.parsed.experience[0]?.title) || null,
    years: typeof c.parsed?.years_of_experience === "number" ? c.parsed.years_of_experience : null,
    skills: Array.isArray(c.parsed?.skills) ? c.parsed.skills : [],
    industries: Array.isArray(c.parsed?.industries) ? c.parsed.industries : [],
  }));

  const { data, error } = await supabase.functions.invoke("rank-candidates", { body: { role: roleInfo, candidates: payload, units } });
  if (data?.error === "limit_reached") return { ok: false, reason: "limit", available: Number(data.available) || 0, needed: units };
  if (error || data?.error || !Array.isArray(data?.ranked)) return { ok: false, error: data?.error || error?.message || "rank failed" };

  // Keep each existing "Why" stable; only write a rationale for a candidate that
  // doesn't have one yet (a new applicant). Score (0..100 from the fn) → 0..1.
  const results = data.ranked
    .filter((r) => r && r.id)
    .map((r) => ({ candidateId: r.id, score: (Number(r.score) || 0) / 100, rationale: prevReason[r.id] || r.reason || "" }));
  if (!results.length) return { ok: false, error: "no scores returned" };

  const saved = await saveMatchScores(companyId, jobId, results);
  if (!saved.ok) return { ok: false, error: saved.error || "scores not saved", ranked: true };

  // Lock the job for everyone until a new candidate applies. Best-effort: the
  // save already succeeded, so a stamp failure just means the lock isn't set yet.
  await supabase.rpc("stamp_job_ranked", { p_job_id: jobId });
  return { ok: true, count: results.length, units: typeof data.used === "number" ? data.used : units };
}

// Schedule an interview directly (manager picks a time). Inserts a scheduled
// interview with the manager on the panel and advances the candidate to the
// interviewing stage — mirroring what confirm-booking does when a candidate books.
export async function scheduleInterview({ companyId, candidateId, jobId, candidateName, startIso, interviewerId, interviewerName }) {
  const { error } = await supabase.from("interviews").insert({
    company_id: companyId,
    candidate_id: candidateId,
    job_id: jobId || null,
    interviewer_id: interviewerId || null,
    interviewer_name: interviewerName || null,
    scheduled_at: startIso,
    status: "scheduled",
    provider: "google",
    attendees: [],
  });
  if (error) throw error;
  // Advance the pipeline stage the same way a confirmed booking does.
  await moveCandidateStage({ companyId, candidateId, candidateName, stage: "interviewing", notify: false }).catch(() => {});
}

// Stages a mobile client may set DIRECTLY, exactly matching what the web app's
// StageControl writes without side effects it can't reproduce. Deliberately
// EXCLUDES "offer" and "declined": on web those never come from a stage click —
// "offer" runs through the dedicated offer + DocuSign flow (dbCreateOffer +
// docusign-send) and "declined" only from an offer response. Setting them here
// would leave an offer-stage candidate with no offer record and break the web
// flow. Those actions stay on the web app.
export const MOBILE_STAGES = ["applied", "shortlisted", "interviewing", "hired", "rejected"];

// Move a candidate's stage with FULL web parity (mirrors setCandidateStage in
// resume-ai-preview.jsx): writes by candidate_id + company_id (candidate-level,
// like the web), logs activity on hire, and sends the same stage email for
// hired/rejected. Best-effort on the side effects so a mail/log hiccup never
// blocks the move.
export async function moveCandidateStage({ companyId, candidateId, candidateName, stage, notify = true }) {
  if (!MOBILE_STAGES.includes(stage)) {
    throw new Error(`"${stage}" can only be set on the web app.`);
  }
  // 1) Persist the stage exactly as dbSetCandidateStage does (by candidate).
  const { error } = await supabase
    .from("applications")
    .update({ stage })
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId);
  if (error) throw error;

  // 2) Activity log on hire (company-gated log_activity RPC, same as web).
  if (stage === "hired") {
    supabase.rpc("log_activity", {
      p_type: "hired",
      p_title: `${candidateName || "A candidate"} was hired`,
      p_candidate_id: candidateId,
    }).then(() => {}, () => {});
  }

  // 3) Candidate-facing stage email for hired/rejected (same edge function the
  //    web calls). Never let an email failure surface as a stage-change failure.
  if (notify && (stage === "hired" || stage === "rejected")) {
    supabase.functions
      .invoke("send-stage-email", { body: { candidate_id: candidateId, stage } })
      .catch(() => {});
  }
}

// ---- Candidate discussion (chat) ----------------------------------------------

// Load a candidate's discussion thread, oldest first, with author names.
export async function loadMessages(candidateId) {
  const { data } = await supabase
    .from("candidate_messages")
    .select("id, author_id, body, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });
  const rows = data || [];
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const nameById = {};
  if (authorIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, role").in("id", authorIds);
    (profs || []).forEach((p) => { nameById[p.id] = { name: p.full_name || "Teammate", role: p.role }; });
  }
  return rows.map((m) => ({
    id: m.id,
    authorId: m.author_id,
    authorName: nameById[m.author_id]?.name || "Teammate",
    authorRole: nameById[m.author_id]?.role || null,
    body: m.body,
    createdAt: m.created_at,
  }));
}

// Post a message, then best-effort push the rest of the panel.
export async function sendMessage({ companyId, candidateId, jobId, authorId, body }) {
  const text = (body || "").trim();
  if (!text) return null;
  const { data, error } = await supabase
    .from("candidate_messages")
    .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId || null, author_id: authorId, body: text })
    .select("id, author_id, body, created_at")
    .single();
  if (error) throw error;
  supabase.functions.invoke("notify-message", { body: { candidate_id: candidateId, job_id: jobId || null, preview: text } }).catch(() => {});
  return data;
}

// Subscribe to new messages on a candidate's thread. Returns an unsubscribe fn.
// Unique topic per call (see subscribeDashboard) to avoid re-subscribe collisions.
let _msgChanSeq = 0;
export function subscribeMessages(candidateId, onInsert) {
  const channel = supabase
    .channel(`candidate_messages:${candidateId}:${++_msgChanSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "candidate_messages", filter: `candidate_id=eq.${candidateId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
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
