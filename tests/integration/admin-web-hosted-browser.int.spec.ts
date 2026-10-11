import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { installAdminWebHosting } from '../../apps/backend/src/http/admin-web-hosting';
import { ADMIN_ORIGIN, AdminApp, count, createSystem, enrollAndLogin, rewindAcceptedStep, startAdminApp, SystemAccount, totpNow } from './support/admin-fixtures';
import { freePort, repoRoot, runScript } from './support/admin-web-harness';
import { Browser, CdpCookie, launchChrome, Page } from './support/cdp';

// Issue #49 (F2) — the BUILT administration web served by the NEW hosting (installAdminWebHosting, with its own CSP and
// headers) from the SAME Nest process as the API, in a real headless Chrome, against the real Admin backend and
// PostgreSQL. This is the evidence for the new hosting middleware. It deliberately does NOT use scripts/admin-web-dev.mjs
// (the old local front proxy): the only thing between Chrome and Nest here is a TLS terminator that copies bytes without
// understanding HTTP, so no header, status or body is added, removed or rewritten on the way. Chrome needs HTTPS because
// the administration cookies are __Host-* cookies; Render terminates HTTPS in the same way in staging.
//
// No fake OTP is involved: the activation API is not enabled in this suite (staging has no OTP adapter). The activation
// flow on the hosted page is therefore NOT accepted by this suite; see docs/evidence/M00-D2-reconcile-49.md.

