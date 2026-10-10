import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A very small Chrome DevTools Protocol driver for the browser integration test of the administration web. It needs no
// package: it starts the locally installed Chrome/Chromium headless and talks to it over Node's built-in WebSocket.
// It is test support only. It drives a REAL browser: real TLS, real cookie jar (__Host-, Secure, HttpOnly, SameSite),
// real Origin header, real JavaScript of the built page.

interface MinimalWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

type WebSocketConstructor = new (url: string) => MinimalWebSocket;

function webSocketClass(): WebSocketConstructor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (ctor === undefined) {
    throw new Error('this Node.js has no global WebSocket (Node 22+ is required for the browser test)');
  }
  return ctor;
}

const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** CHROME_BIN, or the first known install path. Throws (the test fails, it is never skipped) when none exists. */
export function findChrome(): string {
  const configured = process.env.CHROME_BIN;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const found = CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error('No Chrome/Chromium found for the admin web browser test. Install Chrome or set CHROME_BIN.');
  }
  return found;
}

export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

/**
 * Starts headless Chrome. `spkiHash` (base64 SHA-256 of the test certificate's public key) makes Chrome accept ONLY
 * that self-signed certificate; every other certificate check stays on. --no-sandbox is needed on CI runners whose
 * kernel blocks the sandbox's user namespaces; it applies to this throwaway test browser only.
 */
export async function launchChrome(spkiHash: string): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'admin-web-chrome-'));
  const child: ChildProcess = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--ignore-certificate-errors-spki-list=${spkiHash}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-sandbox',
      '--lang=vi-VN',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${buffer.slice(-2000)}`)), 30_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${String(code)}): ${buffer.slice(-2000)}`));
    });
  });
  const httpBase = new URL(endpoint);
  const base = `http://${httpBase.host}`;

  return {
    async newPage(): Promise<Page> {
      const response = await fetch(`${base}/json/new?about:blank`, { method: 'PUT' });
      const target = (await response.json()) as { webSocketDebuggerUrl: string; id: string };
      const page = new Page(target.webSocketDebuggerUrl, async () => {
        await fetch(`${base}/json/close/${target.id}`).catch(() => undefined);
      });
      await page.open();
      return page;
    },
    async close(): Promise<void> {
      child.kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 200));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${String(ms)} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface Pending {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
}

export interface CdpCookie {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expires: number;
  session: boolean;
}

export class Page {
  #socket: MinimalWebSocket | undefined;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #listeners: { method: string; callback: (params: Record<string, unknown>) => void }[] = [];
  readonly consoleErrors: string[] = [];
  /** Every request this page sent (method + URL), in order; used to prove that nothing was re-sent. */
  readonly requests: { method: string; url: string }[] = [];
  #paused: { requestId: string; url: string; status: number }[] = [];

  constructor(
    private readonly url: string,
    private readonly closeTarget: () => Promise<void>,
  ) {}

