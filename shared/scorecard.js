// Collaborative scorecard model. Kept in lockstep with the web app
// (SCORE_CRITERIA / RECOMMENDATIONS / recommendationFromRatings in
// resume-ai-preview.jsx) so a card submitted from mobile renders identically on
// desktop and averages into the same team score.

// Four criteria, each rated 1..4. The rating keys are the column keys stored in
// scorecards.ratings (jsonb), so they MUST NOT be renamed without a migration.
export const SCORE_CRITERIA = [
  { key: "technical", label: "Technical skills" },
  { key: "communication", label: "Communication" },
  { key: "cultureFit", label: "Culture fit" },
  { key: "experience", label: "Experience" },
];

export const RECOMMENDATIONS = [
  { key: "strong_yes", label: "Strong yes", color: "#166534", bg: "#DCFCE7" },
  { key: "yes", label: "Yes", color: "#15803D", bg: "#F0FDF4" },
  { key: "no", label: "No", color: "#B91C1C", bg: "#FEF2F2" },
  { key: "strong_no", label: "Strong no", color: "#991B1B", bg: "#FEE2E2" },
];

const REC_BY_KEY = Object.fromEntries(RECOMMENDATIONS.map((r) => [r.key, r]));
export const recommendationMeta = (key) => REC_BY_KEY[key] || REC_BY_KEY.yes;

// Turn scorecard ratings into the hire recommendation. Byte-for-byte the same
// thresholds as recommendationFromRatings() on web.
export function recommendationFromRatings(ratings) {
  const vals = Object.values(ratings || {}).filter((n) => typeof n === "number");
  if (!vals.length) return "yes";
  const avg = vals.reduce((s, n) => s + n, 0) / vals.length;
  return avg >= 3.6 ? "strong_yes" : avg >= 2.8 ? "yes" : avg >= 2 ? "no" : "strong_no";
}

// Average of the rated criteria (0 when nothing rated), for a compact display.
export function averageRating(ratings) {
  const vals = Object.values(ratings || {}).filter((n) => typeof n === "number");
  if (!vals.length) return 0;
  return vals.reduce((s, n) => s + n, 0) / vals.length;
}
