// AI Experience Insights — derived from the parsed resume so every candidate
// profile shows substantive analysis (total/leadership/domain experience,
// employer count, tenure, career progression, gaps). Mirrors the web app's
// deriveInsights so mobile and web produce identical insight cards. Stands in
// for the stored Claude analysis (candidates.experience_insights) when absent.

const LEADERSHIP_RE = /\b(senior|lead|principal|staff|head|director|manager|chief|vp|vice president|founder|co-?founder|president|partner)\b/i;
const DOMAIN_SHORT = {
  "Finance & Fintech": "Fintech", "E-commerce & Retail": "E-commerce", "Media & Creative": "Media",
  "Logistics & Operations": "Logistics", "Travel & Aviation": "Travel", "Professional Services": "Consulting",
  Technology: "Tech", Healthcare: "Healthcare",
};
const ENTERPRISE_COMPANIES = new Set(["MDEC", "iPay88", "Maybank", "Shopee", "Pos Malaysia", "Naga DDB", "Leo Burnett", "AirAsia", "Gleneagles Hospital", "KPMG"]);
const STARTUP_COMPANIES = new Set(["Grabtech", "Grab", "Setel", "StoreHub", "Piktochart", "Oryx Studio", "MoneyLion", "StashAway", "Fave", "Carsome", "FashionValet", "iflix", "Studio Kite"]);

function parseDuration(duration) {
  const nowY = new Date().getFullYear();
  const s = String(duration || "");
  const present = /present|current|now/i.test(s);
  const yrs = (s.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  if (!yrs.length) return null;
  const start = yrs[0];
  const end = present ? nowY : (yrs[1] ?? yrs[0]);
  return { start, end: Math.max(end, start) };
}
function roleMonths(duration) {
  const p = parseDuration(duration);
  if (!p) return 12;
  return Math.max(12, (p.end - p.start) * 12);
}

// Compute { experience_insights, employment_analysis } from a candidate's parsed
// resume. Returns null when there's nothing to analyse.
export function deriveInsights(candidate) {
  const p = candidate?.parsed || {};
  const exp = (p.experience || []).filter(Boolean);
  const raw = exp.map((e) => ({ e, months: roleMonths(e.duration) }));
  const rawTotal = raw.reduce((s, r) => s + r.months, 0);
  if (!exp.length && p.years_of_experience == null) return null;
  const totalYears = p.years_of_experience != null ? p.years_of_experience : Math.max(1, Math.round((rawTotal / 12) * 10) / 10);
  const scale = (p.years_of_experience != null && rawTotal > 0) ? (p.years_of_experience * 12) / rawTotal : 1;
  const sm = (r) => r.months * scale;
  const yrs = (m) => Math.round((m / 12) * 10) / 10;

  const leadershipMonths = raw.filter((r) => LEADERSHIP_RE.test(r.e.title || "")).reduce((s, r) => s + sm(r), 0);

  const domainMonths = {};
  raw.forEach((r) => { const ind = r.e.industry && !/^unknown$/i.test(String(r.e.industry)) ? String(r.e.industry).trim() : null; if (ind) domainMonths[ind] = (domainMonths[ind] || 0) + sm(r); });
  const domain_experience = Object.entries(domainMonths)
    .map(([d, m]) => ({ domain: DOMAIN_SHORT[d] || d, years: yrs(m) }))
    .filter((x) => x.years > 0).sort((a, b) => b.years - a.years).slice(0, 3);

  const companies = raw.map((r) => r.e.company).filter(Boolean);
  const enterprise = companies.some((c) => ENTERPRISE_COMPANIES.has(c));
  const startup = companies.some((c) => STARTUP_COMPANIES.has(c));
  const hay = `${p.summary || ""} ${exp.map((e) => e.summary || "").join(" ")} ${p.location || ""}`.toLowerCase();
  const remote = /\bremote\b|work from home|distributed team|hybrid/.test(hay);

  const distinct = [...new Set(companies)];
  const tenures = raw.map((r) => ({ company: r.e.company, months: Math.round(sm(r)) }));
  const avg = tenures.length ? Math.round(tenures.reduce((s, t) => s + t.months, 0) / tenures.length) : null;
  const longest = tenures.length ? tenures.reduce((a, b) => (b.months > a.months ? b : a)) : null;

  const rt = Math.round(totalYears);
  let progression;
  if (exp.length >= 2) {
    const first = exp[exp.length - 1], last = exp[0];
    progression = `Progressed from ${first.title} at ${first.company} to ${last.title} at ${last.company} across ${rt} year${rt === 1 ? "" : "s"}${yrs(leadershipMonths) >= 1 ? ", stepping into leadership along the way" : ""}.`;
  } else if (exp.length === 1) {
    const e0 = exp[0];
    const focus = (p.skills || []).slice(0, 2).join(" and ");
    progression = `${rt} year${rt === 1 ? "" : "s"} at ${e0.company} as ${e0.title}${focus ? `, with deep hands-on work in ${focus}` : ""}.`;
  } else {
    progression = "The resume lists no dated roles, so a progression can't be inferred.";
  }

  const ranges = raw.map((r) => parseDuration(r.e.duration)).filter(Boolean).sort((a, b) => a.start - b.start);
  const gaps = [];
  for (let i = 1; i < ranges.length; i++) {
    const g = ranges[i].start - ranges[i - 1].end;
    if (g >= 1) gaps.push({ start: String(ranges[i - 1].end), end: String(ranges[i].start), duration_months: g * 12 });
  }

  return {
    experience_insights: {
      total_experience_years: totalYears,
      leadership_experience_years: yrs(leadershipMonths),
      domain_experience,
      startup_experience: startup,
      enterprise_experience: enterprise,
      remote_work_mentioned: remote,
    },
    employment_analysis: {
      number_of_employers: distinct.length,
      average_tenure_months: avg,
      longest_tenure: longest ? { company: longest.company, months: longest.months } : null,
      career_progression: progression,
      employment_gaps: gaps,
    },
  };
}

export function fmtYears(years) {
  if (years == null) return "—";
  return `${years} ${years <= 1 ? "year" : "years"}`;
}
export function fmtMonths(months) {
  if (months == null) return "—";
  if (months >= 12) return fmtYears(Math.round((months / 12) * 10) / 10);
  return `${months} ${months === 1 ? "month" : "months"}`;
}
