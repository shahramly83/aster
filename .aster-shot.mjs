import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:5175/';
const out = process.argv[3] || 'home.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
console.log('status:', resp.status());
console.log('title:', await page.title());
console.log('h1:', (await page.locator('h1').first().textContent().catch(() => null)));
console.log('body chars:', (await page.locator('body').innerText()).length);
await page.screenshot({ path: out, fullPage: false });
console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
