// The XML feed job aggregators read to republish our customers' open roles.
// ---------------------------------------------------------------------------
// Adzuna, Jooble, Careerjet and Talent.com do not have their own jobs. They
// crawl a feed file once or twice a day and publish whatever they find. So a
// customer opens a role in Aster and it appears on those sites by tomorrow,
// with nobody retyping anything: this file is the entire integration.
//
// Two dialects, because there are two conventions and no aggregator reads both:
//   * "source"  - the <source><job> layout Indeed defined. Adzuna, Careerjet,
//                 Talent.com, Jora and WhatJobs all read this one.
//   * "jooble"  - <jobs><job id=""> with <name>/<link>/<region>.
// Indeed itself is not a target: it stopped collecting organic XML feeds on
// 2026-03-31. Its format outlived it, which is why the default dialect is still
// shaped this way.
//
// Only opted-in workspaces appear (companies.feed_enabled, migration 0172), and
// list_feed_jobs already drops closed, expired and credit-blocked roles.
//
// Runs on the Node runtime, like api/apply.js, and reads the same anon key: the
// feed is public by definition, so there is nothing here a visitor to the apply
// page could not already see.

// Shared with the JobPosting markup on the apply page, so the description an
// aggregator republishes and the one Google reads cannot drift apart.
import {
  descriptionHtml, countryCode, placeOf, salaryOf, BOARD_LABELS,
} from "../shared/job-posting.js";

// Read per request rather than at module load. A serverless instance is reused
// across invocations either way, so this costs nothing, and it keeps the
// missing-configuration path reachable from a test.
const config = () => ({
  url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
});

// Text destined for a CDATA block. The only sequence that can break out of one
// is "]]>", which closes it early and turns the rest of the description into
// malformed markup; splitting it across two blocks keeps the bytes identical to
// a parser while making it inert.
const cdata = (s) => `<![CDATA[${String(s ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

const tag = (name, value) => `      <${name}>${cdata(value)}</${name}>`;

// An attribute value is not text content: CDATA is illegal there and a parser
// rejects the whole document on the unescaped "<" that starts it. Attributes
// take entity escaping and nothing else.
const attr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// "full_time" is a database key. Aggregators match on their own vocabulary, and
// an unrecognised value is treated as no value at all, so the job silently
// loses its filter placement rather than erroring.
const JOB_TYPE = {
  full_time: "fulltime", fulltime: "fulltime",
  part_time: "parttime", parttime: "parttime",
  contract: "contract", temporary: "temporary", internship: "internship",
};

const REMOTE_TYPE = { remote: "Fully remote", hybrid: "Hybrid remote" };

// Monthly, because that is what generate-job-draft produces and what the apply
// page shows. A range published as an annual figure by mistake is the kind of
// error that reaches candidates before it reaches us.
function salaryLabel(details) {
  const s = salaryOf(details);
  if (!s) return "";
  const n = (v) => Number(v).toLocaleString("en-US");
  const body = s.min === s.max ? n(s.min) : `${n(s.min)} - ${n(s.max)}`;
  return `${s.currency ? s.currency + " " : ""}${body} per month`.trim();
}

// Same default as the app's APEX_ROOT, so the two agree on what a workspace
// address looks like.
const APEX_ROOT = (process.env.VITE_APEX_ROOT || "hireaster.com").toLowerCase();

// The link an aggregator publishes is the company's, not Aster's, so it points
// at the workspace's own address (<slug>.hireaster.com) exactly like every
// other apply link the product hands out. A candidate on Adzuna should see the
// employer they are applying to, not their ATS vendor.
//
// The apex is the fallback for a workspace with no slug, and for any host that
// is not the apex at all (a preview deploy), where a made-up subdomain would
// simply fail to resolve.
function applyOrigin(origin, slug) {
  const s = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s) return origin;
  const host = origin.replace(/^https?:\/\//, "").toLowerCase();
  if (host !== APEX_ROOT && !host.endsWith(`.${APEX_ROOT}`)) return origin;
  return `https://${s}.${APEX_ROOT}`;
}