describe('issue #49 — hosted admin web (new hosting, same origin as the API) in a real browser', () => {
  let app: AdminApp;
  let browser: Browser;
  let origin: string;
  let system: SystemAccount;
  let tlsDir: string;
  let terminator: tls.Server;
  let hostingCsp = '';

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-web-hosted-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({
      allowedOrigins: [origin, ADMIN_ORIGIN],
      activationOrigin: origin,
      beforeListen: (nest) => installAdminWebHosting(nest, { appEnv: 'test', distDir: join(repoRoot(), 'apps', 'admin-web', 'dist') }),
    });
    const backendPort = Number(new URL(app.running.baseUrl).port);
    terminator = tls.createServer({ key: readFileSync(join(tlsDir, 'key.pem')), cert: readFileSync(certPath) }, (socket) => {
      const upstream = net.connect(backendPort, '127.0.0.1');
      socket.pipe(upstream);
      upstream.pipe(socket);
      const close = (): void => {
        socket.destroy();
        upstream.destroy();
      };
      socket.on('error', close);
      upstream.on('error', close);
      socket.on('close', close);
      upstream.on('close', close);
    });
    await new Promise<void>((resolve) => terminator.listen(port, '127.0.0.1', resolve));
    browser = await launchChrome(spkiHash);
    // The CSP the hosting really sends (read from the running process, not copied into the test).
    hostingCsp = (await (await fetch(`${app.running.baseUrl}/`)).headers.get('content-security-policy')) ?? '';
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => (terminator === undefined ? resolve() : terminator.close(() => resolve())));
    await app?.close();
    rmSync(tlsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  interface Watched {
    readonly page: Page;
    readonly blocked: string[];
    readonly failed: string[];
  }

  /** A fresh page that records every CSP violation (in-page event + the network layer's `blockedReason`). */
  async function watchedPage(): Promise<Watched> {
    const page = await browser.newPage();
    await page.viewport(1280, 800, false);
    await page.send('Network.clearBrowserCookies');
    const blocked: string[] = [];
    const failed: string[] = [];
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`,
    });
    page.on('Network.loadingFailed', (params) => {
      // A fetch cancelled by the test's own navigation (goto/reload) is not a failure; a blocked or failed load is.
      if (params.canceled !== true) {
        failed.push(JSON.stringify(params).slice(0, 300));
      }
      if (params.blockedReason !== undefined) {
        blocked.push(String(params.blockedReason));
      }
    });
    return {
      page,
      blocked,
      failed,
    };
  }

  const violationsOf = async (page: Page): Promise<string[]> => page.evaluate<string[]>('window.__csp ?? []');

  async function ourCookies(page: Page): Promise<Map<string, CdpCookie>> {
    const cookies = await page.cookies(`${origin}/`);
    return new Map(cookies.filter((cookie) => cookie.name.startsWith('__Host-11admin')).map((cookie) => [cookie.name, cookie]));
  }

  function expectHostCookie(cookie: CdpCookie | undefined): void {
    expect(cookie).toBeDefined();
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');
  }

  async function expectNothingStored(page: Page, secrets: string[]): Promise<void> {
    const storage = await page.evaluate<{ local: Record<string, string>; session: Record<string, string>; cookie: string }>(
      '({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })',
    );
    expect(storage.cookie).toBe('');
    expect(storage.session).toEqual({});
    expect(Object.keys(storage.local)).toEqual(['11admin.device_id']);
    const dump = JSON.stringify(storage);
    for (const secret of secrets) {
      expect(dump).not.toContain(secret);
    }
  }

  it('login → TOTP → GET /me → shell → deep links survive a reload → logout, with the hosting CSP, no blocked resource, host cookies and clean storage', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);
    const { page, blocked, failed } = await watchedPage();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);

    // The document and the API are the SAME origin; the CSP the browser enforces is the hosting's.
    expect(hostingCsp).toContain("default-src 'none'");
    const served = await page.evaluate<{ csp: string | null; cache: string | null; type: string | null }>(
      `fetch(location.href).then((r) => ({ csp: r.headers.get('content-security-policy'), cache: r.headers.get('cache-control'), type: r.headers.get('x-content-type-options') }))`,
    );
    expect(served).toEqual({ csp: hostingCsp, cache: 'no-store', type: 'nosniff' });

    await page.fill('#phone', system.phone.local);
    await page.fill('#password', system.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    expectHostCookie((await ourCookies(page)).get(ADMIN_PREAUTH_COOKIE));
    await page.fill('#verify-code', totpNow(first.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
    expect(await page.text('.lead .role-badge')).toBe('SYSTEM');

    // The shell was built from GET /me on the same origin.
    expect(page.requests.some((request) => request.method === 'GET' && request.url === `${origin}/v1/admin-auth/me`)).toBe(true);
    const session = await ourCookies(page);
    expectHostCookie(session.get(ADMIN_SESSION_COOKIE));
    expect(session.has(ADMIN_PREAUTH_COOKIE)).toBe(false);
    const lifetime = (session.get(ADMIN_SESSION_COOKIE)?.expires ?? 0) - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(8 * 3600 - 120);
    expect(lifetime).toBeLessThanOrEqual(8 * 3600 + 5);
    await expectNothingStored(page, [first.secret, system.password]);

    // Deep links: a reload of an application route opens the application (served by the hosting), and keeps the session.
    await page.goto(`${origin}/invitations`);
    await page.waitFor(`document.querySelector('#invitations-new')`);
    await page.reload();
    await page.waitFor(`document.querySelector('#invitations-new')`);
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.reload();
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId])).toBe(1);
    await expectNothingStored(page, [first.secret, system.password]);

    // Logout through the shell (back on /): 204, cookies gone, the session revoked, a reload stays on login.
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#shell-title')`);
    await page.click('.topbar-actions .btn');
    await page.waitFor(`document.querySelector('#login-title')`);
    expect((await ourCookies(page)).size).toBe(0);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NOT NULL', [system.userId])).toBe(2); // the API-prepared session (replaced by the browser login) + the browser session (logout)
    await page.reload();
    await page.waitFor(`document.querySelector('#login-title')`);

    // Nothing was blocked by the CSP, nothing left the origin, nothing failed, no console error.
    expect(await violationsOf(page)).toEqual([]);
    expect(blocked).toEqual([]);
    expect(failed).toEqual([]);
    expect(page.consoleErrors).toEqual([]);
    expect(page.requests.filter((request) => !request.url.startsWith(`${origin}/`) && !request.url.startsWith('data:'))).toEqual([]);
    // The page really loaded its assets from the hosting (script, style, font), not from anywhere else.
    const paths = page.requests.map((request) => new URL(request.url).pathname);
    expect(paths).toContain('/js/dom/main.js');
    expect(paths).toContain('/styles.css');
    await page.close();
  }, 120_000);

  it('a deep link opened without a session shows the login (the hosting answers the page, the API decides access), and an unknown path is a 404 with the headers, not the application', async () => {
    const { page, blocked } = await watchedPage();
    await page.goto(`${origin}/invitations`);
    await page.waitFor(`document.querySelector('#login-title')`);
    expect(await page.text('#login-title')).toBe('Đăng nhập quản trị');
    expect(await page.evaluate<boolean>(`document.querySelector('#invitations-new') === null`)).toBe(true);

    const unknown = await page.evaluate<{ status: number; csp: string | null; body: string }>(
      `fetch('/nothing-here').then(async (r) => ({ status: r.status, csp: r.headers.get('content-security-policy'), body: await r.text() }))`,
    );
    expect(unknown).toEqual({ status: 404, csp: hostingCsp, body: '' });
    // The API under /v1 is never answered by the hosting.
    const api = await page.evaluate<{ status: number; type: string | null }>(
      `fetch('/v1/admin-auth/me').then((r) => ({ status: r.status, type: r.headers.get('content-type') }))`,
    );
    expect(api.status).toBe(401);
    expect(api.type).toContain('application/json');
    expect(await violationsOf(page)).toEqual([]);
    expect(blocked).toEqual([]);
    await page.close();
  }, 60_000);
});
