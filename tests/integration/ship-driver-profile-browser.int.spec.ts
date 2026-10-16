import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthApp, randomPhone, startAuthApp } from './support/auth-fixtures';
import { freePort, repoRoot } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { minimalChildEnv } from './support/test-helpers';

// M01 (11Ship driver profile connection) — S12 -> S13 in a REAL headless Chrome, through the REAL local https front
// (scripts/ship-web-dev.mjs), against the REAL backend (real Nest application) and the REAL PostgreSQL of the integration job (TEST
// database only). The account is the one of the DISABLED_TEST registration (#82): it is registered through the page, so the session
// and identity the page shows come from the server's answer. Nothing is stubbed: the two driver calls, `me` and the sign-in are real.
//
// Flow: register (CUSTOMER) -> S12 reads the server (no profile) -> an invalid form sends nothing -> submit -> S13 shows the stored
// PENDING / EXTERNAL profile, the database holds exactly that and the account keeps CUSTOMER (+ DRIVER role, no context change) ->
// a NEW session (new page, sign in again) reads the same profile -> S12 for a person who has one goes to S13 without creating again.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const MOBILE = { width: 390, height: 844, mobile: true };
const PASSWORD = 'Mật khẩu thử 12345 ü';
const NAME = 'Nguyễn Văn An';
const DRIVER_NAME = 'Nguyễn Văn Shipper';
const PLATE = '59A-123.45';

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

