import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_ORIGIN, AdminApp, createAdminMember, loginBody, startAdminApp } from './support/admin-fixtures';
import { freePort, repoRoot, runScript, startFront as startAdminFront } from './support/admin-web-harness';
import { api, grantRole, PASSWORD, randomPhone } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';
import { minimalChildEnv } from './support/test-helpers';

// M01-RESET — the ONE real smoke of the no-OTP test reset: a REAL headless Chrome, the REAL local https fronts of 11Food, 11Ship and
// the Web Admin, the REAL backend (ACCOUNT_RECOVERY_MODE=DISABLED_TEST) and the REAL PostgreSQL (TEST database only). Nothing is
// mocked: the acknowledgement the page shows is the server's, and the new password is proven by signing in with it.

const NEW_PASSWORD = 'Mật khẩu mới 67890 ü';
const ACK = 'Yêu cầu đã xử lý. Hãy đăng nhập bằng mật khẩu mới nếu tài khoản thuộc phạm vi bản test.';
const MOBILE = { width: 390, height: 844, mobile: true };

describe('M01-RESET — no-OTP test password reset in a real browser against the real backend and PostgreSQL', () => {
  let app: AdminApp;
  let browser: Browser;
  let work: string;
  const children: ChildProcess[] = [];
  let foodOrigin = '';
  let shipOrigin = '';
  let adminOrigin = '';
  const hasher = new Argon2idPasswordHasher();

  async function startClientFront(name: 'food-web' | 'ship-web', dist: string, certPath: string): Promise<string> {
    const root = repoRoot();
    const port = await freePort();
    const child = spawn(process.execPath, [join(root, 'scripts', `${name}-dev.mjs`)], {
      cwd: root,
      env: minimalChildEnv({ CLIENT_WEB_PORT: String(port), CLIENT_WEB_DIST: dist, CLIENT_WEB_BACKEND: app.running.baseUrl, CLIENT_WEB_TLS_CERT: certPath, CLIENT_WEB_TLS_KEY: join(work, 'tls', 'key.pem') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
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

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), '11ship-recovery-'));
    const root = repoRoot();
    const foodDist = join(work, 'food-web');
    const shipDist = join(work, 'ship-web');
    for (const [name, dist] of [['food-web', foodDist], ['ship-web', shipDist]] as const) {
      execFileSync(process.execPath, [join(root, 'scripts', 'client-web-build.mjs'), name, '--out', dist], { cwd: root, stdio: 'pipe', timeout: 120_000 });
    }
    runScript('admin-web-build.mjs');
    execFileSync(process.execPath, [join(root, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '1'], { cwd: root, stdio: 'pipe' });
    const certPath = join(work, 'tls', 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    const adminPort = await freePort();
    adminOrigin = `https://localhost:${String(adminPort)}`;
    app = await startAdminApp({ allowedOrigins: [adminOrigin, ADMIN_ORIGIN], accountRecovery: true });
    foodOrigin = await startClientFront('food-web', foodDist, certPath);
    shipOrigin = await startClientFront('ship-web', shipDist, certPath);
    children.push(
      await startAdminFront({
        ADMIN_WEB_PORT: String(adminPort),
        ADMIN_WEB_HOST: 'localhost',
        ADMIN_WEB_BACKEND: app.running.baseUrl,
        ADMIN_WEB_TLS_CERT: certPath,
        ADMIN_WEB_TLS_KEY: join(work, 'tls', 'key.pem'),
      }),
    );
    browser = await launchChrome(spkiHash);
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    for (const child of children) {
      child.kill('SIGTERM');
    }
    await app?.close();
    rmSync(work, { recursive: true, force: true });
  });

  async function openPage(base: string, path: string, selector: string, mobile = true): Promise<Page> {
    const page = await browser.newPage();
    await page.viewport(mobile ? MOBILE.width : 1280, mobile ? MOBILE.height : 800, mobile);
    await page.goto(`${base}${path}`);
    await page.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`);
    return page;
  }

  async function seedUser(): Promise<{ phoneLocal: string; userId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, await hasher.hash(PASSWORD)],
    );
    await grantRole(app.pool, userId, 'CUSTOMER');
    return { phoneLocal: phone.local, userId };
  }

  const login = (phoneLocal: string, password: string, appName: 'FOOD' | 'SHIP') =>
    api(app.running.baseUrl, 'POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phoneLocal, password, device: { device_id: `web-${appName.toLowerCase()}-0001`, platform: 'WEB', app: appName } },
    });

  it('11Food: forgot password -> ONE form (no code screen) -> acknowledgement -> login with the new password; the old password and the old session are dead', async () => {
    const user = await seedUser();
    const old = await login(user.phoneLocal, PASSWORD, 'FOOD');
    expect(old.status).toBe(200);
    const oldToken = String((old.body.data as Record<string, unknown>).access_token);

    const page = await openPage(foodOrigin, '/reset', '#reset-submit');
    try {
      await page.waitFor(`document.querySelector('#reset-submit')?.disabled === false`);
      expect(await page.text('#reset-mode-note')).toContain('Bản test: đặt lại mật khẩu chưa yêu cầu OTP');
      expect(await page.evaluate<boolean>(`document.querySelector('#otp') === null`)).toBe(true);
      await page.fill('#phone', user.phoneLocal);
      await page.fill('#new-password', NEW_PASSWORD);
      await page.fill('#new-password-confirm', NEW_PASSWORD);
      await page.click('#reset-submit');
      await page.waitFor(`document.querySelector('#reset-ack') !== null`);
      expect(await page.text('#reset-ack')).toBe(ACK);
      expect(await page.evaluate<string>('location.pathname + location.search + location.hash')).toBe('/reset');
      const stored = await page.evaluate<string>('JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])');
      expect(stored).not.toContain(NEW_PASSWORD);

      expect((await api(app.running.baseUrl, 'GET', '/client-auth/me', { bearer: oldToken })).status).toBe(401);
      expect((await login(user.phoneLocal, PASSWORD, 'FOOD')).status).toBe(401);

      await page.click('#reset-to-login');
      await page.waitFor(`location.pathname === '/login'`);
      await page.fill('#phone', user.phoneLocal);
      await page.fill('#password', NEW_PASSWORD);
      await page.click('#login-submit');
      await page.waitFor(`location.pathname !== '/login'`);
    } finally {
      await page.close();
    }
    expect((await login(user.phoneLocal, NEW_PASSWORD, 'FOOD')).status).toBe(200);
  }, 120_000);

  it('11Ship: the same one-form reset, with the Ship front', async () => {
    const user = await seedUser();
    const page = await openPage(shipOrigin, '/reset', '#reset-submit');
    try {
      await page.waitFor(`document.querySelector('#reset-submit')?.disabled === false`);
      await page.fill('#phone', user.phoneLocal);
      await page.fill('#new-password', NEW_PASSWORD);
      await page.fill('#new-password-confirm', NEW_PASSWORD);
      await page.click('#reset-submit');
      await page.waitFor(`document.querySelector('#reset-ack') !== null`);
      expect(await page.text('#reset-ack')).toBe(ACK);
    } finally {
      await page.close();
    }
    expect((await login(user.phoneLocal, PASSWORD, 'SHIP')).status).toBe(401);
    expect((await login(user.phoneLocal, NEW_PASSWORD, 'SHIP')).status).toBe(200);
  }, 120_000);

  it('Web Admin: /reset is ONE form (no code); the ADMIN signs in with the new password and still needs the Authenticator step', async () => {
    const admin = await createAdminMember(app);
    const page = await openPage(adminOrigin, '/reset', '#reset-password', false);
    try {
      expect(await page.text('#reset-test-mode')).toContain('Bản test: đặt lại mật khẩu chưa yêu cầu OTP');
      expect(await page.evaluate<boolean>(`document.querySelector('#reset-code') === null`)).toBe(true);
      await page.fill('#reset-phone', admin.phone.local);
      await page.fill('#reset-password', NEW_PASSWORD);
      await page.fill('#reset-password-confirm', NEW_PASSWORD);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.body.innerText.includes('Yêu cầu đã xử lý')`);
    } finally {
      await page.close();
    }
    expect((await app.call('POST', '/login', { body: loginBody(admin) })).status).toBe(401);
    const next = await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) });
    expect(next.status).toBe(200);
    expect(next.body.data).toMatchObject({ next_step: 'ENROLL_TOTP' });
  }, 120_000);
});
