// The mobile data layer. Every read/write goes straight to the same Supabase
// tables the web app uses; RLS scopes rows to the interviewer. Shapes returned
// here match what the web app already renders so behaviour stays consistent.
import { supabase } from "./supabase";
import { recommendationFromRatings, planLimits } from "@aster/shared";

const SIGNED_URL_TTL = 3600; // seconds

// ---- Interviews assigned to me -------------------------------------------------

// Upcoming + recent interviews where I am the interviewer, newest-relevant first.
// Returns enriched rows with candidate name, job title and resume/photo URLs.
export async function loadMyInterviews(companyId, userId, assignedJobIds = [], manager = false) {
  // proposed_slots so the Action card can show which times are outstanding
  // rather than only that something is outstanding. Same row, no extra query.
  const cols = "id, candidate_id, job_id, scheduled_at, status, provider, meeting_link, attendees, proposed_slots";
  // Everything in the interview process: confirmed (scheduled), awaiting the
  // candidate's pick (sent), and needs-new-times (reschedule) — so a rescheduled
  // interview doesn't vanish from the tab.
  const base = () => supabase
    .from("interviews").select(cols)
    .eq("company_id", companyId)
    .in("status", ["scheduled", "sent", "reschedule"]);
  let rows;
  if (manager) {
    // Owners/admins oversee hiring, so they see EVERY scheduled interview in the
    // company (RLS already permits it) — not only the panels they personally sit
    // on. Without this, an admin who didn't set up a given interview and isn't an
    // attendee would see an empty calendar.
    const res = await base();
    if (res.error) throw res.error;
    rows = res.data || [];
  } else {
    // Interviewers: an interview is "mine" if I set it up (interviewer_id), I'm on
    // the panel snapshot (attendees), OR it's on a role I'm assigned to. The
    // attendees snapshot is taken at invite time, so the assigned-jobs check keeps
    // a later-added interviewer from seeing an empty calendar.
    const queries = [
      base().eq("interviewer_id", userId),
      base().contains("attendees", [{ id: userId }]),
    ];
    if (assignedJobIds && assignedJobIds.length) queries.push(base().in("job_id", assignedJobIds));
    const results = await Promise.all(queries);
    if (results[0].error) throw results[0].error;
    const byId = new Map();
    for (const res of results) for (const r of res.data || []) byId.set(r.id, r);
    rows = [...byId.values()];
  }
  rows.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
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
      status: iv.status, // scheduled | sent | reschedule
      scheduledAt: iv.scheduled_at,
      proposedSlots: Array.isArray(iv.proposed_slots) ? iv.proposed_slots : [],
      provider: iv.provider || "google",
      meetingLink: iv.meeting_link || null,
      avatarUrl: c.photo_path ? urlByPath[c.photo_path] || null : null,
      resumeUrl: c.resume_path ? urlByPath[c.resume_path] || null : null,
    };
  });
}

// The candidate's next scheduled interview time (if any), for the profile.
// The candidate's latest interview record — scheduled OR a pending invite ("sent"
// with proposed slots the candidate hasn't picked from yet). Returns an object.
export async function loadCandidateInterview(companyId, candidateId) {
  const { data } = await supabase
    .from("interviews")
    .select("id, status, scheduled_at, proposed_slots, token, meeting_link, attendees, reschedule_note, previous_at, created_at")
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId)
    .in("status", ["scheduled", "sent", "reschedule"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    scheduledAt: data.scheduled_at || null,
    proposedSlots: Array.isArray(data.proposed_slots) ? data.proposed_slots : [],
    token: data.token || null,
    meetingLink: data.meeting_link || null,
    attendees: Array.isArray(data.attendees) ? data.attendees : [],
    rescheduleNote: data.reschedule_note || null,
    previousAt: data.previous_at || null, // original time before it was rescheduled
  };
}

// Save/update the meeting link on the candidate's scheduled interview.
// Save the interview's video-call link AND share it with everyone, matching the
// web app: the candidate gets a company-branded "your interview link" email and
// each panel member gets an internal heads-up with a calendar invite. Routed
// through the share-meeting-link edge function so mobile and web behave the same.
export async function shareMeetingLink(companyId, candidateId, jobId, link) {
  const clean = String(link || "").trim();
  if (!/^https?:\/\/\S+$/i.test(clean)) return { ok: false, error: "Enter a valid http(s) link." };
  const { data, error } = await supabase.functions.invoke("share-meeting-link", {
    body: { candidate_id: candidateId, job_id: jobId || null, meeting_link: clean },
  });
  if (error) return { ok: false, error: error.message || "Couldn't share the link." };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, candidate: !!data?.candidate, panel: data?.panel || 0 };
}

// Propose several interview times to the candidate (web-parity dbCreateInterview
// Invite): insert a "sent" interviews row with proposed_slots [{start,end}] and a
// booking token, then email the candidate a /book link (send-interview-invite).
// Advance a candidate's pipeline stage to "interviewing" — forward-only, so it
// never regresses someone already at interviewing/offer/hired. Job-scoped when a
// job is known. Best-effort.
async function advanceToInterviewing(companyId, candidateId, jobId) {
  if (!companyId || !candidateId) return;
  let q = supabase.from("applications").update({ stage: "interviewing" })
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .in("stage", ["applied", "shortlisted"]);
  if (jobId) q = q.eq("job_id", jobId);
  await q.then(() => {}, () => {});
}

