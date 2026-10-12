import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M00.06, real browser: the 11Food guest shell (live build) in headless Chromium, served like the PC runtime serves it - the
// page for every extension-less path, health answered, EVERY OTHER request recorded. What is checked: the four tabs, Back,
// deep links and reload; the search box keeping what was typed without producing a result; the "Quản lý cửa hàng" entry that
// cannot be used before login; no business request at all. Set SHOT_DIR to write a JPEG of each screen (evidence images).

const CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];

/** CHROME_BIN, or the first known install path. Like the Admin browser test: never skipped, it fails when no Chrome exists. */
function findChrome() {
  const configured = process.env.CHROME_BIN;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const playwright = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (playwright !== undefined && existsSync(playwright)) {
    for (const entry of readdirSync(playwright)) {
      const candidate = join(playwright, entry, 'chrome-linux', 'chrome');
      if (entry.startsWith('chromium-') && existsSync(candidate)) {
        return candidate;
      }
    }
  }
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error('No Chrome/Chromium found for the client browser test. Install Chrome or set CHROME_BIN.');
  }
  return found;
}

// ---- minimal Chrome DevTools Protocol client (no dependency) -----------------------------------------------------------

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) {
          waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
        } else {
          waiting.resolve(message.result);
        }
        return;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    };
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('DevTools socket failed'));
    });
    return new Cdp(socket);
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.socket.close();
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class Page {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.problems = [];
    cdp.on((message) => {
      if (message.sessionId !== this.sessionId) {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.problems.push(`exception: ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ''}`);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.problems.push(`console.error: ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && message.params.entry.source !== 'network') {
        // Chrome logs every non-2xx / dropped request as a "network" error. The tests provoke those on purpose (503, 500,
        // a dropped connection), so only the other sources count: security (CSP), javascript, rendering, violation.
        this.problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
      }
    });
  }
  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n${expression}`);
    }
    return result.result.value;
  }
  async waitFor(expression, description, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) {
          return last;
        }
      } catch (error) {
        last = error.message;
      }
      await sleep(40);
    }
    throw new Error(`timed out after ${timeoutMs} ms waiting for: ${description} (last: ${JSON.stringify(last)})`);
  }
  async viewport(width, height = width < 500 ? 1000 : 900) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete' && document.querySelector('#app')?.children.length > 0`, `app rendered at ${url}`);
  }
  async press(key) {
    const code = key === 'Tab' ? 9 : 13;
    const base = { key, code: key === 'Tab' ? 'Tab' : 'Enter', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
    // `keyDown` with text is what produces the key press that activates a focused button; `rawKeyDown` would not.
    await this.send('Input.dispatchKeyEvent', key === 'Enter' ? { type: 'keyDown', ...base, text: '\r' } : { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async shot(directory, name) {
    if (directory === undefined) {
      return;
    }
    mkdirSync(directory, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(join(directory, `${name}.jpg`), Buffer.from(data, 'base64'));
  }
}

let chrome;
let profileDir;
let cdp;

async function launchBrowser() {
  profileDir = mkdtempSync(join(tmpdir(), 'client-browser-profile-'));
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--force-color-profile=srgb', 'about:blank'];
  chrome = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${text.slice(-400)}`)), 20_000);
    chrome.stderr.on('data', (chunk) => {
      text += chunk;
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (found !== null) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited early (${code}): ${text.slice(-400)}`)));
  });
  cdp = await Cdp.connect(endpoint);
}

async function newPage() {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, targetId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  return page;
}

async function closePage(page) {
  await cdp.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
}

// ---- server: the built app; health answered, everything else recorded ------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function startServer(root) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/v1/health/live' || url.pathname === '/v1/health/ready') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ data: { status: url.pathname.endsWith('/ready') ? 'ready' : 'ok' } }));
      return;
    }
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = extname(url.pathname) === '' ? join(root, 'index.html') : file;
    }
    if (!existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }).end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

