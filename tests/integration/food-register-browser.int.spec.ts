import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthApp, randomPhone, startAuthApp } from './support/auth-fixtures';
import { freePort, repoRoot } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { InboxAuthApp, readOtp, startInboxAuthApp } from './support/test-sms-fixtures';
import { minimalChildEnv } from './support/test-helpers';

// M01.07 — the 11Food register flow F11 -> F12 -> F01 in a REAL headless Chrome, through the REAL local https front
// (scripts/food-web-dev.mjs, the three forwarded routes), against the REAL backend (real Nest application) and the REAL
// PostgreSQL of the integration job (TEST database only). The OTP is read from the private test inbox the way the PC tool
// reads it (never from a product API and never shown on screen). Nothing of the flow is mocked: the session and identity the
// page shows come from the server's answer. Screenshots of the real pages go to .test-results/food-register-shots and, on
// GitHub Actions, are printed as annotations like the Admin web ones.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const MOBILE = { width: 390, height: 844, mobile: true };
const PASSWORD = 'Mật khẩu thử 12345 ü';
const NAME = 'Nguyễn Văn An';

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

describe('M01.07 — 11Food register in a real browser against the real backend and PostgreSQL', () => {
  let inbox: InboxAuthApp;
  const fronts: ChildProcess[] = [];
  let testApp: AuthApp;
  let testOrigin: string;
  let browser: Browser;
  let origin: string;
  let work: string;
  const shots: Shot[] = [];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), '11ship-food-register-'));
    const root = repoRoot();
    const dist = join(work, 'food-web');
    execFileSync(process.execPath, [join(root, 'scripts', 'client-web-build.mjs'), 'food-web', '--out', dist], { cwd: root, stdio: 'pipe', timeout: 120_000 });
    execFileSync(process.execPath, [join(root, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '1'], { cwd: root, stdio: 'pipe' });
    const certPath = join(work, 'tls', 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    async function startFront(backendUrl: string): Promise<string> {
      const port = await freePort();
      const child = spawn(process.execPath, [join(root, 'scripts', 'food-web-dev.mjs')], {
        cwd: root,
        env: minimalChildEnv({ CLIENT_WEB_PORT: String(port), CLIENT_WEB_DIST: dist, CLIENT_WEB_BACKEND: backendUrl, CLIENT_WEB_TLS_CERT: certPath, CLIENT_WEB_TLS_KEY: join(work, 'tls', 'key.pem') }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      fronts.push(child);
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the front did not start in time: ${stderr}`)), 20_000);
        child.stdout?.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`the front exited with ${String(code)}: ${stderr}`));
        });
      });
      return `https://localhost:${String(port)}`;
    }

    // The real backend with the approved test consent pair and the TEST_INBOX OTP provider (the Owner's local setup).
    inbox = await startInboxAuthApp({}, { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } });

    origin = await startFront(inbox.running.baseUrl);
    // The DISABLED_TEST backend (no OTP) behind its own front: same build, same routes, only the server mode differs.
    testApp = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, clientPhoneVerificationMode: 'DISABLED_TEST' } });
    testOrigin = await startFront(testApp.running.baseUrl);
    browser = await launchChrome(spkiHash);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    for (const child of fronts) {
      child.kill('SIGTERM');
    }
    await testApp?.close();
    await inbox?.close();
    rmSync(work, { recursive: true, force: true });
    publishShots(shots);
  });

  async function openPage(path: string, base: string = origin): Promise<Page> {
    const page = await browser.newPage();
    await page.viewport(MOBILE.width, MOBILE.height, MOBILE.mobile);
    await page.goto(`${base}${path}`);
    await page.waitFor(`document.querySelector('#app')?.children.length > 0`);
    return page;
  }

  async function shot(page: Page, name: string): Promise<void> {
    await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    shots.push({ name, data: await page.screenshot() });
  }

  async function fillForm(page: Page, phoneLocal: string): Promise<void> {
    // F11 keeps its submit locked until the server has said how a registration is verified (GET /v1/client-auth/config).
    await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`);
    await page.fill('#full-name', NAME);
    await page.fill('#phone', phoneLocal);
    await page.fill('#password', PASSWORD);
    await page.fill('#password-confirm', PASSWORD);
    await page.click('#consent');
  }

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    return (await inbox.pool.query(sql, params)).rowCount ?? 0;
  }

  it('a person registers: form -> code from the test inbox -> account created by the server -> F01 signed in; secrets stay out of the URL, history and storage', async () => {
    const phone = randomPhone();
    inbox.track(phone.normalized);
    const page = await openPage('/register');
    try {
      expect(await page.visible('#consent-texts')).toBe(true);
      expect(await page.evaluate<boolean>(`document.querySelector('#consent').checked`)).toBe(false);
      await shot(page, 'f11-empty');
      await fillForm(page, phone.local);
      await shot(page, 'f11-filled');
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/register/otp'`);
      expect(await page.evaluate<string>('document.querySelector("main").innerText')).toMatch(/SMS mô phỏng/);
      await shot(page, 'f12-waiting-for-code');

      // A wrong code first: the real backend refuses it and the page stays on the code step.
      const otp = await readOtp(inbox.harness, 'REGISTER', phone.normalized);
      await page.fill('#otp', otp === '000000' ? '111111' : '000000');
      await page.click('#otp-submit');
      await page.waitFor(`document.querySelector('#otp-error') && !document.querySelector('#otp-error').hidden`);
      await shot(page, 'f12-wrong-code');
      expect(await countRows('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);

      await page.fill('#otp', otp);
      await page.click('#otp-submit');
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes(${JSON.stringify(NAME)})`);
      await shot(page, 'f01-signed-in');

      // What the server holds: one CUSTOMER account, the typed name, one consent row with the approved pair.
      const user = await inbox.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
      expect(user.rowCount).toBe(1);
      const consent = await inbox.pool.query<{ terms_version: string; privacy_version: string; client_app: string }>(
        'SELECT terms_version, privacy_version, client_app FROM app.user_consents WHERE user_id = $1::uuid',
        [user.rows[0]?.user_id],
      );
      expect(consent.rows).toEqual([{ terms_version: TERMS, privacy_version: PRIVACY, client_app: 'FOOD' }]);

      // One request of each kind, nothing sent again.
      expect(page.posts('/v1/auth/phone-verifications')).toBe(1);
      expect(page.requests.filter((request) => request.method === 'POST' && /\/phone-verifications\/[^/]+\/verify$/.test(new URL(request.url).pathname)).length).toBe(2);
      expect(page.posts('/v1/client-auth/register')).toBe(1);

      // The account screen shows what the server reported.
      await page.click('a[href="/account"]');
      await page.waitFor(`location.pathname === '/account'`);
      expect(await page.evaluate<string>('document.querySelector("main").innerText')).toContain(NAME);
      await shot(page, 'f04-account');

      // No secret in the URL, the history entry, any storage or the page.
      const leaks = await page.evaluate<string[]>(`(() => {
        const secrets = [${JSON.stringify(PASSWORD)}, ${JSON.stringify(otp)}];
        const haystack = [location.href, JSON.stringify(history.state), JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie, document.documentElement.outerHTML].join('\\n');
        return secrets.filter((secret) => haystack.includes(secret));
      })()`);
      expect(leaks).toEqual([]);
      expect(await page.evaluate<number>('localStorage.length + sessionStorage.length')).toBe(0);
      expect(page.consoleErrors).toEqual([]);

      // A reload does not bring the session back.
      await page.reload();
      await page.waitFor(`document.querySelector('#app')?.children.length > 0`);
      expect(await page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(NAME)})`)).toBe(false);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('the same phone cannot start a second registration: F11 says it already has an account and no code is asked for in F12', async () => {
    const phone = randomPhone();
    inbox.track(phone.normalized);
    const first = await openPage('/register');
    try {
      await fillForm(first, phone.local);
      await first.click('#register-submit');
      await first.waitFor(`location.pathname === '/register/otp'`);
      await first.fill('#otp', await readOtp(inbox.harness, 'REGISTER', phone.normalized));
      await first.click('#otp-submit');
      await first.waitFor(`location.pathname === '/'`);
    } finally {
      await first.close();
    }
    const second = await openPage('/register');
    try {
      await fillForm(second, phone.local);
      await second.click('#register-submit');
      await second.waitFor(`document.querySelector('#phone-error') && !document.querySelector('#phone-error').hidden`);
      expect(await second.evaluate<string>(`document.querySelector('#phone-error').innerText`)).toContain('đã có tài khoản');
      expect(await second.evaluate<string>('location.pathname')).toBe('/register');
      await shot(second, 'f11-phone-registered');
    } finally {
      await second.close();
    }
  }, 120_000);

  it('a register whose answer is lost AFTER the server committed: "Thử lại" replays the same request, the server answers the original result, exactly one account exists', async () => {
    const phone = randomPhone();
    inbox.track(phone.normalized);
    const page = await openPage('/register');
    try {
      await fillForm(page, phone.local);
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/register/otp'`);
      await page.fill('#otp', await readOtp(inbox.harness, 'REGISTER', phone.normalized));

      // Test fault injection: the backend really processes and commits the register; its answer never reaches the page.
      await page.interceptResponses('*client-auth/register*');
      await page.click('#otp-submit');
      const paused = await page.nextPausedResponse();
      expect(paused.status).toBe(201);
      await page.failResponse(paused.requestId);
      await page.stopIntercepting();

      await page.waitFor(`document.querySelector('#register-retry') !== null`);
      expect(await page.evaluate<string>('location.pathname')).toBe('/register/otp');
      await shot(page, 'f12-register-outcome-unknown');
      expect(await countRows('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);

      await page.click('#register-retry');
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes(${JSON.stringify(NAME)})`);
      await shot(page, 'f01-after-replay');
      expect(page.posts('/v1/client-auth/register')).toBe(2);
      expect(page.posts('/v1/auth/phone-verifications')).toBe(1);
      expect(page.requests.filter((request) => request.method === 'POST' && /\/phone-verifications\/[^/]+\/verify$/.test(new URL(request.url).pathname)).length).toBe(1);
      expect(await countRows('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
      const user = await inbox.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
      expect(await countRows('SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [user.rows[0]?.user_id])).toBe(1);
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);
  it('DISABLED_TEST: F11 registers without any OTP request and lands on F01; the account is TEST_UNVERIFIED with no verified time, no proof and no F12', async () => {
    const phone = randomPhone();
    testApp.track(phone.normalized);
    const page = await openPage('/register', testOrigin);
    try {
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`);
      expect(await page.evaluate<string>(`document.querySelector('#register-submit').innerText.trim()`)).toBe('Đăng ký');
      expect(await page.evaluate<boolean>(`document.body.innerText.includes('Bản test: tạm không xác minh số điện thoại')`)).toBe(true);
      await shot(page, 'f11-disabled-test');
      await fillForm(page, phone.local);
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes(${JSON.stringify(NAME)})`);
      await shot(page, 'f01-disabled-test-signed-in');
      expect(page.posts('/v1/auth/phone-verifications')).toBe(0);
      expect(page.requests.filter((request) => /\/phone-verifications\//.test(request.url)).length).toBe(0);
      expect(page.posts('/v1/client-auth/register')).toBe(1);
      expect(await page.evaluate<boolean>(`location.pathname.includes('otp')`)).toBe(false);

      const user = await testApp.pool.query<{ account_origin: string; verified: boolean }>(
        'SELECT account_origin, phone_verified_at IS NOT NULL AS verified FROM app.users WHERE phone_normalized = $1',
        [phone.normalized],
      );
      expect(user.rows).toEqual([{ account_origin: 'TEST_UNVERIFIED', verified: false }]);
      expect((await testApp.pool.query('SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1', [phone.normalized])).rowCount).toBe(0);
      expect((await testApp.pool.query('SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized])).rowCount).toBe(0);
      const leaks = await page.evaluate<string[]>(`(() => {
        const haystack = [location.href, JSON.stringify(history.state), JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie, document.documentElement.outerHTML].join('\\n');
        return [${JSON.stringify(PASSWORD)}].filter((secret) => haystack.includes(secret));
      })()`);
      expect(leaks).toEqual([]);
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('DISABLED_TEST: a register whose answer is lost after the commit is retried with the same request; one account, no OTP', async () => {
    const phone = randomPhone();
    testApp.track(phone.normalized);
    const page = await openPage('/register', testOrigin);
    try {
      await fillForm(page, phone.local);
      await page.interceptResponses('*client-auth/register*');
      await page.click('#register-submit');
      const paused = await page.nextPausedResponse();
      expect(paused.status).toBe(201);
      await page.failResponse(paused.requestId);
      await page.stopIntercepting();
      await page.waitFor(`document.querySelector('#register-retry') !== null || document.body.innerText.includes('Thử lại')`);
      expect((await testApp.pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).rowCount).toBe(1);
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thử lại')?.click()`);
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes(${JSON.stringify(NAME)})`);
      expect(page.posts('/v1/client-auth/register')).toBe(2);
      expect(page.posts('/v1/auth/phone-verifications')).toBe(0);
      expect((await testApp.pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).rowCount).toBe(1);
    } finally {
      await page.close();
    }
  }, 120_000);
});

/**
 * Writes the screenshots to .test-results/food-register-shots. On GitHub Actions the CI step "Publish 11Food register
 * screenshots" prints the main ones as annotations (scripts/ci-print-shots.mjs), like the Admin web shots.
 */
function publishShots(shots: readonly Shot[]): void {
  if (shots.length === 0) {
    return;
  }
  const directory = join(repoRoot(), '.test-results', 'food-register-shots');
  mkdirSync(directory, { recursive: true });
  for (const item of shots) {
    writeFileSync(join(directory, `${item.name}.webp`), item.data);
  }
}
