#!/usr/bin/env node
// Optional browser smoke of a design preview (needs Playwright + Chromium; NOT a CI dependency).
//   node scripts/ui-smoke.mjs <preview-url> [--shots <dir>] [--width 390] [--chrome <path>]
// Opens every screen and every state of the preview and fails on: console/page errors, CSP violations, requests outside the
// preview origin, horizontal overflow at phone width, a missing "Dữ liệu minh họa" banner.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http'));
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const shots = opt('--shots');
const width = Number(opt('--width', 390));
const req = createRequire(import.meta.url);
const { chromium } = req(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: opt('--chrome', process.env.PW_CHROME), args: ['--disable-background-networking'] });
const page = await browser.newPage({ viewport: { width, height: 844 } });
const problems = [];
const origin = new URL(url).origin;
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 160)}`));
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && problems.push(`external request: ${r.url()}`));
if (shots) mkdirSync(shots, { recursive: true });

await page.goto(url);
await page.waitForSelector('.dv-link', { state: 'attached' });
const ids = await page.$$eval('.dv-link', (a) => a.map((x) => x.getAttribute('href').slice(2)));
let count = 0;
for (const id of ids) {
  await page.goto(`${url}#/${id}`);
  await page.waitForSelector('.dv-surface');
  const variants = await page.$$eval('.dv-variant', (b) => b.map((x) => x.dataset.variant));
  for (const variant of variants.length ? variants : ['default']) {
    await page.goto(`${url}#/${id}/${variant}`);
    await page.waitForTimeout(120);
    count += 1;
    const label = `${id}/${variant}`;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) problems.push(`${label}: horizontal overflow ${overflow}px`);
    if ((await page.locator('.dv-banner', { hasText: 'Dữ liệu minh họa' }).count()) === 0) problems.push(`${label}: missing sample-data banner`);
    if ((await page.locator('.dv-surface h1').count()) === 0) problems.push(`${label}: no h1`);
    if (shots) await page.screenshot({ path: join(shots, `${id}__${variant}.png`) });
  }
}
await browser.close();
console.log(`${count} screen states checked at ${width}px, ${problems.length} problem(s)`);
for (const p of problems) console.log(` - ${p}`);
process.exit(problems.length ? 1 : 0);
