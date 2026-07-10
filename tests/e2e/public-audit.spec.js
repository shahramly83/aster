// Public-surface browser audit (Phase 6).
//
// For every public route, across desktop / tablet / mobile viewports, assert:
//   1. the page renders real content (not a blank #root),
//   2. the layout does not overflow horizontally (the classic mobile bug),
//   3. no uncaught errors or failed console errors surface.
//
// These run unauthenticated, so they only touch marketing / auth screens.
import { test, expect } from "@playwright/test";

const PUBLIC_ROUTES = [
  { path: "/", name: "landing" },
  { path: "/product", name: "product" },
  { path: "/solutions", name: "solutions" },
  { path: "/blog", name: "blog" },
  { path: "/compare", name: "compare" },
  { path: "/trust", name: "trust" },
  { path: "/getting-started", name: "getting-started" },
  { path: "/login", name: "login" },
  { path: "/signup", name: "signup" },
  { path: "/forgot-password", name: "forgot-password" },
];

// Console noise we treat as benign (third-party / expected in a preview build).
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[supabase\]/i, // mock-mode notice
  // Network-level resource failures against the live backend. This is a layout
  // and app-error audit, not a network-reliability probe; a transient timeout or
  // aborted fetch is not a rendering defect, so it must not fail the audit.
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_NETWORK|Timeout was reached|Load failed/i,
];

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

for (const route of PUBLIC_ROUTES) {
  test(`${route.name} renders without overflow or console errors`, async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto(route.path, { waitUntil: "load" });

    // 1. Real content: #root has meaningful height.
    const rootBox = await page.locator("#root").boundingBox();
    expect(rootBox, `#root should have a box on ${route.path}`).not.toBeNull();
    expect(rootBox.height).toBeGreaterThan(200);

    // 2. No horizontal overflow. Allow 1px for sub-pixel rounding.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    expect(
      overflow.scrollW,
      `horizontal overflow on ${route.path}: scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`
    ).toBeLessThanOrEqual(overflow.clientW + 1);

    // 3. No uncaught / error-level console output.
    expect(errors, `console errors on ${route.path}`).toEqual([]);
  });
}
