// Build-time prerender: snapshots each marketing route to static HTML so
// non-JS crawlers (social/AI scrapers) and "View Source" see full content +
// the correct per-route <title>/description/canonical.
//
// Browser: uses the system Chrome locally, and @sparticuz/chromium (a Chromium
// built for serverless/Linux build images) on Vercel. puppeteer-core and the
// chromium binary are imported dynamically inside a try/catch, so a missing or
// unlaunchable browser degrades to a plain SPA build rather than failing.
//
// Runs after `vite build`. Serves dist/ with SPA fallback, visits each route,
// waits for React to render, and writes dist/<route>/index.html.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOG_POSTS, BLOG_CATEGORIES, GLOSSARY_TERMS } from "../src/resources-content.js";
import { COMPARE_COMPETITORS } from "../src/comparison-content.js";

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
  // Comparisons
  "/compare",
  "/compare/alternatives",
  ...COMPARE_COMPETITORS.map((c) => `/compare/${c.slug}`),
  // Trust & security
  "/trust", "/trust/compliance",
  // Legal
  "/legal/privacy", "/legal/terms", "/legal/dpa", "/legal/cookies", "/legal/aup", "/legal/subprocessors", "/legal/data-deletion",
  // Support / onboarding
  "/getting-started",
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
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Linux (local/CI where Chrome is installed)
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null; // no system browser → use the bundled serverless Chromium
}

// Launch a headless browser. Prefers system Chrome (local/CI); falls back to the
// @sparticuz/chromium binary that runs on Vercel's Linux build image. Imports are
// dynamic so a missing package throws here and is caught by run()'s try/catch.
async function launchBrowser() {
  const puppeteer = (await import("puppeteer-core")).default;
  const sys = findChrome();
  if (sys) {
    console.log("[prerender] Using system browser.");
    return puppeteer.launch({ executablePath: sys, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  console.log("[prerender] No system browser found; using bundled @sparticuz/chromium.");
  const chromium = (await import("@sparticuz/chromium")).default;
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    executablePath,
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
  });
}

async function run() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/index.html not found — run `vite build` first.");
    process.exit(1);
  }
  const server = await serveDist();
  let browser;
  try {
    browser = await launchBrowser();
  } catch (e) {
    // Any failure (no browser, missing package, launch error) degrades to an SPA
    // build so the deploy stays green. Per-route meta still updates via JS.
    console.warn(`\n[prerender] Could not launch a browser (${e.message.split("\n")[0]}) — skipping prerender, deploying as SPA.\n`);
    server.close();
    return;
  }
  console.log(`Prerendering ${ROUTES.length} routes…`);

  let ok = 0, failed = [];
  for (const route of ROUTES) {
    const page = await browser.newPage();
    try {
      // domcontentloaded, not networkidle0: the real render signal is the
      // waitForFunction below (React has mounted #root + an <h1>). Waiting for
      // the network to go fully idle is redundant here and can drag each route
      // toward its timeout when the app keeps a connection warm (Supabase, fonts),
      // which is what made the whole prerender pass take 20+ minutes on Vercel.
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
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
  // Note failures but never fail the build over them — a green deploy that falls
  // back to SPA for a route beats a blocked deploy.
  if (failed.length) console.warn(`[prerender] ${failed.length} route(s) fell back to SPA rendering.`);
}

// Prerendering is a progressive enhancement; any error degrades to an SPA build
// rather than blocking the deploy.
run().catch((e) => { console.warn(`[prerender] Non-fatal error, deploying as SPA: ${e.message}`); });