  async open(): Promise<void> {
    const Socket = webSocketClass();
    const socket = new Socket(this.url);
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('DevTools connection failed'));
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> };
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error !== undefined) {
          pending?.reject(new Error(message.error.message));
        } else {
          pending?.resolve(message.result ?? {});
        }
      } else if (message.method !== undefined) {
        for (const listener of this.#listeners) {
          if (listener.method === message.method) {
            listener.callback(message.params ?? {});
          }
        }
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    this.on('Runtime.exceptionThrown', (params) => this.consoleErrors.push(JSON.stringify(params).slice(0, 500)));
    this.on('Network.requestWillBeSent', (params) => {
      const request = params.request as { method: string; url: string };
      this.requests.push({ method: request.method, url: request.url });
    });
    this.on('Fetch.requestPaused', (params) => {
      this.#paused.push({
        requestId: String(params.requestId),
        url: String((params.request as { url: string }).url),
        status: Number(params.responseStatusCode ?? 0),
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const socket = this.#socket;
    if (socket === undefined) {
      throw new Error('page is not open');
    }
    this.#nextId += 1;
    const id = this.#nextId;
    return new Promise((resolve, reject) => {
      // A command that never answers fails the test with its name instead of hanging until the jest timeout.
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`DevTools command ${method} did not answer within 20 s`));
      }, 20_000);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, callback: (params: Record<string, unknown>) => void): void {
    this.#listeners.push({ method, callback });
  }

  async viewport(width: number, height: number, mobile: boolean): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }

  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const listener = { method: 'Page.loadEventFired', callback: () => resolve() };
      this.#listeners.push(listener);
    });
    await this.send('Page.navigate', { url });
    await withTimeout(loaded, 30_000, `load of ${url}`);
    this.#listeners = this.#listeners.filter((listener) => listener.method !== 'Page.loadEventFired');
  }

  async reload(): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      this.#listeners.push({ method: 'Page.loadEventFired', callback: () => resolve() });
    });
    await this.send('Page.reload', { ignoreCache: true });
    await withTimeout(loaded, 30_000, 'reload');
    this.#listeners = this.#listeners.filter((listener) => listener.method !== 'Page.loadEventFired');
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
    }
    return (result.result as { value: T }).value;
  }

  /** Polls a boolean expression until it is true. */
  async waitFor(expression: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) {
        return;
      }
      if (Date.now() > deadline) {
        const text = await this.evaluate<string>('document.body ? document.body.innerText : ""');
        throw new Error(`timed out waiting for ${expression}; page text: ${text.slice(0, 600)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  visible(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  }

  text(selector: string): Promise<string> {
    return this.evaluate<string>(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`);
  }

  /** Input events go to the focused tab only; with several tabs open, the tab is brought to the front first. */
  async #front(): Promise<void> {
    await this.send('Page.bringToFront');
  }

  async click(selector: string): Promise<void> {
    await this.#front();
    const box = await this.evaluate<{ x: number; y: number } | null>(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    if (box === null) {
      throw new Error(`no element ${selector}`);
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  }

  /** Focuses the field, clears it and types the text as real input (one insertText, like a paste). */
  async fill(selector: string, text: string): Promise<void> {
    await this.#front();
    await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select && e.select(); })()`);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    if (text !== '') {
      await this.send('Input.insertText', { text });
    }
  }

  async pressEnter(): Promise<void> {
    await this.#front();
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await this.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r' });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  async cookies(url: string): Promise<CdpCookie[]> {
    const result = await this.send('Network.getCookies', { urls: [url] });
    return result.cookies as CdpCookie[];
  }

  /** Full-page screenshot (webp) of the current layout. */
  async screenshot(): Promise<Buffer> {
    const metrics = await this.send('Page.getLayoutMetrics');
    const size = (metrics.cssContentSize ?? metrics.contentSize) as { width: number; height: number };
    const viewport = (metrics.cssLayoutViewport ?? metrics.layoutViewport) as { clientWidth: number; clientHeight: number };
    const width = Math.max(viewport.clientWidth, Math.ceil(size.width));
    const height = Math.max(viewport.clientHeight, Math.ceil(size.height));
    const shot = await this.send('Page.captureScreenshot', {
      format: 'webp',
      quality: 70,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return Buffer.from(String(shot.data), 'base64');
  }

  /** POST requests this page sent to a path (exact pathname match). */
  posts(path: string): number {
    return this.requests.filter((request) => request.method === 'POST' && new URL(request.url).pathname === path).length;
  }

  /**
   * TEST FAULT INJECTION: pause the responses of requests matching `urlPattern` AFTER the server answered (the backend
   * really processed and committed the request), so the test can drop them with failResponse().
   */
  async interceptResponses(urlPattern: string): Promise<void> {
    await this.send('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Response' }] });
  }

  async stopIntercepting(): Promise<void> {
    await this.send('Fetch.disable');
  }

  /** Waits for the next paused response (see interceptResponses). */
  async nextPausedResponse(timeoutMs = 15_000): Promise<{ requestId: string; url: string; status: number }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const next = this.#paused.shift();
      if (next !== undefined) {
        return next;
      }
      if (Date.now() > deadline) {
        throw new Error('no paused response');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * The paused response never reaches the page: fetch() rejects as on a cut connection. Note that Chrome has already seen
   * the response headers at this stage, so a Set-Cookie in them may be stored (like an answer whose body is lost).
   */
  async failResponse(requestId: string): Promise<void> {
    await this.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
  }

  async close(): Promise<void> {
    this.#socket?.close();
    await this.closeTarget();
  }
}
