import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01.06, real browser: the shared auth components (otpField, passwordField, countdown) on a 360px phone screen in headless
// Chromium. A small harness page imports the BUILT components of 11Food and nothing else: no screen, no backend. What is
// checked: one accessible OTP input shown as six cells, real keyboard / paste / autofill with a leading zero, password kept
// byte for byte, touch targets, no horizontal scroll at 360px, and the countdown recomputing when the page comes back.

const CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];

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
    throw new Error('No Chrome/Chromium found for the auth component browser test. Install Chrome or set CHROME_BIN.');
  }
  return found;
}

// ---- minimal Chrome DevTools Protocol client (no dependency) ---------------------------------------------------------
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
  send(method, params = {}, sessionId = undefined, timeoutMs = 15_000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from the browser within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)), method });
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
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
      }
    });
  }
  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }
  async evaluate(expression) {
    const result = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId, 5000);
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
  async viewport(width, height = 900) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete' && window.__ready === true`, `harness ready at ${url}`);
  }
  /** Real key presses: each character is a keyDown with text, the way a physical or on-screen keyboard delivers it. */
  async typeKeys(text) {
    for (const char of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
    }
  }
}

let chrome;
let profileDir;
let cdp;

async function launchBrowser() {
  profileDir = mkdtempSync(join(tmpdir(), 'auth-components-profile-'));
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

// ---- the harness: the built components, mounted the way a screen mounts them ----------------------------------------------
const HARNESS_HTML = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><title>harness</title></head>
<body><main class="c-body"><div id="app" class="c-stack"></div></main><script type="module" src="/harness.js"></script></body></html>`;

const HARNESS_JS = `
import { otpField, passwordField, countdownUntil } from '/js/client-shared/src/components.js';
const changes = [];
const otp = otpField({ id: 'otp', label: 'Mã OTP 6 số', onChange: (value) => changes.push(value) });
const password = passwordField({ id: 'password', label: 'Mật khẩu', autocomplete: 'new-password', placeholder: 'Tạo mật khẩu' });
document.getElementById('app').append(otp.root, password.root);
window.__h = { otp, password, changes, countdownUntil };
window.__ready = true;
`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2' };

function startServer(root) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': TYPES['.html'] }).end(HARNESS_HTML);
      return;
    }
    if (url.pathname === '/harness.js') {
      response.writeHead(200, { 'content-type': TYPES['.js'] }).end(HARNESS_JS);
      return;
    }
    const file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
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

let out;
let site;

before(async () => {
  out = mkdtempSync(join(tmpdir(), 'auth-components-'));
  site = await startServer(buildClientWeb('food-web', { outDir: join(out, 'food'), quiet: true }).dist);
  await launchBrowser();
}, { timeout: 90_000 });

after(async () => {
  cdp?.close();
  if (chrome !== undefined && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  chrome?.stderr?.destroy();
  chrome?.unref();
  await site?.close();
  rmSync(out, { recursive: true, force: true });
  if (profileDir !== undefined) {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, { timeout: 30_000 });

async function onPhone(run) {
  const page = await newPage();
  try {
    await page.viewport(360);
    await page.goto(`${site.base}/`);
    await run(page);
    assert.deepEqual(page.problems, [], 'no console error or exception');
  } finally {
    await cdp.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
  }
}

const focus = (id) => `document.getElementById('${id}').focus()`;
const value = (id) => `document.getElementById('${id}').value`;
const cells = `[...document.querySelectorAll('.c-otp__cell')].map((c) => c.textContent)`;
const lastChange = `__h.changes.at(-1)`;

describe('shared auth components on a 360px phone (M01.06)', { timeout: 180_000 }, () => {
  it('OTP is ONE accessible input drawn as six cells', async () => {
    await onPhone(async (page) => {
      const facts = await page.evaluate(`(() => {
        const input = document.getElementById('otp');
        const label = document.querySelector('label[for="otp"]');
        return {
          inputs: document.querySelectorAll('.c-otp input').length,
          cells: document.querySelectorAll('.c-otp__cell').length,
          cellsHidden: [...document.querySelectorAll('.c-otp__cell')].every((c) => c.getAttribute('aria-hidden') === 'true'),
          label: label?.textContent,
          autocomplete: input.autocomplete,
          inputmode: input.inputMode,
          pattern: input.getAttribute('pattern'),
          maxlength: input.hasAttribute('maxlength'),
          type: input.type,
        };
      })()`);
      assert.deepEqual(facts, { inputs: 1, cells: 6, cellsHidden: true, label: 'Mã OTP 6 số', autocomplete: 'one-time-code', inputmode: 'numeric', pattern: '[0-9]*', maxlength: false, type: 'text' });
    });
  });

  it('real key presses: six digits with a leading zero stay a string, other characters are dropped, the cells show them', async () => {
    await onPhone(async (page) => {
      await page.evaluate(focus('otp'));
      await page.typeKeys('0a1-2');
      assert.equal(await page.evaluate(value('otp')), '012');
      await page.typeKeys('345678');
      assert.equal(await page.evaluate(value('otp')), '012345', 'at most six digits');
      assert.deepEqual(await page.evaluate(cells), ['0', '1', '2', '3', '4', '5']);
      assert.equal(await page.evaluate(lastChange), '012345');
      assert.equal(await page.evaluate(`document.querySelectorAll('.c-otp__cell[data-active="true"]').length`), 1, 'one active cell while focused');
    });
  });

  it('autofill and a long SMS: the code is found even when the message is longer than the old 12-character limit', async () => {
    await onPhone(async (page) => {
      await page.evaluate(focus('otp'));
      await page.send('Input.insertText', { text: '11Ship: ma xac minh cua ban la 012345. Khong chia se ma nay.' });
      assert.equal(await page.evaluate(value('otp')), '012345');
      assert.deepEqual(await page.evaluate(cells), ['0', '1', '2', '3', '4', '5']);
      // Autofill writes the value and fires `input`, the way the OS suggestion does.
      await page.evaluate(`(() => { const i = document.getElementById('otp'); i.value = 'OTP 098765 (het han sau 5 phut)'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      assert.equal(await page.evaluate(value('otp')), '098765');
    });
  });

  it('paste: a pasted message gives the code, a short paste continues what was typed, paste never inserts text', async () => {
    await onPhone(async (page) => {
      const paste = (text) => `(() => { const dt = new DataTransfer(); dt.setData('text', ${JSON.stringify(text)}); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.getElementById('otp').dispatchEvent(e); return e.defaultPrevented; })()`;
      await page.evaluate(focus('otp'));
      assert.equal(await page.evaluate(paste('11Ship OTP 004321 het han')), true);
      assert.equal(await page.evaluate(value('otp')), '004321');
      await page.evaluate(`__h.otp.clear()`);
      await page.typeKeys('12');
      await page.evaluate(paste('345'));
      assert.equal(await page.evaluate(value('otp')), '12345');
      await page.evaluate(paste('  67 '));
      assert.equal(await page.evaluate(value('otp')), '123456');
      assert.deepEqual(await page.evaluate(cells), ['1', '2', '3', '4', '5', '6']);
    });
  });

  it('error state is announced and clearing resets the cells', async () => {
    await onPhone(async (page) => {
      await page.evaluate(`__h.otp.setError('Mã không đúng.')`);
      const state = await page.evaluate(`({ invalid: document.getElementById('otp').getAttribute('aria-invalid'), text: document.getElementById('otp-error').textContent, live: document.getElementById('otp-error').getAttribute('aria-live'), describedby: document.getElementById('otp').getAttribute('aria-describedby') })`);
      assert.deepEqual(state, { invalid: 'true', text: 'Mã không đúng.', live: 'polite', describedby: 'otp-error' });
      await page.evaluate(focus('otp'));
      await page.typeKeys('123456');
      await page.evaluate(`__h.otp.clear()`);
      assert.equal(await page.evaluate(value('otp')), '');
      assert.deepEqual(await page.evaluate(cells), ['', '', '', '', '', '']);
    });
  });

  it('password is kept byte for byte (Unicode, spaces at both ends, combining marks) and can be shown and hidden', async () => {
    await onPhone(async (page) => {
      const typed = '  Pa\u0301ssw\u00f6rd 👨‍👩‍👧 mật-khẩu \u00a0';
      await page.evaluate(focus('password'));
      await page.send('Input.insertText', { text: typed });
      assert.equal(await page.evaluate(`JSON.stringify(${value('password')})`), JSON.stringify(typed));
      const attrs = await page.evaluate(`(() => { const i = document.getElementById('password'); return { type: i.type, autocomplete: i.autocomplete, autocapitalize: i.getAttribute('autocapitalize'), maxlength: i.hasAttribute('maxlength') }; })()`);
      assert.deepEqual(attrs, { type: 'password', autocomplete: 'new-password', autocapitalize: 'off', maxlength: false });
      await page.evaluate(`document.querySelector('#password').closest('.c-field').querySelector('.c-iconbtn').click()`);
      const shown = await page.evaluate(`(() => { const i = document.getElementById('password'); const b = i.closest('.c-field').querySelector('.c-iconbtn'); return { type: i.type, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), same: JSON.stringify(i.value) }; })()`);
      assert.deepEqual(shown, { type: 'text', pressed: 'true', label: 'Ẩn mật khẩu', same: JSON.stringify(typed) });
    });
  });

  it('360px: no horizontal scroll, six cells and the input fit, touch targets are large enough', async () => {
    await onPhone(async (page) => {
      const layout = await page.evaluate(`(() => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; };
        const box = rect(document.querySelector('.c-otp'));
        const input = rect(document.getElementById('otp'));
        const cellRects = [...document.querySelectorAll('.c-otp__cell')].map(rect);
        const toggle = rect(document.querySelector('#password').closest('.c-field').querySelector('.c-iconbtn'));
        const pw = rect(document.getElementById('password'));
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, box, input, cellRects, toggle, pw };
      })()`);
      assert.equal(layout.innerWidth, 360);
      assert.ok(layout.scrollWidth <= 360, `horizontal scroll: ${layout.scrollWidth}`);
      assert.ok(layout.box.x >= 0 && layout.box.right <= 360, 'the OTP row is inside the screen');
      assert.equal(layout.cellRects.length, 6);
      for (const cell of layout.cellRects) {
        assert.ok(cell.w >= 40 && cell.h >= 48, `cell ${cell.w}x${cell.h}`);
        assert.ok(cell.right <= 360);
      }
      assert.deepEqual([Math.round(layout.input.w), Math.round(layout.input.h)], [Math.round(layout.box.w), Math.round(layout.box.h)], 'one tap anywhere on the cells reaches the input');
      assert.ok(layout.toggle.w >= 40 && layout.toggle.h >= 40, `show/hide ${layout.toggle.w}x${layout.toggle.h}`);
      assert.ok(layout.pw.h >= 44, `password input height ${layout.pw.h}`);
    });
  });

  it('countdown: coming back to the page (focus, visibility, pageshow) recomputes from the deadline at once', async () => {
    await onPhone(async (page) => {
      const result = await page.evaluate(`(() => {
        let now = 5_000_000;
        const clock = { now: () => now };
        const parked = { setInterval: () => 1, clearInterval: () => undefined }; // never fires: only a resume can update
        const ticks = [];
        let done = 0;
        __h.countdownUntil(now + 60_000, (r) => ticks.push(r), () => done++, { clock, ticker: parked });
        now += 40_000;
        window.dispatchEvent(new Event('focus'));
        const afterFocus = ticks.at(-1);
        now += 10_000;
        document.dispatchEvent(new Event('visibilitychange'));
        const afterVisibility = ticks.at(-1);
        now += 11_000;
        window.dispatchEvent(new Event('pageshow'));
        const afterPageshow = ticks.at(-1);
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        return { ticks, afterFocus, afterVisibility, afterPageshow, done };
      })()`);
      assert.deepEqual([result.afterFocus, result.afterVisibility, result.afterPageshow, result.done], [20, 10, 0, 1]);
    });
  });

  it('the page made no request but its own files', async () => {
    const business = site.requests.filter((entry) => !/^GET (\/|\/harness\.js|\/tokens\.css|\/components\.css|\/js\/.+|\/fonts\/.+)$/.test(entry));
    assert.deepEqual(business, []);
  });
});
