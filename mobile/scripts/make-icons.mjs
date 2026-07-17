// Generate the app's branded PNG assets (icon, adaptive icon, splash) from the
// real Aster logo SVG, using the system Chrome that the web app's prerender
// already relies on. Run: node mobile/scripts/make-icons.mjs
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const assets = resolve(__dirname, "..", "assets");
mkdirSync(assets, { recursive: true });

const BRAND = "#0B2AE0";
// The mark path from public/favicon.svg (viewBox 199 244 104 104).
const markSvg = readFileSync(resolve(repoRoot, "public", "favicon.svg"), "utf8");
const markPath = markSvg.match(/d="([^"]+)"/)[1];

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// A full-bleed HTML page that draws the mark centered on a canvas. `bg` may be a
// color or "transparent"; `pad` is the mark inset fraction (0..0.5).
function page({ size, bg, pad, color }) {
  const inset = Math.round(size * pad);
  const vb = 104; // mark viewBox size
  return `<!doctype html><html><head><meta charset="utf8"><style>
    html,body{margin:0;padding:0}
    #c{width:${size}px;height:${size}px;background:${bg};display:flex;align-items:center;justify-content:center}
    svg{width:${size - inset * 2}px;height:${size - inset * 2}px}
  </style></head><body>
    <div id="c"><svg viewBox="199 244 ${vb} ${vb}" xmlns="http://www.w3.org/2000/svg" fill="${color}"><path d="${markPath}"/></svg></div>
  </body></html>`;
}

const TARGETS = [
  { name: "icon.png", size: 1024, bg: BRAND, pad: 0.2, color: "#FFFFFF" },            // iOS/app store icon: white mark on blue
  { name: "adaptive-icon.png", size: 1024, bg: "transparent", pad: 0.28, color: "#FFFFFF" }, // Android foreground (bg color in app.json)
  { name: "splash-icon.png", size: 1024, bg: "transparent", pad: 0.30, color: "#FFFFFF" },   // splash mark (bg color in app.json)
  { name: "favicon.png", size: 48, bg: "transparent", pad: 0.06, color: BRAND },       // web favicon
];

const puppeteer = (await import("puppeteer-core")).default;
const sys = findChrome();
if (!sys) { console.error("No system Chrome/Edge found."); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: sys, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"] });
try {
  for (const t of TARGETS) {
    const p = await browser.newPage();
    await p.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 });
    await p.setContent(page(t), { waitUntil: "networkidle0" });
    const el = await p.$("#c");
    const buf = await el.screenshot({ omitBackground: t.bg === "transparent", type: "png" });
    writeFileSync(resolve(assets, t.name), buf);
    console.log(`✓ ${t.name} (${t.size}x${t.size})`);
    await p.close();
  }
} finally {
  await browser.close();
}
console.log("Done. Assets in mobile/assets/");
