import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Headless Chrome over the DevTools protocol for the client-shell browser tests of M01.07 (no dependency). Same approach as the
// older client browser tests; kept here so the register tests share one copy. The page is reached over the REAL local https
// front: Chrome trusts that one certificate by its public-key hash (--ignore-certificate-errors-spki-list), never switches
// TLS verification off for anything else.

const CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];

export function findChrome() {
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

/** Base64 SHA-256 of the certificate's public key (what --ignore-certificate-errors-spki-list takes). */
export function spkiHash(pem) {
  return createHash('sha256').update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

export class Page {
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
        // Chrome logs every non-2xx / dropped request as a "network" error; the tests provoke those on purpose.
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
  async reload() {
    await this.send('Page.reload', {});
    await sleep(150);
    await this.waitFor(`document.readyState === 'complete' && document.querySelector('#app')?.children.length > 0`, 'app rendered after reload');
  }
  /** Puts the text into the field the way typing does (focus, select, insert), so the app's input handlers run. */
  async fill(selector, text) {
    await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); return true; })()`);
    await this.send('Input.insertText', { text });
  }
  async click(selector) {
    await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) { throw new Error('no element ${selector}'); } el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); window.__click = [r.x + r.width / 2, r.y + r.height / 2]; return true; })()`);
    const [x, y] = await this.evaluate('window.__click');
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async press(key) {
    const code = key === 'Tab' ? 9 : key === 'Escape' ? 27 : key === ' ' ? 32 : 13;
    const name = key === 'Tab' ? 'Tab' : key === 'Escape' ? 'Escape' : key === ' ' ? 'Space' : 'Enter';
    const base = { key, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
    const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
    await this.send('Input.dispatchKeyEvent', text === undefined ? { type: 'rawKeyDown', ...base } : { type: 'keyDown', ...base, text });
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

export async function launchChrome({ spki } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), 'client-browser-profile-'));
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--force-color-profile=srgb', ...(spki === undefined ? [] : [`--ignore-certificate-errors-spki-list=${spki}`]), 'about:blank'];
  const chrome = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const cdp = await Cdp.connect(endpoint);
  return {
    async newPage() {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(cdp, sessionId, targetId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Log.enable');
      return page;
    },
    async closePage(page) {
      await cdp.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    },
    async close() {
      cdp.close();
      chrome.kill('SIGKILL');
      await sleep(100);
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // The profile of a killed browser may still be busy for a moment; a leftover temp folder is harmless.
      }
    },
  };
}

// ---- helpers run inside the page ------------------------------------------------------------------------------------

/** Controls under 44 px (touch target) among the visible ones. A checkbox or radio counts by its label row (the whole row is the target). */
export const SMALL_TARGETS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]'); };
  return [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
    .map((el) => { const label = (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label') : null; const r = (label ?? el).getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), id: el.id, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((item) => item.w < 44 || item.h < 44);
})()`;

export const OVERFLOW = `({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`;
