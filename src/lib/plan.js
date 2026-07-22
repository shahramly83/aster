// Plan tiers: the limits table and the tolerant lookups around it.
// Extracted from the app so the fallback can be regression-tested — an
// unrecognised tier once fell through to Elite's limits (the failed-open bug).

export const PLAN_TIER_ALIASES = { free: "launch", growth: "scale", pro: "elite" };

// There is exactly ONE cap on team size: `seats`. Hiring managers, interviewers,
// pending invites and the tenant all draw from it, and invite_teammate enforces it
// server-side. A second `interviewers` limit used to sit here alongside a
// canAddInterviewers flag that was true on every plan; neither was ever read by any
// code, client or server. Removed rather than left to look like a gate that holds.

export const PLAN_LIMITS = {
  launch: {
    maxJobs: 1, seats: Infinity,
    parseApplicant: 100, resumeUploads: 10,               // resumeUploads = AI Parsing (Bulk upload)
    aiRunsPerMonth: 5, aiInsightsPerMonth: 5, interviewQuestionsPerMonth: 5,
    // Plans differ ONLY by job-post quantity (maxJobs) and the AI/screening credit
    // allowances above. Everything a customer can SEE (AI Rank result depth, the
    // candidate database, applicant lists, skill/industry filters) is unlimited on
    // every plan, Launch included.
    aiMatches: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: false, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: false, meetingCalendar: false, dataExport: true,
    supportTier: "ticket", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  scale: {
    maxJobs: 5, seats: Infinity,
    parseApplicant: 500, resumeUploads: 50,
    aiRunsPerMonth: 30, aiInsightsPerMonth: 100, interviewQuestionsPerMonth: 30,
    aiMatches: 10,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: false, meetingCalendar: true, dataExport: true,
    supportTier: "ticket", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  elite: {
    maxJobs: 10, seats: Infinity,
    parseApplicant: 1000, resumeUploads: 100,
    aiRunsPerMonth: 100, aiInsightsPerMonth: 300, interviewQuestionsPerMonth: 100,
    aiMatches: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: true, meetingCalendar: true, dataExport: true,
    supportTier: "priority", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  enterprise: {
    maxJobs: Infinity, seats: Infinity,
    parseApplicant: Infinity, resumeUploads: Infinity,
    aiRunsPerMonth: Infinity, aiInsightsPerMonth: Infinity, interviewQuestionsPerMonth: Infinity,
    aiMatches: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: true, meetingCalendar: true, dataExport: true,
    supportTier: "dedicated", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
};
// Fail closed. An unrecognised tier falls back to the most restrictive plan,
// never the most generous one, or a stray plan string quietly grants Elite.
export const planLimits = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.launch;

/* deploy nudge: interviewer meter + Open Positions nav (see git log e41e4b9) */
