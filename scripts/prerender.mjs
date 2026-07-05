// Build-time prerender: snapshots each marketing route to static HTML so
// non-JS crawlers (social/AI scrapers) and "View Source" see full content +
// the correct per-route <title>/description/canonical. Drives the system
// Chrome via puppeteer-core (no Chromium download).
//
// Runs after `vite build`. Serves dist/ with SPA fallback, visits each route,
// waits for React to render, and writes dist/<route>/index.html.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { BLOG_POSTS, BLOG_CATEGORIES, GLOSSARY_TERMS } from "../src/resources-content.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const PORT = 4319;

// The indexable marketing routes (mirrors PAGE_META / sitemap.xml).
const ROUTES = [
  "/",
  "/product", "/product/sourcing", "/product/ats", "/product/ai",
  "/product/interviews", "/product/offers", "/product/analytics",
  "/product/career-site", "/product/collaboration", "/product/automation",
  "/product/integrations", "/product/changelog",
  "/solutions", "/solutions/recruiters", "/solutions/hiring-managers",
  "/solutions/talent-leaders", "/solutions/people-ops", "/solutions/founders",
  "/solutions/startups", "/solutions/scaleups", "/solutions/enterprise",
  "/solutions/agencies",
  "/solutions/industries/technology", "/solutions/industries/healthcare",
  "/solutions/industries/retail", "/solutions/industries/professional-services",
  "/solutions/industries/manufacturing",
  // Resources — blog + glossary (derived from src/resources-content.js so they
  // stay in sync as content is added).
  "/blog",
  ...BLOG_CATEGORIES.map((c) => `/blog/category/${c.slug}`),
  ...BLOG_POSTS.map((p) => `/blog/${p.slug}`),
  "/resources/glossary",
  ...GLOSSARY_TERMS.map((t) => `/resources/glossary/${t.slug}`),
];

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain",
  ".xml": "application/xml",
};

// Tiny static server with SPA fallback → index.html for unknown paths.
function serveDist() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        let filePath = join(DIST, urlPath);
        if (urlPath.endsWith("/")) filePath = join(filePath, "index.html");
        if (!existsSync(filePath) || !extname(filePath)) {
          filePath = join(DIST, "index.html"); // SPA fallback
        }
        const body = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404); res.end("not found");
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("No Chrome/Edge executable found for prerendering.");
}

async function run() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/index.html not found — run `vite build` first.");
    process.exit(1);
  }
  const server = await serveDist();
  const executablePath = findChrome();
  console.log(`Prerendering ${ROUTES.length} routes with ${executablePath.split("\\").pop()}…`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let ok = 0, failed = [];
  for (const route of ROUTES) {
    const page = await browser.newPage();
    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle0", timeout: 30000 });
      // Wait until React has rendered real content into #root.
      await page.waitForFunction(
        () => {
          const r = document.getElementById("root");
          return r && r.children.length > 0 && document.querySelector("h1");
        },
        { timeout: 20000 }
      );
      // Let the per-route <title>/meta/canonical effect + short animations settle.
      await new Promise((r) => setTimeout(r, 400));

      const html = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));
      const outDir = route === "/" ? DIST : join(DIST, route);
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, "index.html"), html, "utf8");

      const title = await page.title();
      console.log(`  ✓ ${route.padEnd(42)} → ${title.slice(0, 48)}`);
      ok++;
    } catch (e) {
      console.warn(`  ✗ ${route} — ${e.message.split("\n")[0]}`);
      failed.push(route);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.close();
  console.log(`\nPrerendered ${ok}/${ROUTES.length} routes.${failed.length ? " Failed: " + failed.join(", ") : ""}`);
  if (failed.length) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
