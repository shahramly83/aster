// Plan tiers: the limits table and the tolerant lookups around it.
// Extracted from the app so the fallback can be regression-tested — an
// unrecognised tier once fell through to Elite's limits (the failed-open bug).

export const PLAN_TIER_ALIASES = { free: "launch", growth: "scale", pro: "elite" };

export const PLAN_LIMITS = {
  launch: {
    maxJobs: 1, seats: 1, interviewers: 10, canAddInterviewers: true,
    parseApplicant: 100, resumeUploads: 10,               // resumeUploads = AI Parsing (Bulk upload)
    aiRunsPerMonth: 5, aiInsightsPerMonth: 5, interviewQuestionsPerMonth: 5,
    aiMatches: 3, visibleCandidates: Infinity,
    applicantViewLimit: 10, browseLimit: 10, skillsIndustriesLimit: 10,
    showRationale: true, storeOriginal: false, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: false, meetingCalendar: false, dataExport: true,
    supportTier: "ticket", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  scale: {
    maxJobs: 5, seats: 30, interviewers: 100, canAddInterviewers: true,
    parseApplicant: 500, resumeUploads: 50,
    aiRunsPerMonth: 30, aiInsightsPerMonth: 100, interviewQuestionsPerMonth: 100,
    aiMatches: 10, visibleCandidates: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: false, meetingCalendar: true, dataExport: true,
    supportTier: "ticket", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  elite: {
    maxJobs: 10, seats: 100, interviewers: Infinity, canAddInterviewers: true,
    parseApplicant: 1000, resumeUploads: 100,
    aiRunsPerMonth: 100, aiInsightsPerMonth: 300, interviewQuestionsPerMonth: 300,
    aiMatches: Infinity, visibleCandidates: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: true, meetingCalendar: true, dataExport: true,
    supportTier: "priority", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
  enterprise: {
    maxJobs: Infinity, seats: Infinity, interviewers: Infinity, canAddInterviewers: true,
    parseApplicant: Infinity, resumeUploads: Infinity,
    aiRunsPerMonth: Infinity, aiInsightsPerMonth: Infinity, interviewQuestionsPerMonth: Infinity,
    aiMatches: Infinity, visibleCandidates: Infinity,
    applicantViewLimit: Infinity, browseLimit: Infinity, skillsIndustriesLimit: Infinity,
    showRationale: true, storeOriginal: true, scorecards: true, matchToRole: true, databaseAiRank: true,
    twoFactor: true, whatsapp: true, meetingCalendar: true, dataExport: true,
    supportTier: "dedicated", sso: false, auditLogs: false, whiteLabel: false, retentionDays: 365,
  },
};
// Fail closed. An unrecognised tier falls back to the most restrictive plan,
// never the most generous one, or a stray plan string quietly grants Elite.
export const planLimits = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.launch;
