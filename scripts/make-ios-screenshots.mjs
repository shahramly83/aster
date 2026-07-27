// Turn raw app captures into App Store-ready iPhone screenshots at the EXACT size
// Apple requires (iPhone 6.5" = 1242 x 2688). Drop any-size PNG/JPEG captures into
// mobile/store-screens/raw/ and run:  node scripts/make-ios-screenshots.mjs
// Output lands in mobile/store-screens/out/ ready to upload to App Store Connect.
//
// Each screen is centered on a brand gradient with rounded corners + soft shadow,
// and an optional caption. Set CAPTIONS = [] for clean, caption-free frames.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readdirSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const RAW = "mobile/store-screens/raw";
const OUT = "mobile/store-screens/out";
const W = 1242, H = 2688;               // iPhone 6.5" Display, portrait (Apple-required)
const CROP_TOP_FRACTION = 0.0;          // set e.g. 0.035 to trim an Android status bar

// One caption per screenshot, in filename order. Leave [] to disable captions.
const CAPTIONS = [
  "Screen every resume with AI",
  "One clear hiring pipeline",
  "Interviews, scheduled in seconds",
  "AI insight on every candidate",
  "Send and sign offers natively",
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, cx, top, maxW, lh) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lh));
  return lines.length * lh;
}

mkdirSync(OUT, { recursive: true });
try { rmSync(join(OUT, "_smoketest.png")); } catch { /* ignore */ }

const files = readdirSync(RAW).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
if (files.length === 0) {
  console.error(`No images found in ${RAW}. Drop your app screenshots there first.`);
  process.exit(1);
}

for (let i = 0; i < files.length; i++) {
  const img = await loadImage(join(RAW, files[i]));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Brand gradient background.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0B2AE0");
  g.addColorStop(1, "#4F86F7");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Caption.
  const cap = CAPTIONS[i] || "";
  let topArea = 130;
  if (cap) {
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "700 74px Arial";
    const used = wrapText(ctx, cap, W / 2, 190, W - 180, 92);
    topArea = 190 + used + 70;
  }

  // Fit the capture (contain) into the remaining area, cropping any status bar.
  const cropTop = Math.round(img.height * CROP_TOP_FRACTION);
  const srcW = img.width, srcH = img.height - cropTop;
  const margin = 96;
  const availW = W - margin * 2;
  const availH = H - topArea - 130;
  const scale = Math.min(availW / srcW, availH / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const dx = (W - dw) / 2, dy = topArea + (availH - dh) / 2;
  const radius = 52;

  // Soft shadow behind the device screen.
  ctx.save();
  ctx.shadowColor = "rgba(6, 12, 60, 0.45)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 34;
  roundRect(ctx, dx, dy, dw, dh, radius);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // Clipped screenshot.
  ctx.save();
  roundRect(ctx, dx, dy, dw, dh, radius);
  ctx.clip();
  ctx.drawImage(img, 0, cropTop, srcW, srcH, dx, dy, dw, dh);
  ctx.restore();

  const out = join(OUT, `ios-${String(i + 1).padStart(2, "0")}.png`);
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`wrote ${out}  (${W}x${H})  from ${files[i]}`);
}

console.log(`\nDone. ${files.length} screenshot(s) in ${OUT} at ${W}x${H}. Upload these to App Store Connect (iPhone 6.5" slot).`);
