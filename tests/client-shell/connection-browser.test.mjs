import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M00.04, real browser: the Food and Ship builds run in headless Chromium, served by a small server that also answers
// /v1/health/*. The health answers here are CONTROLLED (mock) so that every failure can be provoked on demand; the answers
// of the real backend are checked in tests/integration/client-health.int.spec.ts (real Nest app, real PostgreSQL).
// Set SHOT_DIR to write a JPEG of each state (evidence images for the PR).

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

// ---- server: the built app + controlled health answers -----------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Like the hosting the real app gets: nothing inline, nothing from elsewhere; requests only to the same origin.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function startServer(root) {
  const health = { live: 'ok', ready: 'ok', slowMs: 900 };
  const hits = [];
  const hung = new Set();
  const answer = (mode, okBody, request, response, isReady) => {
    const headers = { 'content-type': 'application/json', // A cache that obeys this would reuse the answer for an hour: the app must still ask every time.
      'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' };
    switch (mode) {
      case 'ok':
        response.writeHead(200, headers).end(JSON.stringify(okBody));
        return;
      case 'slow':
        setTimeout(() => response.writeHead(200, headers).end(JSON.stringify(okBody)), health.slowMs);
        return;
      case 'unready':
        response.writeHead(isReady ? 503 : 200, headers).end(JSON.stringify(isReady ? { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', request_id: 'r', details: null } } : okBody));
        return;
      case 'badbody':
        response.writeHead(200, headers).end(JSON.stringify({ data: { status: 'nope' } }));
        return;
      case 'status500':
        response.writeHead(500, headers).end('{"error":{"code":"INTERNAL_ERROR"}}');
        return;
      case 'hang':
        hung.add(response);
        response.on('close', () => hung.delete(response));
        return;
      case 'drop':
        request.socket.destroy();
        return;
      default:
        throw new Error(`unknown health mode ${mode}`);
    }
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    if (url.pathname === '/v1/health/live' || url.pathname === '/v1/health/ready') {
      const isReady = url.pathname.endsWith('/ready');
      hits.push({ path: url.pathname, headers: { ...request.headers }, method: request.method });
      answer(isReady ? health.ready : health.live, { data: { status: isReady ? 'ready' : 'ok' } }, request, response, isReady);
      return;
    }
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Real routes of the app (/diagnostics, /account...) open index.html, like the hosting does.
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
        health,
        hits,
        releaseHung: () => {
          for (const response of hung) {
            response.destroy();
          }
        },
        reset: () => {
          health.live = 'ok';
          health.ready = 'ok';
          hits.length = 0;
        },
        close: () => new Promise((done) => {
          for (const response of hung) {
            response.destroy();
          }
          server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

// ---- helpers run inside the page --------------------------------------------------------------------------------------

const small = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]'); };
  return [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), id: el.id, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((item) => item.w < 44 || item.h < 44);
})()`;

const overflow = `({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`;
const banner = `(() => { const host = document.querySelector('.c-connection'); return host === null ? null : { phase: host.getAttribute('data-connection'), hidden: host.hidden, text: host.innerText } })()`;
const diag = (id) => `document.querySelector('#${id}')?.innerText ?? ''`;
const phaseIs = (phase) => `document.querySelector('.c-connection')?.getAttribute('data-connection') === '${phase}' && document.querySelector('.c-connection').hidden === false`;
const diagPhase = (phase) => `document.querySelector('.c-app')?.getAttribute('data-connection') === '${phase}'`;

const WIDTHS = [360, 390, 430, 1366];
const shots = process.env.SHOT_DIR === undefined || process.env.SHOT_DIR === '' ? undefined : process.env.SHOT_DIR;

let out;
let food;
let ship;
let foodSite;
let shipSite;

before(async () => {
  out = mkdtempSync(join(tmpdir(), 'client-browser-'));
  const foodBuilt = buildClientWeb('food-web', { outDir: join(out, 'food'), quiet: true });
  const shipBuilt = buildClientWeb('ship-web', { outDir: join(out, 'ship'), quiet: true });
  foodSite = foodBuilt.dist;
  shipSite = shipBuilt.dist;
  food = await startServer(foodSite);
  ship = await startServer(shipSite);
  await launchBrowser();
});

after(async () => {
  cdp?.close();
  chrome?.kill('SIGKILL');
  await food?.close();
  await ship?.close();
  rmSync(out, { recursive: true, force: true });
  if (profileDir !== undefined) {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

async function withPage(width, run) {
  const page = await newPage();
  try {
    await page.viewport(width);
    await run(page);
    assert.deepEqual(page.problems, [], 'no console error, CSP violation or exception');
  } finally {
    await closePage(page);
  }
}

describe('11Food in a real browser: ready server', () => {
  for (const width of WIDTHS) {
    it(`${width}px: no banner, no sideways scroll, diagnostics shows live and ready ok, touch targets >= 44px`, async () => {
      food.reset();
      await withPage(width, async (page) => {
        await page.goto(`${food.base}/`);
        await page.waitFor(`document.querySelector('.c-connection')?.getAttribute('data-connection') === 'ready'`, 'ready');
        assert.equal((await page.evaluate(banner)).hidden, true, 'a ready server shows no banner (no stale "connected" mark either)');
        assert.deepEqual(await page.evaluate(small), [], `small touch targets on home at ${width}`);
        const home = await page.evaluate(overflow);
        assert.ok(home.scrollWidth <= home.innerWidth, `home scrolls sideways: ${JSON.stringify(home)}`);
        await page.shot(shots, `food-${width}-home-ready`);

        await page.goto(`${food.base}/diagnostics`);
        await page.waitFor(`${diagPhase('ready')}`, 'diagnostics ready');
        assert.equal(await page.evaluate(`document.querySelector('.c-connection')`), null, 'diagnostics shows the state itself, not the banner');
        const status = await page.evaluate(diag('diag-status'));
        assert.match(status, /Máy chủ sẵn sàng/);
        const server = await page.evaluate(diag('diag-server'));
        assert.match(server, /Còn sống \(\/v1\/health\/live\)\s*Đạt · \d+ ms/);
        assert.match(server, /Sẵn sàng \(\/v1\/health\/ready\)\s*Đạt · \d+ ms/);
        assert.doesNotMatch(server, /Lần kiểm tra gần nhất\s*Chưa có/);
        const app = await page.evaluate(diag('diag-app'));
        assert.match(app, /Ứng dụng\s*11Food \(food-web\)/);
        assert.match(app, /Bản dựng\s*Chạy thật/);
        assert.match(app, /Địa chỉ ứng dụng\s*http:\/\/127\.0\.0\.1:\d+/);
        assert.match(app, /Mã nguồn\s*([0-9a-f]{12}|Không rõ)/);
        assert.match(app, /Dấu vân tay bản dựng\s*[0-9a-f]{16}…/);
        assert.deepEqual(await page.evaluate(small), [], `small touch targets on diagnostics at ${width}`);
        const diagnostics = await page.evaluate(overflow);
        assert.ok(diagnostics.scrollWidth <= diagnostics.innerWidth, `diagnostics scrolls sideways: ${JSON.stringify(diagnostics)}`);
        await page.shot(shots, `food-${width}-diagnostics-ready`);
      });
    });
  }
});

describe('11Food in a real browser: every state of the connection, with the same wording on the banner and on diagnostics', () => {
  const CASES = [
    { name: 'backend not ready (/ready 503)', live: 'ok', ready: 'unready', phase: 'backend_not_ready', title: /Máy chủ chưa sẵn sàng/, liveChip: /Đạt/, readyChip: /Chưa sẵn sàng/, shot: 'backend-not-ready' },
    { name: 'offline (connection dropped)', live: 'drop', ready: 'ok', phase: 'offline', title: /Không có kết nối mạng/, liveChip: /Không kết nối được/, readyChip: /Chưa kiểm tra/, shot: 'offline' },
    { name: 'wrong body', live: 'badbody', ready: 'ok', phase: 'bad_response', title: /Máy chủ phản hồi chưa đúng/, liveChip: /Nội dung phản hồi không đúng/, readyChip: /Chưa kiểm tra/, shot: 'bad-response' },
    { name: 'HTTP 500 on live', live: 'status500', ready: 'ok', phase: 'bad_response', title: /Máy chủ phản hồi chưa đúng/, liveChip: /Mã phản hồi không đúng \(500\)/, readyChip: /Chưa kiểm tra/, shot: 'status-500' },
  ];
  for (const width of WIDTHS) {
    for (const item of CASES) {
      it(`${width}px: ${item.name}`, async () => {
        food.reset();
        food.health.live = item.live;
        food.health.ready = item.ready;
        await withPage(width, async (page) => {
          await page.goto(`${food.base}/`);
          await page.waitFor(phaseIs(item.phase), `banner ${item.phase}`);
          const shown = await page.evaluate(banner);
          assert.match(shown.text, item.title);
          assert.match(shown.text, /Lần kiểm tra gần nhất: \d\d\/\d\d\/\d{4} \d\d:\d\d/);
          assert.match(shown.text, /Thử lại/);
          await page.shot(shots, `food-${width}-banner-${item.shot}`);

          await page.goto(`${food.base}/diagnostics`);
          await page.waitFor(diagPhase(item.phase), `diagnostics ${item.phase}`);
          assert.match(await page.evaluate(diag('diag-status')), item.title);
          const server = await page.evaluate(diag('diag-server'));
          assert.match(server, new RegExp(`Còn sống \\(/v1/health/live\\)\\s*${item.liveChip.source}`));
          assert.match(server, new RegExp(`Sẵn sàng \\(/v1/health/ready\\)\\s*${item.readyChip.source}`));
          await page.shot(shots, `food-${width}-diagnostics-${item.shot}`);
        });
      });
    }
  }

  it('390px: timeout after 5 seconds, then retry returns to ready', async () => {
    food.reset();
    food.health.live = 'hang';
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/diagnostics`);
      const startedAt = Date.now();
      await page.waitFor(diagPhase('checking'), 'checking');
      assert.match(await page.evaluate(diag('diag-status')), /Đang kiểm tra kết nối/);
      await page.shot(shots, 'food-390-diagnostics-checking');
      await page.waitFor(diagPhase('timeout'), 'timeout', 9000);
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed >= 4800 && elapsed < 8000, `timeout after ${elapsed} ms, expected about 5000`);
      assert.match(await page.evaluate(diag('diag-status')), /Máy chủ phản hồi quá lâu/);
      assert.match(await page.evaluate(diag('diag-server')), /Quá thời gian chờ/);
      await page.shot(shots, 'food-390-diagnostics-timeout');
      food.releaseHung();
      food.health.live = 'ok';
      await page.evaluate(`document.querySelector('#diag-recheck').click()`);
      await page.waitFor(diagPhase('ready'), 'ready after retry');
      assert.match(await page.evaluate(diag('diag-status')), /Máy chủ sẵn sàng/);
    });
  });

  it('390px: the retry button shows "checking" and refuses a second click while a check runs; the retry result replaces the old state', async () => {
    food.reset();
    food.health.ready = 'unready';
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/diagnostics`);
      await page.waitFor(diagPhase('backend_not_ready'), 'not ready');
      food.health.ready = 'slow';
      const before = food.hits.length;
      await page.evaluate(`document.querySelector('#diag-recheck').click()`);
      await page.waitFor(diagPhase('checking'), 'checking after retry');
      assert.doesNotMatch(await page.evaluate(diag('diag-status')), /chưa sẵn sàng/, 'the old "not ready" is gone while the new check runs');
      assert.equal(await page.evaluate(`document.querySelector('#diag-recheck').innerText`), 'Đang kiểm tra…');
      assert.equal(await page.evaluate(`document.querySelector('#diag-recheck').getAttribute('aria-disabled')`), 'true');
      await page.evaluate(`document.querySelector('#diag-recheck').click()`);
      await page.evaluate(`document.querySelector('#diag-recheck').click()`);
      await page.waitFor(diagPhase('ready'), 'ready');
      assert.equal(food.hits.length - before, 2, 'one check = live + ready; the extra clicks while checking started nothing');
      assert.equal(await page.evaluate(`document.querySelector('#diag-recheck').innerText`), 'Kiểm tra lại');
    });
  });
});

describe('11Food in a real browser: banner on a normal screen', () => {
  it('390px: keyboard reaches Thử lại first, Enter retries, focus stays while checking, and returns to the page title when the banner goes away', async () => {
    food.reset();
    food.health.ready = 'unready';
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/`);
      await page.waitFor(phaseIs('backend_not_ready'), 'banner not ready');
      let reached = -1;
      for (let step = 1; step <= 3 && reached < 0; step += 1) {
        await page.press('Tab');
        if ((await page.evaluate(`document.activeElement.id`)) === 'connection-retry') {
          reached = step;
        }
      }
      assert.ok(reached > 0, 'the retry button is within the first three Tab stops (the banner comes before the page content)');
      const outline = await page.evaluate(`(() => { const s = getComputedStyle(document.activeElement); return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }; })()`);
      assert.ok((outline.outline !== 'none' && outline.width > 0) || outline.shadow !== 'none', `focus is visible: ${JSON.stringify(outline)}`);
      await page.shot(shots, 'food-390-banner-focus');

      food.health.ready = 'slow';
      const before = food.hits.length;
      await page.press('Enter');
      await page.waitFor(phaseIs('checking'), 'checking (banner visible: it was showing a problem)');
      assert.equal(await page.evaluate(`document.activeElement.id`), 'connection-retry', 'focus stays on the button while the state changes');
      assert.equal(await page.evaluate(`document.activeElement.innerText`), 'Đang kiểm tra…');
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('aria-disabled')`), 'true');
      await page.press('Enter');
      await page.waitFor(`document.querySelector('.c-connection').hidden === true && document.querySelector('.c-connection').getAttribute('data-connection') === 'ready'`, 'banner gone once ready');
      assert.equal(food.hits.length - before, 2, 'the second Enter during the check started nothing');
      assert.equal(await page.evaluate(`document.activeElement.tagName`), 'H1', 'focus moved to the page title instead of being lost');
    });
  });

  it('390px: the browser "offline" event shows offline at once; "online" asks again and clears it', async () => {
    food.reset();
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/`);
      await page.waitFor(`document.querySelector('.c-connection')?.getAttribute('data-connection') === 'ready'`, 'ready');
      const before = food.hits.length;
      await page.evaluate(`window.dispatchEvent(new Event('offline'))`);
      await page.waitFor(phaseIs('offline'), 'offline banner', 400);
      assert.match((await page.evaluate(banner)).text, /Không có kết nối mạng/);
      assert.equal(food.hits.length, before, 'no request was needed to know');
      await page.evaluate(`window.dispatchEvent(new Event('online'))`);
      await page.waitFor(`document.querySelector('.c-connection').getAttribute('data-connection') === 'ready' && document.querySelector('.c-connection').hidden === true`, 'ready again');
      assert.equal(food.hits.length - before, 2);
    });
  });

  it('390px: a slow answer of an old check cannot overwrite the newer result', async () => {
    food.reset();
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/`);
      await page.waitFor(`document.querySelector('.c-connection')?.getAttribute('data-connection') === 'ready'`, 'ready');
      food.health.live = 'slow';
      food.health.slowMs = 1500;
      await page.evaluate(`window.dispatchEvent(new Event('online'))`); // check A: live answers "ok" only after 1.5 s
      await sleep(150);
      food.health.live = 'drop';
      await page.evaluate(`window.dispatchEvent(new Event('online'))`); // check B: the connection drops at once
      await page.waitFor(phaseIs('offline'), 'offline from the newer check');
      await sleep(1700); // long enough for the server to have answered A
      assert.equal((await page.evaluate(banner)).phase, 'offline', 'the old "ok" did not bring back a connected state');
      food.health.slowMs = 900;
    });
  });

  it('390px: requests carry no cookie, no Authorization, are not served from cache, and use the contract paths', async () => {
    food.reset();
    // A re-check must be SEEN while it runs: an instant answer leaves "checking" for a few ms, which a 40ms poll can miss.
    food.health.live = 'slow';
    food.health.ready = 'slow';
    food.health.slowMs = 250;
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/diagnostics`);
      await page.waitFor(diagPhase('ready'), 'ready');
      await page.evaluate(`document.cookie = 'sid=should-not-travel; path=/'`);
      await page.evaluate(`localStorage.setItem('token', 'should-not-travel')`);
      food.hits.length = 0;
      for (let round = 0; round < 3; round += 1) {
        await page.evaluate(`document.querySelector('#diag-recheck').click()`);
        await page.waitFor(`document.querySelector('.c-app').getAttribute('data-connection') === 'checking'`, 'checking');
        await page.waitFor(diagPhase('ready'), `ready round ${round}`);
      }
      assert.equal(food.hits.length, 6, 'three checks = three live + three ready, although the server allowed caching for an hour');
      assert.deepEqual([...new Set(food.hits.map((hit) => hit.path))].sort(), ['/v1/health/live', '/v1/health/ready']);
      for (const hit of food.hits) {
        assert.equal(hit.method, 'GET');
        assert.equal(hit.headers.cookie, undefined, 'no cookie');
        assert.equal(hit.headers.authorization, undefined, 'no Authorization');
        assert.equal(hit.headers.referer, undefined, 'no referrer');
        assert.match(hit.headers.accept ?? '', /application\/json/);
      }
    });
    food.health.slowMs = 900;
  });
});