export async function createInterviewInvite({ companyId, candidateId, jobId, interviewerName, interviewerEmail, slots = [], attendees = [] }) {
  const proposed = (slots || []).filter((s) => s && s.start).map((s) => ({ start: s.start, end: s.end }));
  if (!proposed.length) return { ok: false, error: "Add at least one time." };
  const fields = {
    interviewer_name: interviewerName || null, interviewer_email: interviewerEmail || null,
    proposed_slots: proposed, provider: "google", status: "sent", attendees,
    scheduled_at: null, meeting_link: null,
  };
  // Reuse an existing non-confirmed interview for this candidate+job (a reschedule
  // row, or a prior 'sent' invite) instead of creating a duplicate row. Keep
  // previous_at so a rescheduled invite still knows the original date.
  let sel = supabase.from("interviews").select("id, previous_at")
    .eq("company_id", companyId).eq("candidate_id", candidateId)
    .in("status", ["reschedule", "sent"]).order("created_at", { ascending: false }).limit(1);
  if (jobId) sel = sel.eq("job_id", jobId);
  const { data: existing } = await sel.maybeSingle();
  let token = null;
  if (existing) {
    const { data, error } = await supabase.from("interviews")
      .update({ ...fields, previous_at: existing.previous_at || null }).eq("id", existing.id)
      .select("token").single();
    if (error || !data?.token) return { ok: false, error: error?.message || "Couldn't update the invite." };
    token = data.token;
  } else {
    const { data, error } = await supabase.from("interviews")
      .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId || null, ...fields })
      .select("token").single();
    if (error || !data?.token) return { ok: false, error: error?.message || "Couldn't create the invite." };
    token = data.token;
  }

  // Sending times (from a poll or set directly) moves them into "Interview".
  advanceToInterviewing(companyId, candidateId, jobId);
  let emailed = false, skipped = null;
  try {
    const { data: em, error: ee } = await supabase.functions.invoke("send-interview-invite", { body: { token } });
    skipped = em?.skipped || null;
    emailed = !ee && !em?.error && !skipped;
  } catch { /* best-effort email */ }
  return { ok: true, token, emailed, skipped };
}

// Confirmed interviews across the company, each with the panel's profile ids and
// the booked time range — so a scheduler can grey out times a panel member is
// already committed to and never double-book a person.
export async function loadBookedSlots(companyId) {
  if (!companyId) return [];
  const { data } = await supabase
    .from("interviews")
    .select("candidate_id, scheduled_at, attendees, proposed_slots")
    .eq("company_id", companyId).eq("status", "scheduled");
  return (data || []).filter((iv) => iv.scheduled_at).map((iv) => {
    const start = iv.scheduled_at;
    const slot = (Array.isArray(iv.proposed_slots) ? iv.proposed_slots : []).find((s) => s.start === start);
    const end = slot?.end || new Date(new Date(start).getTime() + 30 * 60000).toISOString();
    const attendeeIds = (Array.isArray(iv.attendees) ? iv.attendees : []).map((a) => a.id).filter(Boolean);
    return { candidateId: iv.candidate_id, start, end, attendeeIds };
  });
}

