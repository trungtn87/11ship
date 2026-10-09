import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash, X509Certificate } from 'node:crypto';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { COPY } from '../../apps/admin-web/src/core/messages';
import {
  ADMIN_ORIGIN,
  AdminApp,
  count,
  createSystem,
  enrollAndLogin,
  rewindAcceptedStep,
  startAdminApp,
  SystemAccount,
  totpNow,
  wrongCode,
} from './support/admin-fixtures';
import { Browser, CdpCookie, launchChrome, Page } from './support/cdp';

// M01-D-LOGIN-UI - the BUILT administration web, in a REAL headless Chrome, against the REAL backend and PostgreSQL,
// through the same local HTTPS front Owner uses (scripts/admin-web-dev.mjs). Nothing is mocked: the browser keeps the
// backend's __Host- cookies (Secure, HttpOnly, SameSite=Strict) only because the page is served over HTTPS on one
// origin, and the backend checks the exact Origin the browser sends. Screenshots of the real pages are written to
// .test-results/admin-web-shots and, in the CI-mode run on GitHub Actions, published as check-run annotations.

function repoRoot(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === '11ship') {
        return directory;
      }
    } catch {
      // keep going up
    }
    directory = dirname(directory);
  }
  throw new Error('repository root not found');
}

/** Runs one of the repository's admin web scripts exactly as a developer does (`node scripts/...`). */
function runScript(name: string, args: string[] = []): void {
  execFileSync(process.execPath, [join(repoRoot(), 'scripts', name), ...args], { cwd: repoRoot(), stdio: 'pipe' });
}

