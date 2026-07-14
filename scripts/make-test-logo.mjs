// Render a company logo PNG for the E2E test workspace.
// Playwright renders the HTML and screenshots it, so we get real text without
// pulling in an image library.
//   node scripts/make-test-logo.mjs
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "tests", "fixtures", "onlazy-logo.png");

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .wrap{width:520px;height:140px;display:flex;align-items:center;gap:18px;
        padding:0 24px;box-sizing:border-box;background:#ffffff;font-family:
        system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .mark{width:64px;height:64px;border-radius:16px;flex:0 0 auto;
        background:linear-gradient(135deg,#5570F5,#0B2AE0 55%,#3550EE);
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-weight:800;font-size:30px;letter-spacing:-1px}
  .name{font-weight:800;font-size:30px;color:#12132A;letter-spacing:-.5px;line-height:1.05}
  .sub{font-weight:600;font-size:13px;color:#6B7280;letter-spacing:.14em;text-transform:uppercase;margin-top:4px}
</style>
<div class="wrap">
  <div class="mark">OB</div>
  <div>
    <div class="name">Onlazy Blogger</div>
    <div class="sub">Sdn Bhd</div>
  </div>
</div>`;

await mkdir(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 140 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.locator(".wrap").screenshot({ path: OUT });
await browser.close();
console.log(`Wrote ${OUT}`);
