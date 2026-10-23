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

// M03: real browser registration provisions the active Shipper without a second onboarding form.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const MOBILE = { width: 390, height: 844, mobile: true };
const PASSWORD = 'Mật khẩu thử 12345 ü';
const NAME = 'Nguyễn Văn An';

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

  const paths = (page: Page, method: string): string[] => page.requests.filter((request) => request.method === method).map((request) => new URL(request.url).pathname);

  async function driverRows(userId: string): Promise<Array<{ driver_id: string; full_name: string; plate_number: string | null; driver_type: string; status: string; accepting_deliveries: boolean; version: string }>> {
    const result = await app.pool.query(
      'SELECT driver_id, full_name, plate_number, driver_type, status, accepting_deliveries, version::text AS version FROM app.drivers WHERE user_id = $1::uuid',
      [userId],
    );
    return result.rows;
  }

  const rolesOf = async (userId: string): Promise<string[]> => (await app.pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [userId])).rows.map((row) => row.role);

  it('registration creates one ACTIVE Shipper, preserves CUSTOMER and reads the same profile after sign-in', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const page = await browser.newPage();
    await page.viewport(MOBILE.width, MOBILE.height, MOBILE.mobile);
    try {
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`);
      await page.fill('#full-name', NAME);
      await page.fill('#phone', phone.local);
      await page.fill('#password', PASSWORD);
      await page.fill('#password-confirm', PASSWORD);
      await page.click('#consent');
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/driver/status' && document.querySelector('#driver-status-card')`);
      const userId = String((await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized])).rows[0]?.user_id);
      expect(await rolesOf(userId)).toEqual(['CUSTOMER', 'DRIVER']);
      expect(await driverRows(userId)).toMatchObject([{ full_name: NAME, plate_number: null, status: 'ACTIVE', accepting_deliveries: false }]);
      expect(await page.evaluate<string>(`document.querySelector('#driver-status-card').dataset.status`)).toBe('ACTIVE');
      expect(paths(page, 'POST')).not.toContain('/v1/onboarding/driver');
      expect((await app.pool.query('SELECT balance_vnd::text, held_vnd::text FROM app.driver_wallets WHERE driver_id = (SELECT driver_id FROM app.drivers WHERE user_id = $1::uuid)', [userId])).rows).toEqual([{ balance_vnd: '0', held_vnd: '0' }]);
      await shot(page, 'm03-active-without-review');
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.close();
    }
    const again = await browser.newPage();
    try {
      await again.goto(`${origin}/login`);
      await again.waitFor(`document.querySelector('#login-submit')`);
      await again.fill('#phone', phone.local);
      await again.fill('#password', PASSWORD);
      await again.click('#login-submit');
      await again.waitFor(`location.pathname === '/'`);
      await again.evaluate(`(() => { history.pushState(null, '', '/driver/status'); window.dispatchEvent(new PopStateEvent('popstate')); })()`);
      await again.waitFor(`document.querySelector('#driver-status-card')?.dataset.status === 'ACTIVE'`);
      expect(await again.text('#driver-name')).toBe(NAME);
      expect(paths(again, 'POST')).not.toContain('/v1/onboarding/driver');
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
