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
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// Text destined for a CDATA block. The only sequence that can break out of one
// is "]]>", which closes it early and turns the rest of the description into
// malformed markup; splitting it across two blocks keeps the bytes identical to
// a parser while making it inert.
const cdata = (s) => `<![CDATA[${String(s ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

// Escaping for text we are about to place inside HTML we generate ourselves.
// The description is assembled as real HTML (aggregators render it as markup),
// so a "&" or "<" typed into a job description has to be neutralised before it
// becomes part of that markup, CDATA or not.
const htm = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const tag = (name, value) => `      <${name}>${cdata(value)}</${name}>`;

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
function salaryLabel(d) {
  const min = Number(d.salary_min) || 0;
  const max = Number(d.salary_max) || 0;
  if (!min && !max) return "";
  const cur = String(d.salary_currency || "").toUpperCase();
  const n = (v) => Number(v).toLocaleString("en-US");
  const body = min && max
    ? (min === max ? n(min) : `${n(min)} - ${n(max)}`)
    : `${n(min || max)}+`;
  return `${cur ? cur + " " : ""}${body} per month`.trim();
}

// Aggregators want city / state / country as three fields and place the job on
// a map from them; Indeed's spec is explicit that a job without them gets no
// organic visibility. Aster stores the job's location as one free-text string,
// so the city comes from whatever the recruiter typed (first segment, since
// "Kuala Lumpur, Malaysia" is as common as "Kuala Lumpur") and the rest falls
// back to the company's registered address. That is wrong for a company hiring
// outside its own address, which is the case a structured location field on the
// job would fix.
function placeOf(job) {
  const raw = String(job.details?.location || "").trim();
  const first = raw.split(",")[0].trim();
  // "Remote" is a working arrangement, not a city. Left in the city field it
  // puts the role in a town called Remote.
  const cityish = /^(remote|anywhere|work from home|wfh)$/i.test(first) ? "" : first;
  return {
    city: cityish || job.address_city || "",
    state: job.address_state || "",
    country: job.address_country || "",
  };
}

// The feed description has to match what the apply page shows, in the same
// order: several aggregators compare the two and reject feeds that pad the
// description with content the landing page does not have.
function descriptionHtml(d) {
  const out = [];
  const prose = String(d.description || "").trim();
  if (prose) {
    for (const para of prose.split(/\n{2,}/)) {
      const p = para.trim();
      if (p) out.push(`<p>${htm(p).replace(/\n/g, "<br />")}</p>`);
    }
  }
  const list = (heading, items) => {
    if (!Array.isArray(items) || !items.length) return;
    out.push(`<h3>${heading}</h3><ul>`);
    for (const it of items) {
      const t = String(it || "").trim();
      if (t) out.push(`<li>${htm(t)}</li>`);
    }
    out.push("</ul>");
  };
  list("Responsibilities", d.responsibilities);
  list("Requirements", d.requirements);
  list("Benefits", d.benefits);
  return out.join("");
}

// One aggregator per feed URL (?source=adzuna), so every applicant arrives
// already tagged with the site that sent them and the existing source reporting
// answers "which board is actually worth it" with no extra work.
function applyUrl(origin, id, source) {
  const s = String(source || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  return `${origin}/apply/${id}${s ? `?source=${s}` : ""}`;
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
      tag("url", applyUrl(origin, j.id, source)),
      tag("company", j.company_name),
      tag("sourcename", "Aster"),
      tag("city", p.city),
      tag("state", p.state),
      tag("country", p.country),
      tag("description", descriptionHtml(d)),
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
    const region = [p.city, p.state].filter(Boolean).join(", ") || p.country;
    return [
      `    <job id="${cdata(j.id)}">`,
      tag("name", j.title),
      tag("link", applyUrl(origin, j.id, source)),
      tag("region", region),
      tag("country", p.country),
      tag("company", j.company_name),
      tag("description", descriptionHtml(d)),
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

  if (!SUPABASE_URL || !ANON) {
    res.statusCode = 503;
    return res.end("feed unavailable");
  }

  let jobs = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_feed_jobs`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
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
