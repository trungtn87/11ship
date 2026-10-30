import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { ChildProcess, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import { ADMIN_ORIGIN, AdminApp, adminTestEnv, createAdminMember, createSystem, loginBody, startAdminApp } from './support/admin-fixtures';
import { freePort, repoRoot, runScript, startFront as startAdminFront } from './support/admin-web-harness';
import { api, dataOf } from './support/auth-fixtures';
import { Browser, launchChrome } from './support/cdp';

// Mini Business PWA /business/ -> "Quên mật khẩu?" (issue #235) in a REAL headless Chrome, a phone-sized window, against the REAL backend
// (ACCOUNT_RECOVERY_MODE=SMS_OTP) and PostgreSQL (TEST database only). The reset page lives UNDER /business/ (inside the PWA scope) and
// returns to /business/. The reused Web Admin flow below it is described here as it was:
// Web Admin /reset in a REAL headless Chrome against the REAL backend (ACCOUNT_RECOVERY_MODE=SMS_OTP) and PostgreSQL (TEST database
// only): phone -> the SMS code -> new password. The "phone" is played by calls to /v1/sms-gateway with the pairing credential; the code
// is read from the claimed job exactly where a real phone gets it. The old password dies, the new one works, TOTP is still required.

const NEW_PASSWORD = 'Mật khẩu mới 67890 ü';
const OPEN: SmsGatewayConfig = { recipientMode: 'OPEN', allowlist: new Set(), limitPhonePerHour: 3, limitPhonePerDay: 5, limitGlobalPerDay: 1000, onlineWindowSeconds: 90, leaseSeconds: 60, pollSeconds: 5 };

describe('Mini Business PWA forgot-password in a real browser', () => {
  let app: AdminApp;
  let browser: Browser;
  let work: string;
  let adminOrigin = '';
  let token = '';
  const children: ChildProcess[] = [];

  const ctl = async (...argv: string[]): Promise<string[]> => {
    const out: string[] = [];
    const code = await runSmsGatewayCli({ env: adminTestEnv(), argv, out: (l) => out.push(l), err: () => undefined });
    expect(code).toBe(0);
    return out;
  };
  const gw = (path: string, body: unknown = {}) => api(app.running.baseUrl, 'POST', `/sms-gateway${path}`, { bearer: token, body });

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), '11ship-business-reset-'));
    const root = repoRoot();
    runScript('admin-web-build.mjs');
    execFileSync(process.execPath, [join(root, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '1'], { cwd: root, stdio: 'pipe' });
    const certPath = join(work, 'tls', 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const adminPort = await freePort();
    adminOrigin = `https://localhost:${String(adminPort)}`;
    app = await startAdminApp({ allowedOrigins: [adminOrigin, ADMIN_ORIGIN], smsGateway: OPEN });
    await app.pool.query('DELETE FROM app.sms_jobs');
    await app.pool.query('DELETE FROM app.sms_gateway_devices');
    const out = await ctl('pair', '--label', 'Browser phone');
    token = /: ([A-Za-z0-9_-]{43})$/.exec(out[1] ?? '')?.[1] as string;
    await ctl('enable');
    expect((await gw('/heartbeat', { app_version: '0.2.0', sms_permission: true, paused: false })).status).toBe(200);
    children.push(
      await startAdminFront({ ADMIN_WEB_PORT: String(adminPort), ADMIN_WEB_HOST: 'localhost', ADMIN_WEB_BACKEND: app.running.baseUrl, ADMIN_WEB_TLS_CERT: certPath, ADMIN_WEB_TLS_KEY: join(work, 'tls', 'key.pem') }),
    );
    browser = await launchChrome(spkiHash);
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    for (const child of children) {
      child.kill('SIGTERM');
    }
    try {
      await app.pool.query('DELETE FROM app.sms_jobs');
      await app.pool.query('DELETE FROM app.sms_gateway_devices');
      await app.pool.query('DELETE FROM app.sms_gateway_control');
    } finally {
      await app?.close();
      rmSync(work, { recursive: true, force: true });
    }
  });

  const pathOf = (page: { evaluate<T>(e: string): Promise<T> }): Promise<string> => page.evaluate<string>('location.pathname');
  const smsFor = async (to: string): Promise<{ job_id: string; attempt_id: string; to: string; text: string } | null> => {
    const job = dataOf(await gw('/jobs/claim', { sms_permission: true, paused: false })).job as { job_id: string; attempt_id: string; to: string; text: string } | null;
    expect(job === null || job.to === to).toBe(true);
    return job;
  };

  it('/business/: "Quên mật khẩu?" stays inside /business/, the SMS flow resets the password, and "Về trang đăng nhập" returns to /business/ without a loop', async () => {
    const admin = await createAdminMember(app);
    const page = await browser.newPage();
    try {
      await page.viewport(390, 760, true);
      await page.goto(`${adminOrigin}/business/`);
      await page.waitFor(`document.querySelector('a[href="/business/reset"]') !== null`);
      expect(await page.evaluate<string>(`document.querySelector('a[href="/business/reset"]').textContent`)).toBe('Quên mật khẩu?');
      expect(await page.evaluate<boolean>(`document.querySelector('a[href="/reset"]') === null`)).toBe(true);
      await page.evaluate(`document.querySelector('a[href="/business/reset"]').click()`);
      await page.waitFor(`document.querySelector('#reset-phone') !== null`);
      expect(await pathOf(page)).toBe('/business/reset');
      await page.fill('#reset-phone', admin.phone.local);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.querySelector('#reset-code') !== null`);
      const claimed = (await smsFor(admin.phone.normalized)) as { job_id: string; attempt_id: string; to: string; text: string };
      expect(claimed).not.toBeNull();
      const code = /([0-9]{6})/.exec(claimed.text)?.[1] as string;
      expect((await gw(`/jobs/${claimed.job_id}/ack`, { attempt_id: claimed.attempt_id, result: 'SENT' })).status).toBe(200);
      // A wrong code keeps the page where it is (still under /business/) and says so.
      await page.fill('#reset-code', code === '000000' ? '111111' : '000000');
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.body.innerText.includes('không đúng') || document.body.innerText.includes('sai')`);
      expect(await pathOf(page)).toBe('/business/reset');
      await page.fill('#reset-code', code);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.querySelector('#reset-password') !== null`);
      await page.fill('#reset-password', NEW_PASSWORD);
      await page.fill('#reset-password-confirm', NEW_PASSWORD);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.body.innerText.includes('mật khẩu đã được đặt lại')`);
      // Back to Mini Business, not to the Web Admin login, and the login form is shown (no bounce between /business/ and /reset).
      await page.evaluate(`[...document.querySelectorAll('a,button')].find((el) => /đăng nhập/i.test(el.textContent ?? '')).click()`);
      await page.waitFor(`location.pathname === '/business/' && document.querySelector('a[href="/business/reset"]') !== null`);
      expect(await pathOf(page)).toBe('/business/');
      const storage = await page.evaluate<string>(`JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])`);
      expect(storage).not.toMatch(/password|otp|code|token/i);
    } finally {
      await page.close();
    }
    expect((await app.call('POST', '/login', { body: loginBody(admin) })).status).toBe(401);
    const next = await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) });
    expect(next.status).toBe(200);
  }, 180_000);

  it('a SYSTEM number gets the same screens (no account enumeration) but never an SMS and never a reset', async () => {
    const system = await createSystem(app);
    const page = await browser.newPage();
    try {
      await page.viewport(390, 760, true);
      await page.goto(`${adminOrigin}/business/reset`);
      await page.waitFor(`document.querySelector('#reset-phone') !== null`);
      await page.fill('#reset-phone', system.phone.local);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.querySelector('#reset-code') !== null`);
      expect(await smsFor(system.phone.normalized)).toBeNull();
      expect((await app.call('POST', '/login', { body: loginBody(system) })).status).toBe(200);
    } finally {
      await page.close();
    }
    expect(randomUUID()).toBeTruthy();
  }, 180_000);
});
