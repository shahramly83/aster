// Pipeline stages, kept identical to the web app so both clients label and colour
// a candidate's stage the same way. Mirror of JOB_STAGES in resume-ai-preview.jsx.

export const JOB_STAGES = [
  { key: "applied", label: "Applied", color: "#0B2AE0" },
  { key: "shortlisted", label: "Shortlisted", color: "#93C5FD" },
  { key: "interviewing", label: "Interview", color: "#6366F1" },
  { key: "offer", label: "Offer", color: "#F59E0B" },
  { key: "hired", label: "Hired", color: "#16A34A" },
  { key: "declined", label: "Declined", color: "#9CA3AF" },
  { key: "rejected", label: "Rejected", color: "#F87171" },
];

const STAGE_BY_KEY = Object.fromEntries(JOB_STAGES.map((s) => [s.key, s]));

export const stageLabel = (key) => STAGE_BY_KEY[key]?.label || "Applied";
export const stageColor = (key) => STAGE_BY_KEY[key]?.color || "#0B2AE0";

// Empty-then-count map for a job's pipeline, matching stageCountsFor on web.
export function emptyStageCounts() {
  return { applied: 0, shortlisted: 0, interviewing: 0, offer: 0, hired: 0, declined: 0, rejected: 0 };
}
