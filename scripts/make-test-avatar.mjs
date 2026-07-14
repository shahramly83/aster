// Profile photo for the E2E tenant account.
//   node scripts/make-test-avatar.mjs
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "tests", "fixtures", "tara-avatar.png");

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .a{width:400px;height:400px;display:flex;align-items:center;justify-content:center;
     background:radial-gradient(circle at 30% 25%,#7C93FF,#0B2AE0 70%);
     font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
     color:#fff;font-weight:800;font-size:150px;letter-spacing:-4px}
</style>
<div class="a">TT</div>`;

await mkdir(dirname(OUT), { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 400 } });
await p.setContent(html);
await p.locator(".a").screenshot({ path: OUT });
await b.close();
console.log(`Wrote ${OUT}`);
