// Browser harness: one stub API + one web server (the real scripts/web-dev-server.mjs, proxying /v1 to the stub) +
// one headless Chromium page per scenario. Playwright is NOT a dependency of the repository: point PLAYWRIGHT_MODULE at
// an installed copy (for example `npm i --no-save playwright` in a scratch folder) and run this by hand.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createWebServer } from '../../../scripts/web-dev-server.mjs';
import { createStubApi } from './stub-api.mjs';

const require = createRequire(import.meta.url);

export const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? '';
if (SCREENSHOT_DIR) mkdirSync(SCREENSHOT_DIR, { recursive: true });

export const PROFILES = {
  desktop: { viewport: { width: 1366, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let browserPromise;
export async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
    browserPromise = chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  }
  return browserPromise;
}
export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close();
}

/** Throw-away credentials, generated per run and never printed or written anywhere. */
export function throwawayAccount(suffix = '1') {
  const digits = String(Math.floor(100000000 + (Number.parseInt(randomBytes(4).toString('hex'), 16) % 899999999))).padStart(9, '0');
  return { phone: `0${digits}`, password: `pw-${randomBytes(9).toString('base64url')}-${suffix}` };
}

export async function startEnvironment() {
  const stub = createStubApi();
  const stubPort = await stub.listen();
  const web = createWebServer({ apiOrigin: `http://127.0.0.1:${stubPort}` });
  const webPort = await new Promise((resolve) => web.listen(0, '127.0.0.1', () => resolve(web.address().port)));
  return {
    stub: stub.state,
    url: `http://127.0.0.1:${webPort}/`,
    async close() {
      web.closeAllConnections?.();
      stub.server.closeAllConnections?.();
      await Promise.all([new Promise((r) => web.close(r)), stub.close()]);
    },
  };
}

/** A page with every observable the checks need: console, page errors, request URLs, failed requests. */
export async function openPage(env, profileName = 'desktop') {
  const browser = await getBrowser();
  const context = await browser.newContext({ ...PROFILES[profileName], locale: 'vi-VN', serviceWorkers: 'block' });
  const page = await context.newPage();
  const seen = { console: [], errors: [], urls: [], failed: [] };
  page.on('console', (message) => seen.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => seen.errors.push(String(error)));
  page.on('request', (request) => seen.urls.push(request.url()));
  page.on('requestfailed', (request) => seen.failed.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(env.url);
  await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
  return { page, context, seen, profile: profileName };
}

export async function login(page, account) {
  await page.getByLabel('Số điện thoại').fill(account.phone);
  await page.getByLabel('Mật khẩu', { exact: false }).first().fill(account.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

export async function shot(page, name) {
  if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

/** Layout invariants checked on every screen: no sideways scroll, controls big enough, fields labelled. */
export async function layoutReport(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const controls = [...document.querySelectorAll('button, input, textarea, a[href], summary')].filter(visible);
    const small = controls
      .map((element) => ({ tag: element.tagName.toLowerCase(), text: (element.textContent || element.getAttribute('aria-label') || element.name || '').trim().slice(0, 40), h: Math.round(element.getBoundingClientRect().height), w: Math.round(element.getBoundingClientRect().width) }))
      .filter((item) => item.h < 44 && !(item.tag === 'a' && item.text === 'Bỏ qua tới nội dung chính'));
    const unlabeled = [...document.querySelectorAll('input, textarea')].filter(visible).filter((input) => {
      const labelled = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      return !labelled && !input.getAttribute('aria-label');
    }).length;
    return { overflowX: root.scrollWidth - root.clientWidth, small, unlabeled, lang: root.lang, h1: document.querySelectorAll('h1').length, font: root.dataset.font ?? null };
  });
}

// A tiny runner so the script has no test-framework dependency.
const results = [];
export async function scenario(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    process.stdout.write(`PASS  ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error });
    process.stdout.write(`FAIL  ${name}\n      ${String(error.message ?? error).split('\n').slice(0, 6).join('\n      ')}\n`);
  }
}
export function summary() {
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} scenarios passed\n`);
  return failed.length === 0;
}
