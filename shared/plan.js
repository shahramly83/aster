// Plan tiers: the limits table and the tolerant lookups around it.
// Kept identical to src/lib/plan.js in the web app. An unrecognised tier falls
// back to the most restrictive plan, never the most generous one.

export const PLAN_TIER_ALIASES = { free: "launch", growth: "scale", pro: "elite" };

export const PLAN_LIMITS = {
  launch: {
    maxJobs: 1, seats: Infinity,
    parseApplicant: 100, resumeUploads: 10,
    aiRunsPerMonth: 5, aiInsightsPerMonth: 5, interviewQuestionsPerMonth: 5,
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

// Fail closed: an unrecognised tier gets the most restrictive plan's limits.
export const planLimits = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.launch;

// The role vocabulary stored in profiles.role, mapped to display labels.
export const ROLE_LABELS = { owner: "Tenant", admin: "Hiring Manager", recruiter: "Recruiter", interviewer: "Interviewer" };

// Managers (owner/admin/recruiter) run the pipeline: they see every role, move
// candidates through all stages, and get the dashboard. Interviewers are the
// least-privilege role, scoped to the panels they're on. Anything not clearly a
// manager falls to the interviewer experience (fail closed to less access).
export const MANAGER_ROLES = ["owner", "admin", "recruiter"];
export const isManagerRole = (role) => MANAGER_ROLES.includes(role);
