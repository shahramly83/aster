// Daily brand blog generator.
//
// Writes one on-brand Aster article with Claude Opus 4.8, validates it hard,
// prepends it to src/generated-posts.js, and adds its URL to the sitemap. The
// build (vite + scripts/prerender.mjs) then turns it into a prerendered,
// SEO-indexed page automatically. Run by .github/workflows/daily-blog.yml.
//
// Requires ANTHROPIC_API_KEY in the environment.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { BLOG_POSTS, BLOG_CATEGORIES } from "../src/resources-content.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
// Output paths are overridable so the pipeline can be dry-run against copies.
const GENERATED_PATH = process.env.BLOG_GENERATED_PATH || path.join(ROOT, "src", "generated-posts.js");
const SITEMAP_PATH = process.env.BLOG_SITEMAP_PATH || path.join(ROOT, "public", "sitemap.xml");
// BLOG_DRY_RUN=1 skips the API and uses a fixture, to exercise the plumbing.
const DRY_RUN = process.env.BLOG_DRY_RUN === "1";
const GUIDELINES_PATH = path.join(ROOT, "docs", "brand-guidelines.md");
const ORIGIN = "https://hireaster.com";
const MODEL = "claude-opus-4-8";
const AUTHOR = { name: "Aster", role: "Content Studio" };

const CATEGORY_SLUGS = BLOG_CATEGORIES.map((c) => c.slug);
const today = process.env.POST_DATE || new Date().toISOString().slice(0, 10);

// ---------- helpers ----------
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");

const wordCount = (post) => {
  let text = "";
  for (const b of post.body) {
    if (b.p) text += " " + b.p;
    else if (b.h) text += " " + b.h;
    else if (b.quote) text += " " + b.quote;
    else if (b.note) text += " " + b.note;
    else if (b.ul) text += " " + b.ul.join(" ");
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
};

const detectEol = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

// ---------- schema for structured output ----------
const BLOCK_SCHEMA = {
  anyOf: [
    { type: "object", additionalProperties: false, required: ["h"], properties: { h: { type: "string" } } },
    { type: "object", additionalProperties: false, required: ["p"], properties: { p: { type: "string" } } },
    { type: "object", additionalProperties: false, required: ["ul"], properties: { ul: { type: "array", items: { type: "string" } } } },
    { type: "object", additionalProperties: false, required: ["quote"], properties: { quote: { type: "string" }, cite: { type: "string" } } },
    { type: "object", additionalProperties: false, required: ["note"], properties: { note: { type: "string" }, label: { type: "string" } } },
  ],
};

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "category", "excerpt", "tags", "body"],
  properties: {
    title: { type: "string" },
    category: { type: "string", enum: CATEGORY_SLUGS },
    excerpt: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    body: { type: "array", items: BLOCK_SCHEMA },
  },
};

// ---------- prompt ----------
function buildSystem() {
  const guidelines = fs.readFileSync(GUIDELINES_PATH, "utf8");
  return `You are Aster's content studio, writing one blog article for the Aster marketing site.

Aster is an AI recruitment platform for growing teams: it reads every resume, ranks applicants against the role, and automates interview scheduling.

Follow these brand guidelines exactly:
---
${guidelines}
---

Hard rules for the article:
- NO em dashes (—) anywhere. Use a comma, colon, period, or parentheses instead. This is non-negotiable; an article containing an em dash is rejected.
- Plain-spoken, confident, outcome-first. Never hype-y. No emoji.
- Sentence case for the title (not Title Case).
- 900 to 1300 words of genuinely useful, specific, non-generic writing. No filler, no "in today's fast-paced world" openings.
- Structure with the provided block types. Use several { h } section headings. Open with one or two { p } lede paragraphs (no heading before them). Use { ul } for lists where it helps. Include ONE { quote } pull-quote of a strong, standalone line, and at most one { note } callout ("Worth remembering") for a key takeaway. You may bold a few key phrases inline with **double asterisks**.
- The excerpt is one or two plain sentences (under 160 characters) summarizing the piece for cards and search snippets.
- 3 to 5 short tags.
- Be honest and concrete about what AI can and cannot do in hiring. Do not invent statistics.

Return the article via the structured output format.`;
}

function buildUser() {
  const titles = BLOG_POSTS.map((p) => `- [${p.category}] ${p.title}`).join("\n");
  const counts = Object.fromEntries(CATEGORY_SLUGS.map((s) => [s, 0]));
  for (const p of BLOG_POSTS) if (counts[p.category] != null) counts[p.category]++;
  const leastCovered = CATEGORY_SLUGS.slice().sort((a, b) => counts[a] - counts[b])[0];
  const cats = BLOG_CATEGORIES.map((c) => `- ${c.slug}: ${c.label} (${c.desc})`).join("\n");

  return `Categories:
${cats}

Articles that ALREADY EXIST (do not repeat these topics or angles; pick a genuinely fresh subject):
${titles}

Write a NEW article on a distinct topic. Prefer the "${leastCovered}" category to keep coverage balanced, unless a stronger idea fits another category. Choose a specific, useful angle a hiring team would actually search for. Then write the full article.`;
}