// Re-send the booking email for an existing invite token.
export async function resendInterviewInvite(token) {
  if (!token) return { ok: false };
  try {
    const { data, error } = await supabase.functions.invoke("send-interview-invite", { body: { token } });
    return { ok: !error && !data?.error, skipped: data?.skipped || null };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

// Full detail for one candidate (parsed resume blob + signed URLs).
export async function loadCandidate(candidateId) {
  const { data } = await supabase
    .from("candidates")
    .select("id, parsed, full_name, email, file_name, has_photo, photo_path, resume_path, experience_insights")
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
    experienceInsights: data.experience_insights || null, // stored Claude analysis, if any
  };
}

// AI-generated interview questions for this candidate+role, if any were saved.
export async function loadInterviewQuestions(candidateId, jobId) {
  const q = supabase.from("interview_questions").select("questions").eq("candidate_id", candidateId);
  const { data } = jobId ? await q.eq("job_id", jobId).maybeSingle() : await q.maybeSingle();
  return Array.isArray(data?.questions) ? data.questions : [];
}

// Generate AI interview questions tailored to this candidate + role, then store
// them (one set per candidate/job) so the whole panel reads the same set. Manager
// only (RLS: interviewers read; admins write). Mirrors the web generate flow.
export async function generateInterviewQuestions({ companyId, candidateId, jobId, parsed, jobTitle }) {
  if (!jobId) return { ok: false, error: "This candidate isn't linked to a role." };
  const { data, error } = await supabase.functions.invoke("generate-interview-questions", {
    body: { candidate: { parsed }, jobTitle: jobTitle || "the role" },
  });
  if (error) return { ok: false, error: error.message || "Couldn't generate questions." };
  if (data?.error) return { ok: false, error: data.error === "insufficient_credits" ? "Out of AI question credits this cycle." : data.error };
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  if (!questions.length) return { ok: false, error: "No questions generated. Try again." };
  await supabase.from("interview_questions").upsert(
    { company_id: companyId, candidate_id: candidateId, job_id: jobId, questions },
    { onConflict: "candidate_id,job_id" },
  );
  return { ok: true, questions };
}

// Run the AI read of a resume: total and leadership experience, domain exposure,
// employer tenure, employment gaps. Spends one AI Insight credit, charged by the
// edge function itself (0046), which also persists the result on the candidate
// row so it survives a reload and is never paid for twice.
//
// A failure after the charge is refunded server-side, so "no credit was used" is
// a claim we can actually make. limit_reached is surfaced rather than swallowed:
// quietly falling back to a local read is what made the cap feel imaginary.
export async function runExperienceInsights(candidate) {
  if (!candidate?.parsed) return { ok: false, error: "This resume hasn't been parsed yet." };
  const { data, error } = await supabase.functions.invoke("analyze-experience", {
    body: { candidate: { id: candidate.id, parsed: candidate.parsed } },
  });
  // supabase-js throws on non-2xx, so a 402 arrives as an error with the JSON
  // body tucked inside context. Dig it out before deciding what went wrong.
  let body = data;
  if (error) { try { body = await error.context?.json?.(); } catch { /* non-JSON */ } }
  if (body?.error === "limit_reached") return { ok: false, limitReached: true, used: body.used, limit: body.monthly_limit };
  if (error || body?.error || !body?.insights) return { ok: false, error: "AI Insights didn't run. No credit was used." };
  return { ok: true, insights: body.insights, used: body.used, limit: body.monthly_limit };
}

// ---- Scorecards ----------------------------------------------------------------

// All scorecards for a candidate (read is RLS-scoped to my assigned jobs).
export async function loadScorecards(candidateId) {
  const { data } = await supabase
    .from("scorecards")
    .select("id, interviewer_id, ratings, notes, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  // One card per reviewer: rows are newest-first, so keep the first seen and
  // drop any older/duplicate submissions from the same person.
  const seen = new Set();
  const rows = (data || []).filter((s) => {
    if (s.interviewer_id && seen.has(s.interviewer_id)) return false;
    if (s.interviewer_id) seen.add(s.interviewer_id);
    return true;
  });
  // Resolve reviewer names so each feedback card shows who gave it.
  const ids = [...new Set(rows.map((s) => s.interviewer_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }
  return rows.map((s) => ({
    id: s.id,
    interviewerId: s.interviewer_id,
    interviewerName: names[s.interviewer_id] || null,
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
  // One scorecard per interviewer per candidate: update in place if this person
  // already scored, so repeated submits revise their card instead of piling up.
  const { data: existing } = await supabase
    .from("scorecards").select("id")
    .eq("candidate_id", candidateId).eq("interviewer_id", userId)
    .limit(1).maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("scorecards")
      .update({ ratings, notes: notes || "", job_id: jobId })
      .eq("id", existing.id)
      .select("id").single();
    if (error) throw error;
    return data;
  }
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

// The latest application's stage + AI match score and rationale ("Why") for a
// candidate. Lets a screen reached without a stage param show the right stage,
// and surfaces the same match reasoning the web shows.
export async function loadApplicationMeta(companyId, candidateId) {
  if (!companyId || !candidateId) return null;
  const { data } = await supabase
    .from("applications")
    .select("stage, match_score, match_reasons")
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    stage: data.stage || null,
    reason: data.match_reasons || null,
    score: typeof data.match_score === "number" ? data.match_score : null,
  };
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

// ---- Job interviewer pool (job_assignments, migration 0021) ----------------
// Company team members double as the interviewer pool; a job_assignments row
// links an interviewer to a job so they can see its applicants and request
// interviews. Returns the interviewer-role teammates with an `assigned` flag for
// this job (assigned first, then alphabetical).
export async function loadInterviewers(companyId, jobId) {
  if (!companyId) return [];
  const [{ data: profs }, { data: assigns }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, status").eq("company_id", companyId).neq("status", "suspended"),
    jobId
      ? supabase.from("job_assignments").select("profile_id").eq("company_id", companyId).eq("job_id", jobId)
      : Promise.resolve({ data: [] }),
  ]);
  const assigned = new Set((assigns || []).map((a) => a.profile_id));
  return (profs || [])
    .filter((p) => (p.role || "").toLowerCase() === "interviewer")
    .map((p) => ({ id: p.id, name: p.full_name || p.email || "Teammate", email: p.email || "", role: p.role, assigned: assigned.has(p.id) }))
    .sort((a, b) => (Number(b.assigned) - Number(a.assigned)) || a.name.localeCompare(b.name));
}

// The whole company team (all active members), for the Teams tab. Sorted by
// role seniority then name. Roles: owner, admin, recruiter, interviewer.
const ROLE_RANK = { owner: 0, admin: 1, recruiter: 2, interviewer: 3 };
// Invite a teammate by email + role (admin/interviewer). Routed through the same
// send-teammate-invite edge function the web uses: it runs the invite_teammate
// RPC as the caller (so seat + role limits apply) and emails the invitee.
export async function inviteTeammate({ email, role }) {
  const clean = String(email || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: "Enter a valid email address." };
  const { data, error } = await supabase.functions.invoke("send-teammate-invite", {
    body: { email: clean, role: role === "admin" ? "admin" : "interviewer" },
  });
  if (error) return { ok: false, error: error.message || "Couldn't send the invite." };
  if (data?.error) {
    const map = { seat_limit: "You've reached your seat limit. Upgrade on the web app to add more.", not_allowed: "Only workspace admins can invite teammates." };
    return { ok: false, error: map[data.error] || data.error };
  }
  return { ok: true, reactivated: !!data?.reactivated, email: clean };
}

export async function loadTeam(companyId) {
  if (!companyId) return [];
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status")
    .eq("company_id", companyId)
    .neq("status", "suspended");
  return (data || [])
    .map((p) => ({ id: p.id, name: p.full_name || p.email || "Teammate", email: p.email || "", role: (p.role || "").toLowerCase(), pending: p.status === "invited" }))
    .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.name.localeCompare(b.name));
}

// Add a teammate to a job's interviewer pool. Owner/admin-gated server-side.
// Returns an error message, or null on success.
export async function assignInterviewer(jobId, profileId) {
  if (!jobId || !profileId) return "Missing job or teammate.";
  const { error } = await supabase.rpc("assign_interviewer", { p_job_id: jobId, p_profile_id: profileId });
  if (!error) return null;
  if (error.code === "42501") return "Only an owner or admin can assign interviewers.";
  if (error.code === "42883") return "Interviewer assignment isn't available (migration 0021 missing).";
  return error.message || "Couldn't add that interviewer.";
}

// Remove a teammate from a job's interviewer pool. Owner/admin-gated server-side.
export async function unassignInterviewer(jobId, profileId) {
  if (!jobId || !profileId) return "Missing job or teammate.";
  const { error } = await supabase.rpc("unassign_interviewer", { p_job_id: jobId, p_profile_id: profileId });
  if (!error) return null;
  if (error.code === "42501") return "Only an owner or admin can change interviewers.";
  return error.message || "Couldn't remove that interviewer.";
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
// Stages that may be set by a plain stage move. Deliberately EXCLUDES "offer"
// and "declined": "offer" must go through sendOffer() (create the offer row +
// Aster Sign / approval), never a raw stage write, or you'd get an offer-stage
// candidate with no offer record; "declined" only ever comes from an offer
// response (respond-offer / expire-offer). sendOffer sets the "offer" stage
// itself as part of the real flow.
export const MOBILE_STAGES = ["applied", "shortlisted", "interviewing", "hired", "rejected"];

// Move a candidate's stage with FULL web parity (mirrors setCandidateStage in
// resume-ai-preview.jsx): writes by candidate_id + company_id (candidate-level,
// like the web), logs activity on hire, and sends the same stage email for
// hired/rejected. Best-effort on the side effects so a mail/log hiccup never
// blocks the move.
// ---- Personal shortlist ("my picks") ----------------------------------------
// A shortlist is a BOOKMARK, not a pipeline step: migration 0075 defines it as
// independent of AI Rank order and of applications.stage. Mobile used to star a
// candidate by moving their stage applied -> shortlisted, which quietly advanced
// them through the hiring funnel (and inflated "advanced past applied" in
// Pipeline Health) when the user only meant "remember this person". These two
// helpers mirror dbListMyShortlist / dbSetShortlist on web so both apps mean the
// same thing by a star.

// Application ids the signed-in user has starred. RLS returns every pick for a
// manager, so scope to the caller's own rows.
export async function loadMyShortlist(companyId, userId) {
  if (!companyId || !userId) return [];
  const { data, error } = await supabase
    .from("candidate_shortlists").select("application_id")
    .eq("company_id", companyId).eq("profile_id", userId);
  if (error) { console.error("loadMyShortlist", error.message); return []; }
  return (data || []).map((r) => r.application_id).filter(Boolean);
}

// Star / unstar for the signed-in user. profile_id must equal auth.uid(); RLS
// enforces it, passing userId just satisfies the insert.
export async function setShortlisted({ companyId, userId, applicationId, on }) {
  if (!companyId || !userId || !applicationId) return;
  if (on) {
    const { error } = await supabase
      .from("candidate_shortlists")
      .upsert({ company_id: companyId, application_id: applicationId, profile_id: userId },
              { onConflict: "application_id,profile_id" });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("candidate_shortlists").delete()
      .eq("application_id", applicationId).eq("profile_id", userId);
    if (error) throw new Error(error.message);
  }
}

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

// ---- Offers (mirrors the web sendOffer / dbCreateOffer / Aster Sign flow) ---
// Links resolve on the production web app (Aster Sign is a hosted signing page
// the candidate reaches by emailed link; approvers get their own /approve link).
const OFFER_ORIGIN = "https://hireaster.com";

// Latest offer for a candidate (same columns dbGetOffer reads on web).
export async function loadOffer(companyId, candidateId) {
  if (!companyId || !candidateId) return null;
  const { data } = await supabase
    .from("offers")
    .select("id, token, status, approval_status, esign_provider, esign_status, signed_pdf_path, expires_at, created_at, message, base_salary, salary_currency, employment_type, start_date, offer_job_title")
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// The approval chain for an offer, in step order (drives the approval progress).
export async function loadOfferApprovals(offerId) {
  if (!offerId) return [];
  const { data } = await supabase
    .from("offer_approvals")
    .select("step, approver_email, approver_name, status, reason, decided_at")
    .eq("offer_id", offerId)
    .order("step", { ascending: true });
  return data || [];
}

// Insert the offer row with its terms (mirrors dbCreateOffer, camelCase terms →
// columns). Returns { token, id } or { error }.
async function createOffer(companyId, { candidateId, jobId = null, terms = null }) {
  const row = { company_id: companyId, candidate_id: candidateId, job_id: jobId, status: "sent" };
  if (terms) {
    if (terms.baseSalary != null && terms.baseSalary !== "") row.base_salary = Number(terms.baseSalary);
    if (terms.currency) row.salary_currency = terms.currency;
    if (terms.employmentType) row.employment_type = terms.employmentType;
    if (terms.startDate) row.start_date = terms.startDate;
    if (terms.expiresAt) row.expires_at = terms.expiresAt;
    if (terms.jobTitle) row.offer_job_title = terms.jobTitle;
  }
  const { data, error } = await supabase.from("offers").insert(row).select("token, id").single();
  if (error) {
    // Pre-migration DB missing the terms columns: retry base columns only.
    if (error.code === "42703" || error.code === "PGRST204") {
      const { data: d2, error: e2 } = await supabase.from("offers")
        .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId, status: "sent" })
        .select("token, id").single();
      return e2 ? { error: e2.message } : d2;
    }
    return { error: error.message };
  }
  return data;
}

// Create + send an offer, mirroring the web sendOffer:
//   - creates the offer row (with terms),
//   - advances the application to the "offer" stage (no candidate email here),
//   - with approvers → offer-approval-submit (sequential sign-off; candidate is
//     emailed only after the final approval),
//   - else if emailSent → aster-sign-send emails the candidate a review-&-sign link,
//   - else records the offer only.
// Returns { ok, token, needsApproval, emailed } or { ok:false, error }.
export async function sendOffer({ companyId, candidateId, candidateName, jobId = null, terms, message = null, approvers = [], emailSent = true }) {
  const valid = (approvers || [])
    .filter((a) => a?.email && a.email.includes("@"))
    .map((a) => ({ email: a.email.trim(), name: (a.name || "").trim() }));
  const needsApproval = valid.length > 0;

  const created = await createOffer(companyId, { candidateId, jobId, terms });
  if (!created || created.error || !created.token) {
    return { ok: false, error: created?.error || "Couldn't create the offer." };
  }
  const token = created.token;

  // Advance to the offer stage — no candidate email (offers email separately).
  // This mirrors setCandidateStage(candidateId, "offer", { notify:false }); done
  // here (not moveCandidateStage) so a raw "offer" stage write stays blocked
  // everywhere except as part of a real offer.
  await supabase.from("applications").update({ stage: "offer" })
    .eq("company_id", companyId).eq("candidate_id", candidateId);

  try {
    if (needsApproval) {
      const { data, error } = await supabase.functions.invoke("offer-approval-submit", {
        body: { offerToken: token, approvers: valid, message, terms, mode: null, origin: OFFER_ORIGIN },
      });
      if (error || data?.error) return { ok: false, error: data?.error || error?.message || "Couldn't submit for approval.", staged: true };
    } else if (emailSent) {
      const { data, error } = await supabase.functions.invoke("aster-sign-send", {
        body: { token, message, origin: OFFER_ORIGIN },
      });
      if (error || data?.error) return { ok: false, error: data?.error || error?.message || "Offer created, but emailing the candidate failed.", staged: true };
    }
  } catch (e) {
    return { ok: false, error: e?.message || "Offer created, but sending failed.", staged: true };
  }

  supabase.rpc("log_activity", {
    p_type: needsApproval ? "offer_approval_requested" : "offer_sent",
    p_title: `Offer ${needsApproval ? "sent for approval" : "sent"} to ${candidateName || "a candidate"}`,
    p_candidate_id: candidateId,
  }).then(() => {}, () => {});

  return { ok: true, token, needsApproval, emailed: !needsApproval && emailSent };
}

// Short-lived signed URL for a completed offer's PDF (via offer-signed-url).
export async function signedOfferUrl(candidateId) {
  try {
    const { data } = await supabase.functions.invoke("offer-signed-url", { body: { candidateId } });
    return data?.url || null;
  } catch {
    return null;
  }
}

// ---- Interview availability polls ---------------------------------------------
// A manager proposes candidate interview slots; the panel votes their
// availability; the manager picks the winning slot (which schedules it).

// Latest poll for a candidate, with per-slot vote counts, voter names and
// whether the current user voted. Returns null if there's no poll.
export async function loadCandidatePoll(companyId, candidateId, myProfileId) {
  if (!companyId || !candidateId) return null;
  // Only an OPEN poll is "active". A closed poll is history from a previous
  // scheduling cycle (e.g. before a reschedule) — showing it with live actions is
  // stale and misleading, so treat it as no poll.
  const { data: poll } = await supabase
    .from("interview_polls")
    .select("id, job_id, status, chosen_slot, created_by, proposed_by, created_at")
    .eq("company_id", companyId)
    .eq("candidate_id", candidateId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!poll) return null;

  const [{ data: slots }, { data: votes }] = await Promise.all([
    supabase.from("interview_poll_slots").select("id, slot_ts, slot_end").eq("poll_id", poll.id).order("slot_ts", { ascending: true }),
    supabase.from("interview_poll_votes").select("slot_id, profile_id, voter_name").eq("poll_id", poll.id),
  ]);
  const bySlot = {};
  (votes || []).forEach((v) => { (bySlot[v.slot_id] ||= []).push(v); });

  return {
    id: poll.id,
    jobId: poll.job_id,
    status: poll.status,
    chosenSlot: poll.chosen_slot,
    createdBy: poll.created_by,
    proposedBy: poll.proposed_by || "panel", // 'panel' (round 1) | 'candidate' (round 2)
    // Who counts as "voted": on a round-1 panel poll they need >=2 picks (so there's
    // real overlap to propose from); on a round-2 candidate poll the candidate only
    // offered a couple of specific times, so marking even one is a valid vote.
    voterIds: (() => {
      const need = poll.proposed_by === "candidate" ? 1 : 2;
      const byProfile = {};
      (votes || []).forEach((v) => { byProfile[v.profile_id] = (byProfile[v.profile_id] || 0) + 1; });
      return Object.keys(byProfile).filter((id) => byProfile[id] >= need);
    })(),
    slots: (slots || []).map((s) => {
      const vs = bySlot[s.id] || [];
      return {
        id: s.id,
        ts: s.slot_ts,
        end: s.slot_end || null,
        count: vs.length,
        voters: vs.map((v) => v.voter_name || "Teammate"),
        mine: vs.some((v) => v.profile_id === myProfileId),
      };
    }),
  };
}

// Open availability polls the signed-in user can see (RLS scopes interviewers to
// their assigned roles), with whether they've already voted — so the app can
// surface "polls that need your vote" and jump straight to the candidate chat.
export async function loadOpenPolls(companyId, userId) {
  if (!companyId) return [];
  const { data: polls } = await supabase
    .from("interview_polls")
    .select("id, candidate_id, job_id, created_by, created_at")
    .eq("company_id", companyId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  // The person who created the poll doesn't vote on it — don't prompt them.
  let rows = (polls || []).filter((p) => p.created_by !== userId);
  if (!rows.length) return [];
  // Drop polls whose candidate has already confirmed an interview — the poll is
  // moot once a time is booked.
  const allCandIds = [...new Set(rows.map((p) => p.candidate_id).filter(Boolean))];
  const { data: sched } = await supabase
    .from("interviews").select("candidate_id")
    .eq("company_id", companyId).eq("status", "scheduled").in("candidate_id", allCandIds);
  const confirmed = new Set((sched || []).map((s) => s.candidate_id));
  rows = rows.filter((p) => !confirmed.has(p.candidate_id));
  if (!rows.length) return [];
  const pollIds = rows.map((p) => p.id);
  const candIds = [...new Set(rows.map((p) => p.candidate_id).filter(Boolean))];
  const jobIds = [...new Set(rows.map((p) => p.job_id).filter(Boolean))];
  const [mv, cs, js, sl] = await Promise.all([
    supabase.from("interview_poll_votes").select("poll_id").eq("company_id", companyId).eq("profile_id", userId).in("poll_id", pollIds),
    candIds.length ? supabase.from("candidates").select("id, parsed, full_name, photo_path").in("id", candIds) : Promise.resolve({ data: [] }),
    jobIds.length ? supabase.from("jobs").select("id, title").in("id", jobIds) : Promise.resolve({ data: [] }),
    // The proposed times, so the prompt can say what is being asked instead of
    // making someone open a screen to find out whether they can even help.
    supabase.from("interview_poll_slots").select("poll_id, slot_ts").eq("company_id", companyId).in("poll_id", pollIds),
  ]);
  const voted = new Set((mv.data || []).map((v) => v.poll_id));
  const slotsByPoll = {};
  (sl.data || []).forEach((s) => { (slotsByPoll[s.poll_id] ||= []).push(s.slot_ts); });
  Object.values(slotsByPoll).forEach((a) => a.sort());
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
      slots: slotsByPoll[p.id] || [], // ISO timestamps, earliest first
      askedAt: p.created_at,
      voted: voted.has(p.id),
    };
  });
}

// Polls the signed-in user created (open, candidate not yet confirmed) with how
// many of the panel have voted — so the HM can track completion from the
// Interviews tab without opening each candidate chat.
export async function loadMyPollProgress(companyId, userId) {
  if (!companyId) return [];
  const { data: polls } = await supabase
    .from("interview_polls")
    .select("id, candidate_id, job_id, proposed_by, created_at")
    .eq("company_id", companyId).eq("status", "open").eq("created_by", userId)
    .order("created_at", { ascending: false });
  const rows = polls || [];
  if (!rows.length) return [];
  const pollIds = rows.map((p) => p.id);
  const candIds = [...new Set(rows.map((p) => p.candidate_id).filter(Boolean))];
  const jobIds = [...new Set(rows.map((p) => p.job_id).filter(Boolean))];
  const [sched, cs, js, votes, assigns] = await Promise.all([
    supabase.from("interviews").select("candidate_id").eq("company_id", companyId).eq("status", "scheduled").in("candidate_id", candIds),
    candIds.length ? supabase.from("candidates").select("id, parsed, full_name").in("id", candIds) : Promise.resolve({ data: [] }),
    jobIds.length ? supabase.from("jobs").select("id, title").in("id", jobIds) : Promise.resolve({ data: [] }),
    supabase.from("interview_poll_votes").select("poll_id, profile_id").in("poll_id", pollIds),
    jobIds.length ? supabase.from("job_assignments").select("job_id, profile_id").eq("company_id", companyId).in("job_id", jobIds) : Promise.resolve({ data: [] }),
  ]);
  const confirmed = new Set((sched.data || []).map((s) => s.candidate_id));
  const candById = Object.fromEntries((cs.data || []).map((c) => [c.id, c]));
  const jobTitle = Object.fromEntries((js.data || []).map((j) => [j.id, j.title]));
  const assignedByJob = {};
  (assigns.data || []).forEach((a) => { (assignedByJob[a.job_id] ||= new Set()).add(a.profile_id); });
  // Count votes per (poll, profile); a panelist "voted" only with >=2 picks.
  const countByPoll = {};
  (votes.data || []).forEach((v) => { (countByPoll[v.poll_id] ||= {}); countByPoll[v.poll_id][v.profile_id] = (countByPoll[v.poll_id][v.profile_id] || 0) + 1; });
  return rows.filter((p) => !confirmed.has(p.candidate_id)).map((p) => {
    const panel = [...(assignedByJob[p.job_id] || new Set())].filter((id) => id !== userId); // exclude the creator
    const counts = countByPoll[p.id] || {};
    const need = p.proposed_by === "candidate" ? 1 : 2; // candidate polls: any pick counts
    const c = candById[p.candidate_id] || {};
    return {
      pollId: p.id, candidateId: p.candidate_id, jobId: p.job_id,
      candidateName: c.parsed?.name || c.full_name || "Candidate",
      jobTitle: jobTitle[p.job_id] || "Role",
      voted: panel.filter((id) => (counts[id] || 0) >= need).length,
      total: panel.length,
    };
  });
}

// Create a poll from time-range slots [{ start, end }] (ISO). Managers only.
// Logs an activity so the panel is notified (Notifications feed + bell badge).
export async function createPoll({ companyId, candidateId, candidateName, jobId, createdBy, slots = [] }) {
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
  advanceToInterviewing(companyId, candidateId, jobId);
  supabase.rpc("log_activity", {
    p_type: "interview_poll",
    p_title: `Interview availability poll · ${candidateName || "candidate"}`,
    p_description: `Tap to mark the times you can make (${clean.length} options).`,
    p_candidate_id: candidateId,
    p_job_id: jobId || null,
  }).then(() => {}, () => {});
  // Push the assigned interviewers (best-effort; needs notify-poll deployed).
  supabase.functions.invoke("notify-poll", {
    body: { candidate_id: candidateId, job_id: jobId || null, candidate_name: candidateName || null },
  }).then(() => {}, () => {});
  return { ok: true, id: poll.id };
}

// Toggle the current user's availability for a slot.
export async function togglePollVote({ companyId, pollId, slotId, profileId, voterName, on }) {
  if (on) {
    const { error } = await supabase.from("interview_poll_votes")
      .insert({ poll_id: pollId, slot_id: slotId, company_id: companyId, profile_id: profileId, voter_name: voterName || null });
    // A duplicate (already voted) isn't an error worth surfacing.
    if (error && error.code !== "23505") return error.message;
    // Tell whoever opened the poll. The function decides whether this tap was
    // the one that made the vote count, so it fires once per voter rather than
    // once per slot ticked. Fire-and-forget: the vote is already saved.
    supabase.functions.invoke("notify-poll-vote", { body: { poll_id: pollId } }).catch(() => {});
    return null;
  }
  const { error } = await supabase.from("interview_poll_votes")
    .delete().eq("slot_id", slotId).eq("profile_id", profileId);
  return error ? error.message : null;
}

// Close a poll, recording the chosen slot time.
export async function closePoll(pollId, chosenIso) {
  const { error } = await supabase.from("interview_polls")
    .update({ status: "closed", chosen_slot: chosenIso || null, closed_at: new Date().toISOString() })
    .eq("id", pollId);
  return error ? error.message : null;
}

// Reschedule a scheduled interview (e.g. a no-show): reset it to a fresh
// scheduling cycle so the HM runs a new panel poll. Empty proposed_slots marks
// it as HM-initiated (vs a candidate-proposed reschedule, which keeps slots).
export async function rescheduleInterview(companyId, candidateId) {
  const { data } = await supabase.from("interviews").select("id, scheduled_at, previous_at")
    .eq("company_id", companyId).eq("candidate_id", candidateId).eq("status", "scheduled")
    .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { ok: false, error: "No scheduled interview to reschedule." };
  const { error } = await supabase.from("interviews").update({
    status: "reschedule", scheduled_at: null, proposed_slots: [], meeting_link: null,
    reschedule_note: null, reschedule_at: new Date().toISOString(),
    previous_at: data.scheduled_at || data.previous_at || null, // remember the original time
  }).eq("id", data.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// HM confirms a slot from a candidate-proposed (round 2) poll. The candidate
// already offered these times, so confirming is the same as their own booking:
// reuse confirm-booking (schedules + emails candidate confirmation + panel) via
// the interview token, then close the poll on the chosen slot.
export async function confirmPollSlot({ token, pollId, startIso }) {
  if (!token) return { ok: false, error: "This interview can't be confirmed (no booking link)." };
  if (!startIso) return { ok: false, error: "Pick a time to confirm." };
  const { data, error } = await supabase.functions.invoke("confirm-booking", { body: { token, start: startIso } });
  if (error || data?.error) return { ok: false, error: data?.error || error?.message || "Couldn't confirm the time." };
  if (pollId) await closePoll(pollId, startIso).catch(() => {});
  return { ok: true };
}

// Live poll updates: reload on any vote/poll change in the company.
let _pollChanSeq = 0;
export function subscribePoll(companyId, onChange) {
  const channel = supabase
    .channel(`polls:${companyId}:${++_pollChanSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "interview_poll_votes", filter: `company_id=eq.${companyId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "interview_polls", filter: `company_id=eq.${companyId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Live interview changes (scheduled / sent / reschedule / meeting link) so the
// mobile app reflects desktop actions without a manual refresh. RLS scopes it.
let _ivChanSeq = 0;
export function subscribeInterviews(companyId, onChange) {
  if (!companyId) return () => {};
  const channel = supabase
    .channel(`interviews:${companyId}:${++_ivChanSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "interviews", filter: `company_id=eq.${companyId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ---- Candidate discussion (chat) ----------------------------------------------

// Load a candidate's discussion thread, oldest first, with author names.
export async function loadMessages(candidateId) {
  const { data } = await supabase
    .from("candidate_messages")
    .select("id, author_id, body, created_at, mentioned_ids")
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
    mentionedIds: Array.isArray(m.mentioned_ids) ? m.mentioned_ids : [],
    createdAt: m.created_at,
  }));
}

// Everyone who can be @mentioned in a candidate's thread: the managers plus the
// role's assigned interviewers (the same audience notify-message pushes to),
// minus the person composing. Returns [{ id, name, email, role }].
export async function loadThreadParticipants(companyId, jobId, exceptId) {
  if (!companyId) return [];
  const [{ data: profs }, { data: assigns }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, status").eq("company_id", companyId).neq("status", "suspended"),
    jobId
      ? supabase.from("job_assignments").select("profile_id").eq("company_id", companyId).eq("job_id", jobId)
      : Promise.resolve({ data: [] }),
  ]);
  const assigned = new Set((assigns || []).map((a) => a.profile_id));
  const isManager = (r) => ["owner", "admin", "recruiter"].includes((r || "").toLowerCase());
  return (profs || [])
    .filter((p) => p.id !== exceptId && (isManager(p.role) || assigned.has(p.id)))
    .map((p) => ({ id: p.id, name: p.full_name || p.email || "Teammate", email: p.email || "", role: p.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Post a message, then best-effort push the rest of the panel. `mentionedIds`
// are the tagged teammates: notify-message gives them a distinct "mentioned
// you" push instead of the generic one.
export async function sendMessage({ companyId, candidateId, jobId, authorId, body, mentionedIds = [] }) {
  const text = (body || "").trim();
  if (!text) return null;
  const mentions = [...new Set((mentionedIds || []).filter(Boolean))];
  const { data, error } = await supabase
    .from("candidate_messages")
    .insert({ company_id: companyId, candidate_id: candidateId, job_id: jobId || null, author_id: authorId, body: text, mentioned_ids: mentions })
    .select("id, author_id, body, created_at, mentioned_ids")
    .single();
  if (error) throw error;
  supabase.functions.invoke("notify-message", { body: { candidate_id: candidateId, job_id: jobId || null, preview: text, mentioned_ids: mentions } }).catch(() => {});
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
