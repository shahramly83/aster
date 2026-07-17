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
    .select("id, title, status, details, created_at")
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
export function subscribeDashboard(companyId, onChange) {
  const channel = supabase
    .channel(`dashboard:${companyId}`)
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
export function subscribeMessages(candidateId, onInsert) {
  const channel = supabase
    .channel(`candidate_messages:${candidateId}`)
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