describe('M01 — 11Ship driver profile in a real browser against the real backend and PostgreSQL', () => {
  let app: AuthApp;
  let browser: Browser;
  let front: ChildProcess;
  let origin: string;
  let work: string;
  const shots: Shot[] = [];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), '11ship-ship-driver-'));
    const root = repoRoot();
    const dist = join(work, 'ship-web');
    execFileSync(process.execPath, [join(root, 'scripts', 'client-web-build.mjs'), 'ship-web', '--out', dist], { cwd: root, stdio: 'pipe', timeout: 120_000 });
    execFileSync(process.execPath, [join(root, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '1'], { cwd: root, stdio: 'pipe' });
    const certPath = join(work, 'tls', 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    // The no-OTP test registration (#82) is how the Owner's local account is made.
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, clientPhoneVerificationMode: 'DISABLED_TEST' } });

    const port = await freePort();
    front = spawn(process.execPath, [join(root, 'scripts', 'ship-web-dev.mjs')], {
      cwd: root,
      env: minimalChildEnv({ CLIENT_WEB_PORT: String(port), CLIENT_WEB_DIST: dist, CLIENT_WEB_BACKEND: app.running.baseUrl, CLIENT_WEB_TLS_CERT: certPath, CLIENT_WEB_TLS_KEY: join(work, 'tls', 'key.pem') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    front.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the front did not start in time: ${stderr}`)), 20_000);
      front.stdout?.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      front.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the front exited with ${String(code)}: ${stderr}`));
      });
    });
    origin = `https://localhost:${String(port)}`;
    browser = await launchChrome(spkiHash);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    await app?.close();
    rmSync(work, { recursive: true, force: true });
    publishShots(shots);
  });

  async function shot(page: Page, name: string): Promise<void> {
    await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    shots.push({ name, data: await page.screenshot() });
  }

  const mainText = (page: Page): Promise<string> => page.evaluate<string>(`document.querySelector('main')?.innerText ?? ''`);
  const paths = (page: Page, method: string): string[] => page.requests.filter((request) => request.method === method).map((request) => new URL(request.url).pathname);

  async function clickRow(page: Page, title: string): Promise<void> {
    await page.evaluate(`(() => { const row = [...document.querySelectorAll('.c-item')].find((e) => e.querySelector('.c-item__title')?.textContent.trim() === ${JSON.stringify(title)}); if (!row) throw new Error('no row ${title}'); row.click(); })()`);
  }

  async function driverRows(userId: string): Promise<Array<{ driver_id: string; full_name: string; plate_number: string | null; driver_type: string; status: string; accepting_deliveries: boolean; version: string }>> {
    const result = await app.pool.query(
      'SELECT driver_id, full_name, plate_number, driver_type, status, accepting_deliveries, version::text AS version FROM app.drivers WHERE user_id = $1::uuid',
      [userId],
    );
    return result.rows;
  }

  const rolesOf = async (userId: string): Promise<string[]> => (await app.pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [userId])).rows.map((row) => row.role);

  it('a CUSTOMER sends the driver profile, sees the real PENDING state, and reads it again in a new session without creating a second one', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const page = await browser.newPage();
    await page.viewport(MOBILE.width, MOBILE.height, MOBILE.mobile);
    try {
      // ---- #82: the account, registered through the page (no OTP in this server mode); a new driver lands on S12 ----------
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`);
      await page.fill('#full-name', NAME);
      await page.fill('#phone', phone.local);
      await page.fill('#password', PASSWORD);
      await page.fill('#password-confirm', PASSWORD);
      await page.click('#consent');
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/driver/onboarding'`);
      const user = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
      const userId = String(user.rows[0]?.user_id);
      expect(await rolesOf(userId)).toEqual(['CUSTOMER']);
      expect(await driverRows(userId)).toHaveLength(0);

      // ---- S12: the server was asked first; the form opens empty (the customer name is not copied in) ------------------
      await page.waitFor(`document.querySelector('#driver-submit') && !document.querySelector('#driver-submit').disabled`);
      expect(paths(page, 'GET')).toContain('/v1/driver/me');
      expect(await page.evaluate<string>(`document.querySelector('#legal-name').value`)).toBe('');
      await shot(page, 's12-empty');

      // ---- an invalid form sends nothing -----------------------------------------------------------------------------
      await page.click('#driver-submit');
      await page.waitFor(`document.querySelector('#legal-name-error') && !document.querySelector('#legal-name-error').hidden`);
      expect(paths(page, 'POST').filter((path) => path === '/v1/onboarding/driver')).toHaveLength(0);
      await page.fill('#legal-name', DRIVER_NAME);
      await page.fill('#plate', '59A\u200B123');
      await page.click('#driver-submit');
      await page.waitFor(`document.querySelector('#plate-error') && !document.querySelector('#plate-error').hidden`);
      expect(paths(page, 'POST').filter((path) => path === '/v1/onboarding/driver')).toHaveLength(0);
      expect(await driverRows(userId)).toHaveLength(0);

      // ---- submit ----------------------------------------------------------------------------------------------------
      await page.fill('#plate', PLATE);
      await shot(page, 's12-filled');
      await page.click('#driver-submit');
      await page.waitFor(`location.pathname === '/driver/status' && document.querySelector('#driver-status-card')`);
      expect(paths(page, 'POST').filter((path) => path === '/v1/onboarding/driver')).toHaveLength(1);
      const rows = await driverRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ full_name: DRIVER_NAME, plate_number: PLATE, driver_type: 'EXTERNAL', status: 'PENDING', accepting_deliveries: false, version: '1' });
      expect(await rolesOf(userId)).toEqual(['CUSTOMER', 'DRIVER']);
      // CUSTOMER stays: no context was selected, and the customer profile name is not the driver's legal name.
      expect(paths(page, 'POST')).not.toContain('/v1/client-auth/context');
      expect((await app.pool.query<{ full_name: string }>('SELECT full_name FROM app.customer_profiles WHERE user_id = $1::uuid', [userId])).rows[0]?.full_name).toBe(NAME);
      expect(paths(page, 'GET')).toContain('/v1/client-auth/me');

      // ---- S13: the stored profile, as the server holds it -------------------------------------------------------------
      expect(await page.evaluate<string>(`document.querySelector('#driver-status-card').dataset.status`)).toBe('PENDING');
      expect(await page.text('#driver-status-title')).toBe('Hồ sơ đang chờ duyệt');
      expect(await page.text('#driver-name')).toBe(DRIVER_NAME);
      expect(await page.text('#driver-plate')).toBe(PLATE);
      expect(await page.text('#driver-type')).toBe('Shipper ngoài');
      await shot(page, 's13-pending');

      // ---- account + home reflect the same state; the online switch stays locked ---------------------------------------
      await page.click('header button[aria-label="Quay lại"], header button');
      await page.waitFor(`location.pathname === '/account' && document.body.innerText.includes('Chờ duyệt')`);
      await shot(page, 's05-account-pending');
      await page.click('a[href="/"]');
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes('Hồ sơ đang chờ duyệt')`);
      expect(await page.evaluate<string>(`document.querySelector('.c-switch').getAttribute('aria-disabled')`)).toBe('true');

      // ---- a person who has a profile never reaches a second create ----------------------------------------------------
      await page.evaluate(`(() => { history.pushState(null, '', '/driver/onboarding'); window.dispatchEvent(new PopStateEvent('popstate')); })()`);
      await page.waitFor(`location.pathname === '/driver/status' && document.querySelector('#driver-status-card')`);
      expect(paths(page, 'POST').filter((path) => path === '/v1/onboarding/driver')).toHaveLength(1);

      // No secret or typed value in the URL, history or storage.
      const leaks = await page.evaluate<string[]>(`(() => {
        const haystack = [location.href, JSON.stringify(history.state), JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie].join('\\n');
        return [${JSON.stringify(PASSWORD)}, ${JSON.stringify(DRIVER_NAME)}, ${JSON.stringify(PLATE)}].filter((secret) => haystack.includes(secret));
      })()`);
      expect(leaks).toEqual([]);
      expect(await page.evaluate<number>('localStorage.length + sessionStorage.length')).toBe(0);
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.close();
    }

    // ---- a NEW session (a new page signs in again): the same profile is read from the server ---------------------------
    const again = await browser.newPage();
    await again.viewport(MOBILE.width, MOBILE.height, MOBILE.mobile);
    try {
      await again.goto(`${origin}/login`);
      await again.waitFor(`document.querySelector('#login-submit')`);
      await again.fill('#phone', phone.local);
      await again.fill('#password', PASSWORD);
      await again.click('#login-submit');
      await again.waitFor(`location.pathname === '/' && document.body.innerText.includes('Hồ sơ đang chờ duyệt')`);
      await again.click('a[href="/account"]');
      await again.waitFor(`location.pathname === '/account'`);
      await clickRow(again, 'Hồ sơ shipper');
      await again.waitFor(`location.pathname === '/driver/status' && document.querySelector('#driver-status-card')`);
      expect(await again.text('#driver-name')).toBe(DRIVER_NAME);
      expect(await again.text('#driver-plate')).toBe(PLATE);
      expect(await again.evaluate<string>(`document.querySelector('#driver-status-card').dataset.status`)).toBe('PENDING');
      expect(await mainText(again)).toContain('Shipper ngoài');
      expect(paths(again, 'POST').filter((path) => path === '/v1/onboarding/driver')).toHaveLength(0);
      await shot(again, 's13-new-session');
      const userId = String((await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized])).rows[0]?.user_id);
      expect(await driverRows(userId)).toHaveLength(1);
      expect(again.consoleErrors).toEqual([]);
    } finally {
      await again.close();
    }
  }, 180_000);
});

/** Writes the screenshots to .test-results/ship-driver-shots (CI uploads them as an artifact). */
function publishShots(shots: readonly Shot[]): void {
  if (shots.length === 0) {
    return;
  }
  const directory = join(repoRoot(), '.test-results', 'ship-driver-shots');
  mkdirSync(directory, { recursive: true });
  for (const item of shots) {
    writeFileSync(join(directory, `${item.name}.webp`), item.data);
  }
}
