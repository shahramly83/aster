// Server-rendered share tags for /apply/:id.
// ---------------------------------------------------------------------------
// vercel.json rewrites everything to a static index.html, whose Open Graph tags
// are Aster's own. LinkedIn, WhatsApp and Slack do not run JavaScript, so every
// job a company shared previewed as "Aster: AI Recruitment Software" with our
// stock image, no matter whose role it was.
//
// This returns the same index.html with the tags rewritten for the job, so the
// crawler sees the company and the role. The human gets identical HTML and the
// app boots exactly as before: no user-agent sniffing, nothing served to a
// crawler that a visitor would not also get.
//
// Only public, already-anonymous fields are used. get_public_job (0068) refuses
// drafts and deleted companies, so an unpublished role cannot be unmasked by
// guessing its id.
import { jobPostingLd } from "../shared/job-posting.js";

// Read per request rather than at module load. A serverless instance is reused
// across invocations either way, so this costs nothing, and it keeps the
// configuration deterministic for a test rather than depending on whatever the
// machine's .env happened to hold when the module was first imported.
const config = () => ({
  url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
});

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Replace the content of one meta tag, whichever attribute order it uses.
function setMeta(html, attr, name, value) {
  const re = new RegExp(`(<meta[^>]*${attr}=["']${name}["'][^>]*content=["'])[^"']*(["'][^>]*>)`, "i");
  if (re.test(html)) return html.replace(re, `$1${esc(value)}$2`);
  const re2 = new RegExp(`(<meta[^>]*content=["'])[^"']*(["'][^>]*${attr}=["']${name}["'][^>]*>)`, "i");
  if (re2.test(html)) return html.replace(re2, `$1${esc(value)}$2`);
  return html.replace(/<\/head>/i, `  <meta ${attr}="${name}" content="${esc(value)}" />\n</head>`);
}

// The same role is reachable at the apex and at every workspace subdomain, and
// now that /apply is crawlable those would compete as duplicates of each other.
// The apex is named as the canonical one because it is the host the jobs
// sitemap can list: a sitemap may only carry URLs on its own host unless every
// subdomain is separately verified in Search Console.
const APEX_ROOT = (process.env.VITE_APEX_ROOT || "hireaster.com").toLowerCase();

function canonicalOrigin(origin) {
  const host = origin.replace(/^https?:\/\//, "").toLowerCase();
  // A preview deploy has no relationship to the apex, so it keeps its own host
  // rather than pointing its pages at production.
  if (host !== APEX_ROOT && !host.endsWith(`.${APEX_ROOT}`)) return origin;
  return `https://${APEX_ROOT}`;
}

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hireaster.com";
  const origin = `${proto}://${host}`;

  // /index.html is not itself rewritten, so fetching it cannot loop back here.
  let html = "";
  try {
    const r = await fetch(`${origin}/index.html`, { headers: { "x-og-passthrough": "1" } });
    html = await r.text();
  } catch {
    res.statusCode = 302;
    res.setHeader("Location", "/index.html");
    return res.end();
  }

  const id = String(req.query?.id || "").trim();
  // A malformed id is a 404 in the app anyway; serving the untouched shell is
  // better than serving a card describing a job that does not exist.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const { url: supabaseUrl, anon } = config();
  let job = null;
  if (isUuid && supabaseUrl && anon) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_job`, {
        method: "POST",
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_job_id: id }),
      });
      if (r.ok) {
        const rows = await r.json();
        job = Array.isArray(rows) ? rows[0] : rows;
      }
    } catch { /* fall through to the untouched shell */ }
  }

  if (job?.title) {
    const d = job.details || {};
    // Location and type when the role carries them, because "Kuala Lumpur ·
    // Full time" is most of what someone decides on from a feed.
    // The database keeps these as enum-ish keys ("full_time"), which is fine in
    // a dropdown and reads as a leaked column name on LinkedIn.
    const human = (s) => String(s).replace(/[_-]+/g, " ").replace(/^./, (m) => m.toUpperCase());
    const bits = [d.location, (d.employment_type || d.type) && human(d.employment_type || d.type)].filter(Boolean);
    const meta = bits.join(" · ");
    const company = job.company_name || "";
    const title = company ? `${job.title} at ${company}` : job.title;
    const desc = [meta, `Apply for ${job.title}${company ? ` at ${company}` : ""}.`].filter(Boolean).join(" · ");
    const url = `${canonicalOrigin(origin)}/apply/${id}`;

    const img = new URL(`${origin}/api/og`);
    img.searchParams.set("title", job.title);
    if (company) img.searchParams.set("company", company);
    if (meta) img.searchParams.set("meta", meta);
    if (job.logo_url) img.searchParams.set("logo", job.logo_url);

    // Warm the card before the crawler asks for it. It reads the head, then
    // fetches og:image moments later; without this that fetch is the one paying
    // the renderer's cold start, times out, and the crawler falls back to any
    // image it can scrape off the page. Not awaited: the HTML must not wait.
    fetch(img.toString(), { headers: { "user-agent": "aster-prewarm" } }).catch(() => {});

    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`);
    html = setMeta(html, "name", "description", desc);
    html = setMeta(html, "property", "og:title", title);
    html = setMeta(html, "property", "og:description", desc);
    html = setMeta(html, "property", "og:url", url);
    html = setMeta(html, "property", "og:image", img.toString());
    html = setMeta(html, "property", "og:image:type", "image/png");
    html = setMeta(html, "property", "og:image:alt", `${job.title}${company ? ` at ${company}` : ""}`);
    html = setMeta(html, "property", "og:type", "article");
    html = setMeta(html, "name", "twitter:card", "summary_large_image");
    html = setMeta(html, "name", "twitter:title", title);
    html = setMeta(html, "name", "twitter:description", desc);
    html = setMeta(html, "name", "twitter:image", img.toString());
    // A closed or expired role should not be indexed, but must still preview:
    // the link keeps circulating either way.
    if (job.status && job.status !== "open") html = setMeta(html, "name", "robots", "noindex");

    // Google for Jobs reads this and puts the role in the jobs panel above the
    // ordinary results. It has to be server-rendered: the block is built from
    // the same record the tags above use, so the markup and the page agree.
    //
    // jobPostingLd returns null for anything that should not be listed (closed,
    // expired, out of credits, or missing a field Google requires), and no
    // markup is strictly better than markup that fails validation.
    // Names one address for a page reachable at both the apex and the
    // workspace subdomain, so the two are not indexed as competing duplicates.
    if (/<link[^>]+rel=["']canonical["']/i.test(html)) {
      html = html.replace(/(<link[^>]+rel=["']canonical["'][^>]*href=["'])[^"']*(["'])/i, `$1${esc(url)}$2`);
    } else {
      html = html.replace(/<\/head>/i, `  <link rel="canonical" href="${esc(url)}" />\n</head>`);
    }

    const ld = jobPostingLd(job, url);
    if (ld) {
      // </script> inside a JSON string would end this block early and spill the
      // rest of the posting into the document as markup.
      const json = JSON.stringify(ld).replace(/<\//g, "<\\/");
      html = html.replace(/<\/head>/i,
        `  <script type="application/ld+json">${json}</script>\n</head>`);
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short cache: a retitled job should not preview under its old name for a
  // day, and crawlers refetch far more often than people reshare.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
  res.statusCode = 200;
  res.end(html);
}