const small = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]'); };
  return [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), id: el.id, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((item) => item.w < 44 || item.h < 44);
})()`;
const overflow = `({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`;
const heading = `(document.querySelector('h1')?.textContent ?? '')`;
const here = `location.pathname`;
const shots = process.env.SHOT_DIR === undefined || process.env.SHOT_DIR === '' ? undefined : process.env.SHOT_DIR;

let out;
let site;

before(async () => {
  out = mkdtempSync(join(tmpdir(), 'food-shell-'));
  const built = buildClientWeb('food-web', { outDir: join(out, 'food'), quiet: true });
  site = await startServer(built.dist);
  await launchBrowser();
});

after(async () => {
  cdp?.close();
  chrome?.kill('SIGKILL');
  await site?.close();
  rmSync(out, { recursive: true, force: true });
  if (profileDir !== undefined) {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function withPage(width, run) {
  const page = await newPage();
  try {
    await page.viewport(width);
    site.requests.length = 0;
    await run(page);
    assert.deepEqual(page.problems, [], 'no console error, CSP violation or exception');
  } finally {
    await closePage(page);
  }
}

const tab = (label) => `(() => { const el = [...document.querySelectorAll('nav a, nav button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); el.click(); })()`;
const type = async (page, text) => {
  await page.evaluate(`document.querySelector('#search').focus()`);
  await page.send('Input.insertText', { text });
};
const APP_ROUTES = new Set(['/', '/search', '/orders', '/account', '/diagnostics', '/login']);
/** Requests that are neither the app itself (its page, files, manifest) nor the two health reads: there must be none. */
const nothingBusiness = () =>
  site.requests.filter((entry) => {
    const [method, target] = entry.split(' ');
    const path = target.split('?')[0];
    const isAppFile = method === 'GET' && (APP_ROUTES.has(path) || /\.[a-z0-9]+$/.test(path));
    const isHealth = method === 'GET' && (path === '/v1/health/live' || path === '/v1/health/ready');
    return !(isAppFile || isHealth);
  });

describe('11Food guest shell in a browser (M00.06)', () => {
  it('opens each of the four tabs, goes Back and Forward, opens deep links and survives a reload', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${site.base}/`);
      assert.equal(await page.evaluate(heading), 'Trang chủ');
      const tabs = [['Tìm kiếm', '/search'], ['Đơn hàng', '/orders'], ['Tài khoản', '/account'], ['Trang chủ', '/']];
      for (const [label, path] of tabs) {
        await page.evaluate(tab(label));
        await page.waitFor(`${here} === '${path}' && ${heading} === '${label}'`, `tab ${label}`);
        await page.shot(shots, `food-390-${label === 'Trang chủ' ? 'home' : path.slice(1)}`);
      }
      await page.evaluate(`history.back()`);
      await page.waitFor(`${here} === '/account'`, 'Back to account');
      await page.evaluate(`history.back()`);
      await page.waitFor(`${here} === '/orders'`, 'Back to orders');
      await page.evaluate(`history.forward()`);
      await page.waitFor(`${here} === '/account'`, 'Forward to account');
      for (const [path, title] of [['/search', 'Tìm kiếm'], ['/orders', 'Đơn hàng'], ['/account', 'Tài khoản'], ['/diagnostics', 'Chẩn đoán kết nối']]) {
        await page.goto(`${site.base}${path}`);
        assert.equal(await page.evaluate(heading), title, `deep link ${path}`);
        await page.send('Page.reload');
        await page.waitFor(`document.readyState === 'complete' && ${here} === '${path}' && ${heading} === '${title}'`, `reload ${path}`);
      }
      await page.goto(`${site.base}/no-such-screen`);
      await page.waitFor(`${here} === '/' && ${heading} === 'Trang chủ'`, 'unknown path goes home');
      // A route that needs a session is not reachable as a guest: it goes to the login screen, never to an owner view.
      await page.goto(`${site.base}/shop/home`);
      await page.waitFor(`${here} === '/login'`, 'shop home as guest goes to login');
    });
  });

  it('search keeps what was typed (and the Món/Quán choice) across tabs and Back, and never makes a result', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${site.base}/search`);
      assert.equal(await page.evaluate(`document.querySelector('#search').readOnly || document.querySelector('#search').disabled`), false, 'the box is editable');
      assert.equal(await page.evaluate(`document.querySelector('#search-clear').hidden`), true, 'no clear button while empty');
      await type(page, 'bún bò Huế');
      assert.equal(await page.evaluate(`document.querySelector('#search').value`), 'bún bò Huế');
      assert.equal(await page.evaluate(`document.querySelector('#search-clear').hidden`), false);
      await page.evaluate(`document.querySelector('#search-scope-shop').click()`);
      assert.equal(await page.evaluate(`document.querySelector('#search-scope-shop').getAttribute('aria-pressed') + document.querySelector('#search-scope-dish').getAttribute('aria-pressed')`), 'truefalse');
      const text = await page.evaluate(`document.querySelector('main').innerText`);
      assert.match(text, /Chưa tìm được kết quả/);
      assert.match(text, /chưa gửi tới máy chủ/);
      assert.equal(await page.evaluate(`document.querySelectorAll('main ul li, main .c-card, main a[href]').length`), 0, 'no shop, dish or offer is shown');
      await page.shot(shots, 'food-390-search-typed');
      // Enter submits nothing: same page, same URL, no new request.
      const before = site.requests.length;
      await page.press('Enter');
      await sleep(150);
      assert.equal(await page.evaluate(here), '/search');
      assert.equal(await page.evaluate(`location.search`), '');
      assert.equal(site.requests.length, before, 'Enter made no request');
      // Away and back by tab, then away and back by the browser's Back: the text and scope are still there.
      await page.evaluate(tab('Đơn hàng'));
      await page.waitFor(`${here} === '/orders'`, 'orders');
      await page.evaluate(`history.back()`);
      await page.waitFor(`${here} === '/search' && document.querySelector('#search') !== null`, 'back to search');
      assert.equal(await page.evaluate(`document.querySelector('#search').value`), 'bún bò Huế');
      assert.equal(await page.evaluate(`document.querySelector('#search-scope-shop').getAttribute('aria-pressed')`), 'true');
      await page.evaluate(tab('Tài khoản'));
      await page.waitFor(`${here} === '/account'`, 'account');
      await page.evaluate(tab('Tìm kiếm'));
      await page.waitFor(`${here} === '/search' && document.querySelector('#search') !== null`, 'search tab again');
      assert.equal(await page.evaluate(`document.querySelector('#search').value`), 'bún bò Huế');
      // Clear empties the box, hides itself and returns the focus to the box.
      await page.evaluate(`document.querySelector('#search-clear').click()`);
      assert.equal(await page.evaluate(`document.querySelector('#search').value`), '');
      assert.equal(await page.evaluate(`document.activeElement?.id`), 'search');
      assert.equal(await page.evaluate(`document.querySelector('#search-clear').hidden`), true);
      assert.match(await page.evaluate(`document.querySelector('main').innerText`), /Chưa có kết quả/);
      // The way home is a real link-like control.
      await page.evaluate(`[...document.querySelectorAll('main button, main a')].find((e) => e.textContent.trim() === 'Về trang chủ').click()`);
      await page.waitFor(`${here} === '/'`, 'Về trang chủ');
      assert.deepEqual(nothingBusiness(), [], 'only the app, the manifest and health were requested');
      assert.ok(!site.requests.some((entry) => entry.includes('b%C3%BAn') || entry.includes('bún')), 'the typed text was never sent anywhere');
    });
  });

  it('shows "Quản lý cửa hàng" in the guest account as an unusable entry with its reason, and no role or shop', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${site.base}/account`);
      const entry = await page.evaluate(`(() => {
        const item = [...document.querySelectorAll('main .c-item')].find((e) => e.textContent.includes('Quản lý cửa hàng'));
        return item === undefined ? null : { tag: item.tagName.toLowerCase(), disabled: item.getAttribute('aria-disabled'), text: item.innerText, clickable: item.closest('a, button') !== null };
      })()`);
      assert.ok(entry !== null, 'the entry exists');
      assert.equal(entry.disabled, 'true');
      assert.equal(entry.clickable, false);
      assert.match(entry.text, /Cần đăng nhập/);
      assert.match(entry.text, /Chưa nối máy chủ: đăng nhập đang chờ backend/);
      const all = await page.evaluate(`document.querySelector('main').innerText`);
      assert.doesNotMatch(all, /Chủ quán|Khách hàng|Cửa hàng của bạn|Hồ sơ hoàn tất/);
      await page.evaluate(`[...document.querySelectorAll('main .c-item')].find((e) => e.textContent.includes('Quản lý cửa hàng')).click()`);
      await sleep(150);
      assert.equal(await page.evaluate(here), '/account', 'clicking it goes nowhere');
      await page.shot(shots, 'food-390-account-guest');
    });
  });

  for (const width of [360, 390, 430]) {
    it(`search and account fit ${width}px: no sideways scroll, every control at least 44px`, async () => {
      await withPage(width, async (page) => {
        await page.goto(`${site.base}/search`);
        await type(page, 'cơm tấm sườn bì chả');
        assert.deepEqual(await page.evaluate(small), [], `small controls on search at ${width}`);
        const sizes = await page.evaluate(overflow);
        assert.ok(sizes.scrollWidth <= sizes.innerWidth, `search overflows at ${width}: ${JSON.stringify(sizes)}`);
        await page.shot(shots, `food-${width}-search`);
        await page.goto(`${site.base}/account`);
        assert.deepEqual(await page.evaluate(small), [], `small controls on account at ${width}`);
        const account = await page.evaluate(overflow);
        assert.ok(account.scrollWidth <= account.innerWidth, `account overflows at ${width}: ${JSON.stringify(account)}`);
        await page.shot(shots, `food-${width}-account`);
      });
    });
  }
});