describe('11Food in a real browser: diagnostics copy and accessibility', () => {
  it('390px: "Sao chép thông tin lỗi" copies a report without secrets; without clipboard it shows the text', async () => {
    food.reset();
    food.health.ready = 'unready';
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/diagnostics`);
      await page.waitFor(diagPhase('backend_not_ready'), 'not ready');
      await page.evaluate(`document.cookie = 'sid=should-not-travel; path=/'`);
      await page.evaluate(`window.__copied = undefined; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } })`);
      await page.evaluate(`document.querySelector('#diag-copy').click()`);
      await page.waitFor(`typeof window.__copied === 'string'`, 'copied');
      const copied = await page.evaluate(`window.__copied`);
      for (const expected of ['Chẩn đoán 11Food', 'Địa chỉ ứng dụng: http://127.0.0.1:', 'Bản dựng: live', 'Máy chủ chưa sẵn sàng', 'Còn sống (live): đạt', 'Sẵn sàng (ready): không đạt — Chưa sẵn sàng (503)', 'Lần kiểm tra gần nhất: ']) {
        assert.ok(copied.includes(expected), `report lacks "${expected}":\n${copied}`);
      }
      for (const secret of ['should-not-travel', 'cookie', 'token=', 'password', 'Bearer']) {
        assert.equal(copied.toLowerCase().includes(secret.toLowerCase()), false, secret);
      }
      assert.equal(await page.evaluate(`document.querySelector('#diag-report').hidden`), true);

      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } })`);
      await page.evaluate(`document.querySelector('#diag-copy').click()`);
      await page.waitFor(`document.querySelector('#diag-report').hidden === false`, 'text shown for manual copy');
      assert.match(await page.evaluate(`document.querySelector('#diag-report').innerText`), /^Chẩn đoán 11Food/);
      assert.match(await page.evaluate(`document.querySelector('.c-toast')?.innerText ?? ''`), /Chưa sao chép được/);
      await page.shot(shots, 'food-390-diagnostics-copy-fallback');
    });
  });

  it('390px: language, one h1, named controls, live regions, keyboard order and visible focus', async () => {
    food.reset();
    food.health.ready = 'unready';
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/diagnostics`);
      await page.waitFor(diagPhase('backend_not_ready'), 'not ready');
      const facts = await page.evaluate(`(() => {
        const named = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().length > 0;
        const controls = [...document.querySelectorAll('a[href], button, input, select, textarea')].filter((el) => el.getBoundingClientRect().width > 0);
        return {
          lang: document.documentElement.lang,
          h1: document.querySelectorAll('h1').length,
          h2: [...document.querySelectorAll('h2')].map((el) => el.textContent),
          unnamed: controls.filter((el) => !named(el)).map((el) => el.outerHTML.slice(0, 60)),
          status: { role: document.querySelector('#diag-status').getAttribute('role'), live: document.querySelector('#diag-status').getAttribute('aria-live') },
          nestedAlert: document.querySelectorAll('#diag-status [role=alert]').length,
          tabs: [...document.querySelectorAll('nav a')].map((el) => el.getAttribute('aria-current')),
          dl: document.querySelectorAll('dl > div > dt + dd').length,
        };
      })()`);
      assert.equal(facts.lang, 'vi');
      assert.equal(facts.h1, 1);
      assert.deepEqual(facts.h2, ['Ứng dụng', 'Máy chủ']);
      assert.deepEqual(facts.unnamed, []);
      assert.deepEqual(facts.status, { role: 'status', live: 'polite' });
      assert.equal(facts.nestedAlert, 0, 'no second alert inside the live region');
      assert.ok(facts.tabs.includes('page'), 'the account tab is marked as current');
      assert.equal(facts.dl, 8, 'five app rows and three server rows are real description lists');
      const order = [];
      for (let step = 0; step < 12; step += 1) {
        await page.press('Tab');
        const name = await page.evaluate(`document.activeElement.id || document.activeElement.getAttribute('data-tab') || document.activeElement.getAttribute('aria-label') || document.activeElement.tagName`);
        if (name === 'BODY') {
          break; // the Tab order has gone all the way round
        }
        order.push(name);
        const ring = await page.evaluate(`(() => { const s = getComputedStyle(document.activeElement); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; })()`);
        assert.ok(ring, `focus is visible on ${name}`);
      }
      assert.deepEqual(order, ['Quay lại', 'diag-recheck', 'diag-copy', 'home', 'search', 'orders', 'account'], 'every control is reached once, in reading order');
      await page.shot(shots, 'food-390-diagnostics-focus');
    });
  });

  it('390px: Account (guest) leads to diagnostics and Back returns', async () => {
    food.reset();
    await withPage(390, async (page) => {
      await page.goto(`${food.base}/account`);
      await page.waitFor(`document.querySelector('.c-app')`, 'account');
      await page.evaluate(`[...document.querySelectorAll('button, a')].find((el) => el.textContent.includes('Chẩn đoán kết nối')).click()`);
      await page.waitFor(`location.pathname === '/diagnostics'`, 'diagnostics route');
      await page.waitFor(diagPhase('ready'), 'ready');
      await page.evaluate(`document.querySelector('button[aria-label="Quay lại"]').click()`);
      await page.waitFor(`location.pathname === '/account'`, 'back to account');
    });
  });
});

describe('11Ship in a real browser', () => {
  for (const width of WIDTHS) {
    it(`${width}px: ready, not ready and offline (diagnostics S06 and banner), no sideways scroll, touch targets >= 44px`, async () => {
      ship.reset();
      await withPage(width, async (page) => {
        await page.goto(`${ship.base}/diagnostics`);
        await page.waitFor(diagPhase('ready'), 'ready');
        assert.match(await page.evaluate(diag('diag-app')), /Ứng dụng\s*11Ship \(ship-web\)/);
        assert.match(await page.evaluate(diag('diag-status')), /Máy chủ sẵn sàng/);
        assert.deepEqual(await page.evaluate(small), []);
        const flat = await page.evaluate(overflow);
        assert.ok(flat.scrollWidth <= flat.innerWidth, JSON.stringify(flat));
        await page.shot(shots, `ship-${width}-diagnostics-ready`);

        ship.health.ready = 'unready';
        await page.goto(`${ship.base}/`);
        await page.waitFor(phaseIs('backend_not_ready'), 'banner not ready');
        assert.deepEqual(await page.evaluate(small), []);
        const home = await page.evaluate(overflow);
        assert.ok(home.scrollWidth <= home.innerWidth, JSON.stringify(home));
        await page.shot(shots, `ship-${width}-home-not-ready`);

        ship.health.ready = 'ok';
        ship.health.live = 'drop';
        await page.evaluate(`document.querySelector('#connection-retry').click()`);
        await page.waitFor(phaseIs('offline'), 'offline');
        assert.match((await page.evaluate(banner)).text, /Không có kết nối mạng/);
        await page.shot(shots, `ship-${width}-home-offline`);
      });
    });
  }

  it('390px: the Ship online switch and the rest of the home screen are unchanged by the banner', async () => {
    ship.reset();
    ship.health.live = 'drop';
    await withPage(390, async (page) => {
      await page.goto(`${ship.base}/`);
      await page.waitFor(phaseIs('offline'), 'offline');
      const facts = await page.evaluate(`({
        switchDisabled: document.querySelector('[role=switch]')?.getAttribute('aria-disabled') ?? document.querySelector('[role=switch]')?.disabled,
        nav: [...document.querySelectorAll('nav a')].map((el) => el.textContent.trim()),
      })`);
      assert.ok(facts.switchDisabled === 'true' || facts.switchDisabled === true, 'Online stays unavailable');
      assert.deepEqual(facts.nav, ['Trang chủ', 'Đơn hàng', 'Thu nhập', 'Ví', 'Tài khoản'], 'navigation is kept while offline');
    });
  });
});

describe('design preview', () => {
  it('every connection state of F05/S06 and F06 can be previewed from fixed examples, without any request', async () => {
    for (const [app, name] of [['food-web', 'Food'], ['ship-web', 'Ship']]) {
      const built = buildClientWeb(app, { design: true, outDir: join(out, `${app}-design`), quiet: true });
      const site = await startServer(built.dist);
      try {
        await withPage(390, async (page) => {
          const cases = [
            ['diagnostics', 'default', /Máy chủ sẵn sàng/, diagPhase('ready')],
            ['diagnostics', 'checking', /Đang kiểm tra kết nối/, diagPhase('checking')],
            ['diagnostics', 'backend-not-ready', /Máy chủ chưa sẵn sàng/, diagPhase('backend_not_ready')],
            ['diagnostics', 'offline', /Không có kết nối mạng/, diagPhase('offline')],
            ['diagnostics', 'timeout', /Máy chủ phản hồi quá lâu/, diagPhase('timeout')],
            ['diagnostics', 'bad-response', /Máy chủ phản hồi chưa đúng/, diagPhase('bad_response')],
            ['state-connection', 'checking', /Đang kiểm tra kết nối/, phaseIs('checking')],
            ['state-connection', 'backend-not-ready', /Máy chủ chưa sẵn sàng/, phaseIs('backend_not_ready')],
            ['state-connection', 'offline', /Không có kết nối mạng/, phaseIs('offline')],
            ['state-connection', 'timeout', /Máy chủ phản hồi quá lâu/, phaseIs('timeout')],
            ['state-connection', 'bad-response', /Máy chủ phản hồi chưa đúng/, phaseIs('bad_response')],
          ];
          await page.goto(`${site.base}/design.html`);
          for (const [screen, variant, text, ready] of cases) {
            await page.evaluate(`window.location.hash = '#/${screen}/${variant}'`);
            await page.waitFor(`document.querySelector('.dv-surface')?.getAttribute('data-screen') === '${screen}' && document.querySelector('.dv-surface').getAttribute('data-variant') === '${variant}' && (${ready})`, `${app} preview ${screen}/${variant}`);
            assert.match(await page.evaluate(`document.querySelector('.dv-surface').innerText`), text, `${app} ${screen}/${variant}`);
            assert.match(await page.evaluate(`document.querySelector('.dv-surface').innerText`), /Dữ liệu minh họa/, 'labelled as sample data');
            await page.shot(shots, `design-${name.toLowerCase()}-${screen}-${variant}`);
          }
          assert.deepEqual(site.hits, [], `${app} preview made no health request`);
        });
      } finally {
        await site.close();
      }
    }
  });
});