// ---------- validation ----------
function validate(post, existingSlugs) {
  const errors = [];
  if (!post || typeof post !== "object") return ["not an object"];
  if (!post.title || typeof post.title !== "string") errors.push("missing title");
  if (!CATEGORY_SLUGS.includes(post.category)) errors.push(`bad category: ${post.category}`);
  if (!post.excerpt || post.excerpt.length > 200) errors.push("excerpt missing or too long");
  if (!Array.isArray(post.tags) || post.tags.length < 2) errors.push("need >= 2 tags");
  if (!Array.isArray(post.body) || post.body.length < 6) errors.push("body too short");

  const raw = JSON.stringify(post);
  if (raw.includes("—")) errors.push("contains an em dash");
  if (raw.includes("–")) errors.push("contains an en dash");

  const words = wordCount(post);
  if (words < 600) errors.push(`too short (${words} words)`);
  if (words > 2200) errors.push(`too long (${words} words)`);

  const slug = slugify(post.title);
  if (!slug) errors.push("title yields empty slug");
  if (existingSlugs.has(slug)) errors.push(`duplicate slug: ${slug}`);

  const titleLower = post.title.trim().toLowerCase();
  if (BLOG_POSTS.some((p) => p.title.trim().toLowerCase() === titleLower)) errors.push("duplicate title");

  return errors;
}

// ---------- generate ----------
async function generateOnce(client, feedback) {
  const messages = [{ role: "user", content: buildUser() + (feedback ? `\n\nYour previous attempt was rejected: ${feedback}. Fix it.` : "") }];
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: buildSystem(),
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", name: "article", schema: ARTICLE_SCHEMA } },
    messages,
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const FIXTURE = {
  title: "A dry-run fixture article for testing the pipeline",
  category: CATEGORY_SLUGS[0],
  excerpt: "A fixture used only by BLOG_DRY_RUN to exercise the publish plumbing without calling the API.",
  tags: ["testing", "pipeline"],
  body: [
    { p: "This is a dry-run fixture. It exists only so the publish pipeline can be exercised end to end without spending API tokens, and it is never committed to production." },
    { h: "What it checks" },
    { p: "Running the generator with BLOG_DRY_RUN=1 pointed at temporary output paths verifies slug creation, validation, the generated-posts rewrite, and the sitemap splice, all without a network call or a real article." },
    { ul: ["Slug generation from the title", "The generated-posts.js rewrite and re-import", "The sitemap URL insertion"] },
  ],
};

async function main() {
  const existingSlugs = new Set(BLOG_POSTS.map((p) => p.slug));
  let post = null;

  if (DRY_RUN) {
    post = FIXTURE;
    const errors = validate(post, existingSlugs);
    console.log(`DRY RUN — using fixture. Validation: ${errors.length ? "warnings: " + errors.join("; ") : "clean"}`);
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not set.");
      process.exit(1);
    }
    const client = new Anthropic();
    let feedback = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Attempt ${attempt}: generating article...`);
      let draft;
      try {
        draft = await generateOnce(client, feedback);
      } catch (e) {
        // Surface everything useful for CI: HTTP status, API error type, and
        // the response body, not just e.message (which is often opaque).
        console.error(`  generation error: ${e.name || "Error"}: ${e.message}`);
        if (e.status != null) console.error(`  http status: ${e.status}`);
        if (e.error) console.error(`  api error: ${JSON.stringify(e.error)}`);
        else if (e.response?.body) console.error(`  response body: ${JSON.stringify(e.response.body)}`);
        feedback = "the previous output was malformed";
        continue;
      }
      const errors = validate(draft, existingSlugs);
      if (errors.length === 0) {
        post = draft;
        break;
      }
      console.error(`  rejected: ${errors.join("; ")}`);
      feedback = errors.join("; ");
    }
    if (!post) {
      console.error("No valid article after 3 attempts. Nothing published.");
      process.exit(1);
    }
  }

  // Assemble the final record.
  const slug = slugify(post.title);
  const record = {
    slug,
    title: post.title.trim(),
    category: post.category,
    excerpt: post.excerpt.trim(),
    author: AUTHOR,
    date: today,
    readMins: Math.max(3, Math.round(wordCount(post) / 200)),
    tags: post.tags.slice(0, 5).map((t) => String(t).trim()),
    body: post.body,
  };

  // Prepend to generated-posts.js (newest first).
  const { GENERATED_POSTS } = await import(pathToFileURL(GENERATED_PATH).href + `?t=${Date.now()}`);
  const next = [record, ...GENERATED_POSTS];
  const header =
    "// AUTO-GENERATED — do not edit by hand.\n" +
    "// The daily blog job (scripts/generate-blog-post.mjs) rewrites this file,\n" +
    "// prepending each new article so the newest sits first. Seeded empty.\n";
  fs.writeFileSync(GENERATED_PATH, `${header}export const GENERATED_POSTS = ${JSON.stringify(next, null, 2)};\n`, "utf8");

  // Add the URL to the sitemap, right after the /blog index entry.
  let sitemap = fs.readFileSync(SITEMAP_PATH, "utf8");
  const eol = detectEol(sitemap);
  const entry = `  <url><loc>${ORIGIN}/blog/${slug}</loc><changefreq>monthly</changefreq><priority>0.7</priority><lastmod>${today}</lastmod></url>`;
  if (!sitemap.includes(`/blog/${slug}</loc>`)) {
    const lines = sitemap.split(eol);
    const idx = lines.findIndex((l) => l.includes(`${ORIGIN}/blog</loc>`));
    if (idx >= 0) lines.splice(idx + 1, 0, entry);
    else lines.splice(Math.max(lines.findIndex((l) => l.includes("</urlset>")), 0), 0, entry);
    sitemap = lines.join(eol);
    fs.writeFileSync(SITEMAP_PATH, sitemap, "utf8");
  }

  console.log(`\nPublished: "${record.title}"`);
  console.log(`  /blog/${slug}  ·  ${record.category}  ·  ${record.readMins} min read  ·  ${wordCount(post)} words`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  if (e?.status != null) console.error(`http status: ${e.status}`);
  if (e?.error) console.error(`api error: ${JSON.stringify(e.error)}`);
  process.exit(1);
});
