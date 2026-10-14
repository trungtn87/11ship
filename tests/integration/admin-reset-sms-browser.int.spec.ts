import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { ChildProcess, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import { ADMIN_ORIGIN, AdminApp, adminTestEnv, createAdminMember, loginBody, startAdminApp } from './support/admin-fixtures';
import { freePort, repoRoot, runScript, startFront as startAdminFront } from './support/admin-web-harness';
import { api, dataOf } from './support/auth-fixtures';
import { Browser, launchChrome } from './support/cdp';

// Web Admin /reset in a REAL headless Chrome against the REAL backend (ACCOUNT_RECOVERY_MODE=SMS_OTP) and PostgreSQL (TEST database
// only): phone -> the SMS code -> new password. The "phone" is played by calls to /v1/sms-gateway with the pairing credential; the code
// is read from the claimed job exactly where a real phone gets it. The old password dies, the new one works, TOTP is still required.

const NEW_PASSWORD = 'Mật khẩu mới 67890 ü';
const OPEN: SmsGatewayConfig = { recipientMode: 'OPEN', allowlist: new Set(), limitPhonePerHour: 3, limitPhonePerDay: 5, limitGlobalPerDay: 1000, onlineWindowSeconds: 90, leaseSeconds: 60, pollSeconds: 5 };

describe('Web Admin SMS password reset in a real browser', () => {
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
    work = mkdtempSync(join(tmpdir(), '11ship-admin-reset-'));
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

  it('/reset: phone -> SMS code -> new password; no test banner; the ADMIN signs in with the new password and still needs the Authenticator step', async () => {
    const admin = await createAdminMember(app);
    const page = await browser.newPage();
    try {
      await page.viewport(1280, 800, false);
      await page.goto(`${adminOrigin}/reset`);
      await page.waitFor(`document.querySelector('#reset-phone') !== null`);
      expect(await page.evaluate<string>('document.body.innerText')).not.toMatch(/Bản test|thử nghiệm|mô phỏng/);
      await page.fill('#reset-phone', admin.phone.local);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.querySelector('#reset-code') !== null`);
      const claimed = dataOf(await gw('/jobs/claim', { sms_permission: true, paused: false })).job as { job_id: string; attempt_id: string; to: string; text: string };
      expect(claimed.to).toBe(admin.phone.normalized);
      const code = /([0-9]{6})/.exec(claimed.text)?.[1] as string;
      expect((await gw(`/jobs/${claimed.job_id}/ack`, { attempt_id: claimed.attempt_id, result: 'SENT' })).status).toBe(200);
      await page.fill('#reset-code', code);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.querySelector('#reset-password') !== null`);
      await page.fill('#reset-password', NEW_PASSWORD);
      await page.fill('#reset-password-confirm', NEW_PASSWORD);
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await page.waitFor(`document.body.innerText.includes('mật khẩu đã được đặt lại')`);
    } finally {
      await page.close();
    }
    expect((await app.call('POST', '/login', { body: loginBody(admin) })).status).toBe(401);
    const next = await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) });
    expect(next.status).toBe(200);
    expect(next.body.data).toMatchObject({ next_step: 'ENROLL_TOTP' });
    expect(randomUUID()).toBeTruthy();
  }, 180_000);
});