/** Starts the local HTTPS front (scripts/admin-web-dev.mjs) as its own process and waits until it listens. */
async function startFront(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(repoRoot(), 'scripts', 'admin-web-dev.mjs')], {
    cwd: repoRoot(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`admin web front did not start: ${output}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('admin web: ')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`admin web front exited (${String(code)}): ${output}`));
    });
  });
  return child;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

const DESKTOP = { width: 1280, height: 800, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };

describe('M01-D-LOGIN-UI - admin web in a real browser against the real backend', () => {
  let app: AdminApp;
  let front: ChildProcess | undefined;
  let browser: Browser;
  let origin: string;
  let system: SystemAccount;
  let tlsDir: string;
  const shots: Shot[] = [];

  beforeAll(async () => {
    // The same three commands the local run guide uses: build, certificate, HTTPS front.
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-web-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    // The local front's origin, plus the fixture origin used by the API helpers that prepare an ACTIVE factor.
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN] });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: app.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    await app?.close();
    rmSync(tlsDir, { recursive: true, force: true });
    publishShots(shots);
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  async function openPage(size: { width: number; height: number; mobile: boolean }): Promise<Page> {
    const page = await browser.newPage();
    await page.viewport(size.width, size.height, size.mobile);
    await page.goto(`${origin}/`);
    return page;
  }

  async function shot(page: Page, name: string): Promise<void> {
    // Let the font and the last paint settle.
    await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    shots.push({ name, data: await page.screenshot() });
  }

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

  /** Nothing of a credential is in page storage or readable by script. */
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

  it('first login: password, Authenticator enrollment with a locally drawn QR, F5 on every step, logout', async () => {
    const page = await openPage(DESKTOP);
    await page.waitFor(`document.querySelector('#login-title')`);
    expect(await page.text('#login-title')).toBe('Đăng nhập quản trị');
    await shot(page, '01-login-desktop');

    // Wrong password: the approved message, and the password field is emptied.
    await page.fill('#phone', system.phone.local);
    await page.fill('#password', 'Wrong-Password-1');
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#form-error') && !document.querySelector('#form-error').hidden`);
    expect(await page.text('#form-error')).toBe(COPY.invalidCredentials);
    expect(await page.evaluate<string>(`document.querySelector('#password').value`)).toBe('');

    await page.fill('#password', system.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('.qr svg path')`);
    expect(await page.text('#enroll-title')).toBe('Thiết lập Authenticator');
    // The step is an HttpOnly __Host- cookie; no session yet; the setup key is not in the DOM until asked for.
    const preauth = await ourCookies(page);
    expectHostCookie(preauth.get(ADMIN_PREAUTH_COOKIE));
    expect(preauth.has(ADMIN_SESSION_COOKIE)).toBe(false);
    expect(await page.text('#setup-key')).toBe('');
    await page.click('#enroll-title ~ .link-btn');
    await page.waitFor(`document.querySelector('#setup-key').textContent.length > 0`);
    const secret = (await page.text('#setup-key')).replace(/\s+/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.click('#enroll-title ~ .link-btn');
    await page.waitFor(`document.querySelector('#setup-key').textContent === ''`);
    await shot(page, '02-enroll-desktop');

    // F5 on the enrollment step: the SAME secret comes back through the protected endpoint (the step is still alive).
    await page.reload();
    await page.waitFor(`document.querySelector('.qr svg path')`);
    await page.click('#enroll-title ~ .link-btn');
    await page.waitFor(`document.querySelector('#setup-key').textContent.length > 0`);
    expect((await page.text('#setup-key')).replace(/\s+/g, '')).toBe(secret);

    // A wrong code keeps the step; the field is emptied for the next try.
    await page.fill('#enroll-code', wrongCode(secret));
    await page.pressEnter();
    await page.waitFor(`!document.querySelector('#enroll-code-error').hidden`);
    expect(await page.text('#enroll-code-error')).toBe(COPY.totpInvalid);
    expect(await page.evaluate<string>(`document.querySelector('#enroll-code').value`)).toBe('');

    await page.fill('#enroll-code', totpNow(secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
    expect(await page.text('#shell-title')).toBe('Đăng nhập thành công');
    expect(await page.text('.lead .role-badge')).toBe('SYSTEM');
    const session = await ourCookies(page);
    expectHostCookie(session.get(ADMIN_SESSION_COOKIE));
    expect(session.has(ADMIN_PREAUTH_COOKIE)).toBe(false);
    // 8 hour absolute lifetime set by the backend.
    const lifetime = (session.get(ADMIN_SESSION_COOKIE)?.expires ?? 0) - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(8 * 3600 - 120);
    expect(lifetime).toBeLessThanOrEqual(8 * 3600 + 5);
    await expectNothingStored(page, [secret]);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_totp_factors WHERE user_id = $1::uuid AND state = 'ACTIVE'`, [system.userId])).toBe(1);
    await shot(page, '03-shell-desktop');

    // F5 keeps the session (no new login, no new session row).
    await page.reload();
    await page.waitFor(`document.querySelector('#shell-title')`);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);

    // Logout: 204, cookies gone, the session row revoked, F5 stays on login.
    await page.click('.topbar-actions .btn');
    await page.waitFor(`document.querySelector('#login-title')`);
    expect((await ourCookies(page)).size).toBe(0);
    expect(
      await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NOT NULL', [system.userId]),
    ).toBe(1);
    await page.reload();
    await page.waitFor(`document.querySelector('#login-title')`);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 120_000);

  it('returning login on mobile: verify step, pasted code, two tabs, revoked session, rate limit countdown', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);
    const limitsBefore = await count(app.pool, 'SELECT 1 FROM app.admin_auth_limits');

    const tabA = await openPage(MOBILE);
    await tabA.waitFor(`document.querySelector('#login-title')`);
    // An invalid phone is refused in the page: the approved message and no request at all (no limiter row appears).
    await tabA.fill('#phone', '0912 345');
    await tabA.fill('#password', 'anything');
    await tabA.pressEnter();
    await tabA.waitFor(`!document.querySelector('#phone-error').hidden`);
    expect(await tabA.text('#phone-error')).toBe(COPY.invalidPhone);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_auth_limits')).toBe(limitsBefore);
    await shot(tabA, '04-login-invalid-phone-mobile');

    await tabA.fill('#phone', system.phone.local);
    await tabA.fill('#password', system.password);
    await tabA.pressEnter();
    await tabA.waitFor(`document.querySelector('#verify-title')`);
    // A pasted code with a space keeps its digits (and a leading zero would stay a string).
    const code = totpNow(first.secret);
    await tabA.fill('#verify-code', `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(await tabA.evaluate<string>(`document.querySelector('#verify-code').value`)).toBe(code);
    await shot(tabA, '05-verify-mobile');

    // Tab B shares the cookie jar. It logs in again with the password: its step cookie replaces tab A's.
    const tabB = await openPage(DESKTOP);
    await tabB.waitFor(`document.querySelector('#verify-title')`);
    await tabB.click('#verify-title ~ form .btn-secondary');
    await tabB.waitFor(`document.querySelector('#login-title')`);
    await tabB.fill('#phone', system.phone.local);
    await tabB.fill('#password', system.password);
    await tabB.pressEnter();
    await tabB.waitFor(`document.querySelector('#verify-title')`);

    // Tab A submits with its old CSRF token: refused, never re-sent; the page reads the state, says the step changed and
    // empties the code field.
    await tabA.evaluate(`document.querySelector('#verify-code').focus()`);
    await tabA.pressEnter();
    await tabA.waitFor(`!document.querySelector('#verify-notice').hidden`);
    expect(await tabA.text('#verify-notice')).toBe(COPY.stepChanged);
    expect(await tabA.evaluate<string>(`document.querySelector('#verify-code').value`)).toBe('');
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
    await shot(tabA, '06-verify-step-changed-mobile');

    // The user continues on purpose: the same code now goes with the current step and opens the session.
    await tabA.fill('#verify-code', code);
    await tabA.pressEnter();
    await tabA.waitFor(`document.querySelector('#shell-title')`);
    expect(await tabA.text('.lead .role-badge')).toBe('SYSTEM');
    await shot(tabA, '07-shell-mobile');
    // The older session (from the API login) was revoked by this second factor; tab B follows the state on F5.
    expect(
      await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]),
    ).toBe(1);
    await tabB.reload();
    await tabB.waitFor(`document.querySelector('#shell-title')`);

    // The session is revoked on the server: F5 goes to login, nothing of the shell is shown.
    await app.pool.query('UPDATE app.admin_sessions SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]);
    await tabA.reload();
    await tabA.waitFor(`document.querySelector('#login-title')`);
    expect(await tabA.evaluate<boolean>(`document.querySelector('#shell-title') === null`)).toBe(true);
    await tabB.close();

    // Rate limit: five wrong codes; the fifth answers 429 and the page shows a countdown with the button disabled.
    await rewindAcceptedStep(app, system.userId);
    await tabA.fill('#phone', system.phone.local);
    await tabA.fill('#password', system.password);
    await tabA.pressEnter();
    await tabA.waitFor(`document.querySelector('#verify-title')`);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await tabA.fill('#verify-code', wrongCode(first.secret));
      await tabA.pressEnter();
      if (attempt < 5) {
        await tabA.waitFor(`!document.querySelector('#verify-code-error').hidden && document.querySelector('#verify-code').value === ''`);
      }
    }
    await tabA.waitFor(`!document.querySelector('#verify-lock').hidden`);
    const firstText = await tabA.text('#verify-lock');
    expect(firstText).toMatch(/^Bạn đã thử quá nhiều lần\. Vui lòng thử lại sau (1[0-5]|0[0-9]):[0-5][0-9]\.$/);
    expect(await tabA.evaluate<boolean>(`document.querySelector('#verify-title ~ form button[type=submit]').disabled`)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(await tabA.text('#verify-lock')).not.toBe(firstText);
    await tabA.fill('#verify-code', totpNow(first.secret));
    expect(await tabA.evaluate<boolean>(`document.querySelector('#verify-title ~ form button[type=submit]').disabled`)).toBe(true);
    await shot(tabA, '08-verify-locked-mobile');
    expect(tabA.consoleErrors).toEqual([]);
    await tabA.close();
  }, 120_000);
});

/**
 * Writes the screenshots to .test-results/admin-web-shots. In the CI-mode run on GitHub Actions it also prints each one
 * as base64 in ::notice:: workflow commands (split in parts, with a manifest), because the job artifacts and logs cannot
 * always be downloaded; the reviewer reassembles them from the check-run annotations.
 */
function publishShots(shots: readonly Shot[]): void {
  const directory = join(repoRoot(), '.test-results', 'admin-web-shots');
  mkdirSync(directory, { recursive: true });
  for (const item of shots) {
    writeFileSync(join(directory, `${item.name}.webp`), item.data);
  }
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.TEST_REMOTE_PATH_DATABASE_URL === undefined) {
    return;
  }
  // GitHub keeps at most 4096 characters of an annotation message, so each image is split into parts below that.
  const part = 4_000;
  process.stdout.write(
    `::notice title=admin-web-shot manifest::${shots.map((item) => `${item.name}=${String(Math.ceil(item.data.toString('base64').length / part))}`).join(' ')}\n`,
  );
  for (const item of shots) {
    const encoded = item.data.toString('base64');
    const total = Math.ceil(encoded.length / part);
    for (let index = 0; index < total; index += 1) {
      process.stdout.write(`::notice title=admin-web-shot ${item.name} ${String(index + 1)}/${String(total)}::${encoded.slice(index * part, (index + 1) * part)}\n`);
    }
  }
}