// One aggregator per feed URL (?source=adzuna), so every applicant arrives
// already tagged with the site that sent them and the existing source reporting
// answers "which board is actually worth it" with no extra work.
function applyUrl(origin, job, source) {
  const s = String(source || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  return `${applyOrigin(origin, job.company_slug)}/apply/${job.id}${s ? `?source=${s}` : ""}`;
}

function renderSource(jobs, origin, source) {
  const rows = jobs.map((j) => {
    const d = j.details || {};
    const p = placeOf(j);
    return [
      "    <job>",
      tag("title", j.title),
      tag("date", new Date(j.created_at).toISOString()),
      tag("referencenumber", j.id),
      tag("url", applyUrl(origin, j, source)),
      tag("company", j.company_name),
      tag("sourcename", "Aster"),
      tag("city", p.city),
      tag("state", p.state),
      tag("country", countryCode(p.country)),
      tag("description", descriptionHtml(d, BOARD_LABELS)),
      tag("salary", salaryLabel(d)),
      tag("jobtype", JOB_TYPE[String(d.employment_type || "").toLowerCase()] || ""),
      tag("category", d.department || ""),
      tag("remotetype", REMOTE_TYPE[String(d.work_mode || d.remote_type || "").toLowerCase()] || ""),
      tag("expirationdate", j.expires_at || ""),
      "    </job>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<source>",
    `  <publisher>${cdata("Aster")}</publisher>`,
    `  <publisherurl>${cdata(origin)}</publisherurl>`,
    `  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>`,
    ...rows,
    "</source>",
    "",
  ].join("\n");
}

function renderJooble(jobs, origin, source) {
  const rows = jobs.map((j) => {
    const d = j.details || {};
    const p = placeOf(j);
    // <region> is the field Jooble places a job from, so the country belongs in
    // the string itself: "Seri Kembangan, Selangor" alone leaves the listing to
    // be positioned by inference. The readable country name is used here rather
    // than the ISO code that <country> carries, because this field is shown to
    // candidates.
    const region = [p.city, p.state, p.country].filter(Boolean).join(", ");
    return [
      `    <job id="${attr(j.id)}">`,
      tag("name", j.title),
      tag("link", applyUrl(origin, j, source)),
      tag("region", region),
      tag("country", countryCode(p.country)),
      tag("company", j.company_name),
      tag("description", descriptionHtml(d, BOARD_LABELS)),
      tag("salary", salaryLabel(d)),
      tag("jobtype", JOB_TYPE[String(d.employment_type || "").toLowerCase()] || ""),
      tag("pubdate", new Date(j.created_at).toISOString()),
      tag("expire", j.expires_at || ""),
      "    </job>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<jobs>",
    ...rows,
    "</jobs>",
    "",
  ].join("\n");
}

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hireaster.com";
  const origin = `${proto}://${host}`;

  const dialect = String(req.query?.dialect || "source").toLowerCase();
  const source = req.query?.source || "";

  const { url: supabaseUrl, anon } = config();
  if (!supabaseUrl || !anon) {
    res.statusCode = 503;
    return res.end("feed unavailable");
  }

  let jobs = null;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/list_feed_jobs`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.ok) jobs = await r.json();
  } catch { /* handled below */ }

  // A failed lookup must not render as an empty feed. An aggregator reading
  // zero jobs concludes every role was withdrawn and delists the lot, and
  // getting them back means waiting for the next crawl. A 503 makes it retry
  // and keep what it already has.
  if (!Array.isArray(jobs)) {
    res.statusCode = 503;
    res.setHeader("Retry-After", "600");
    return res.end("feed temporarily unavailable");
  }

  const xml = dialect === "jooble"
    ? renderJooble(jobs, origin, source)
    : renderSource(jobs, origin, source);

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  // Crawlers pull this at most a few times a day, and a role opened this
  // morning appearing in tonight's crawl is the whole point, so the window is
  // short. stale-while-revalidate keeps a crawl fast even on a cold cache.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400");
  res.statusCode = 200;
  res.end(xml);
}
