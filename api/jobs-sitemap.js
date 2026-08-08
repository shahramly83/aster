// The list of open roles, so Google has something to crawl rather than waiting
// to stumble across a link.
// ---------------------------------------------------------------------------
// Apply pages are not linked from anywhere Google reliably follows: they are
// shared into LinkedIn posts and WhatsApp messages. Without a sitemap the
// JobPosting markup on them could sit unread for weeks, and a role that closes
// in three weeks is not worth discovering in four.
//
// Built fresh on every request from the same list the aggregator feed uses, so
// a closed or expired role leaves the sitemap the moment it closes rather than
// lingering until someone regenerates a file. Google penalises a jobs sitemap
// full of dead postings.
//
// Only opted-in workspaces appear, matching the feed: a company that has not
// asked to be advertised should not be handed to a search engine either.
//
// URLs are the apex (hireaster.com/apply/<id>) rather than the workspace
// subdomain the feed publishes. A sitemap may only list URLs on its own host
// unless every host is separately verified in Search Console, and the apply
// page serves identically on both. The canonical tag on the page points here
// too, so the two hosts do not compete as duplicates.
const config = () => ({
  url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
});

const xmlEscape = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hireaster.com";
  const origin = `${proto}://${host}`;

  const { url: supabaseUrl, anon } = config();
  if (!supabaseUrl || !anon) {
    res.statusCode = 503;
    return res.end("sitemap unavailable");
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

  // An empty sitemap reads as "every role withdrawn". A 503 makes the crawler
  // come back and keep what it already has, exactly as with the feed.
  if (!Array.isArray(jobs)) {
    res.statusCode = 503;
    res.setHeader("Retry-After", "600");
    return res.end("sitemap temporarily unavailable");
  }

  const rows = jobs.map((j) => {
    const loc = `${origin}/apply/${j.id}`;
    // A job's own timestamp, so a crawler can tell an edited posting from an
    // untouched one rather than refetching everything.
    const mod = j.created_at ? new Date(j.created_at).toISOString().slice(0, 10) : null;
    return [
      "  <url>",
      `    <loc>${xmlEscape(loc)}</loc>`,
      mod ? `    <lastmod>${mod}</lastmod>` : null,
      "    <changefreq>daily</changefreq>",
      "  </url>",
    ].filter(Boolean).join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400");
  res.statusCode = 200;
  res.end(xml);
}
