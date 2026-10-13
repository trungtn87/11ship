import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createHash, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { ADMIN_ORIGIN, AdminApp, count, createSystem, enrollAndLogin, rewindAcceptedStep, startAdminApp, SystemAccount, totpNow } from './support/admin-fixtures';
import { freePort, runScript, startFront } from './support/admin-web-harness';
import { randomPhone } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';

// Local test contract (2026-10-13), the one real smoke: SYSTEM invitation (in the page) -> link -> password (no OTP) ->
// Authenticator -> completion -> ADMIN login, in a real headless Chrome through the local HTTPS front, against the real backend
// and PostgreSQL with ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=DISABLED_TEST. No SMS provider exists in this app.

const NEW_PASSWORD = 'Correct-Horse-Battery-9';

describe('M01 admin activation without phone verification (DISABLED_TEST) in a real browser', () => {
  let app: AdminApp;
  let front: ChildProcess | undefined;
  let browser: Browser;
  let origin: string;
  let tlsDir: string;

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-web-test-mode-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationOrigin: origin, activationDisabledTest: true });
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
  });

  it('SYSTEM invites, the link opens straight on the password step, Authenticator completes, the new ADMIN signs in', async () => {
    const system: SystemAccount = await createSystem(app);
    const api = await enrollAndLogin(app, system);
    const page: Page = await browser.newPage();
    await page.viewport(1280, 800, false);
    await page.send('Network.clearBrowserCookies');

    // SYSTEM signs in and creates the invitation in the page.
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', system.phone.local);
    await page.fill('#password', system.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, system.userId);
    await page.fill('#verify-code', totpNow(api.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);

    const phone = randomPhone();
    app.track(phone.normalized);
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-name', 'Quản Trị Thử');
    await page.fill('#f-phone', phone.local);
    await page.click('#p-SHOP-canView');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await rewindAcceptedStep(app, system.userId);
    await page.fill('#step-code', totpNow(api.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#issued-link') && document.querySelector('#issued-link').value !== ''`);
    const link = await page.evaluate<string>(`document.querySelector('#issued-link').value`);
    expect(link).toMatch(/^https:\/\/localhost:\d+\/activate#t=[A-Za-z0-9_-]{43}$/);
    await page.close();

    // The invited person opens the link in a clean browser state.
    const guest = await browser.newPage();
    await guest.viewport(1280, 800, false);
    await guest.send('Network.clearBrowserCookies');
    await guest.goto(link);
    // No OTP screen: the first step is the password. The page says nothing about an expired link.
    await guest.waitFor(`document.querySelector('#act-pw')`);
    expect(await guest.evaluate<boolean>(`document.querySelector('#act-send') === null && document.querySelector('#act-otp-code') === null`)).toBe(true);
    expect(await guest.evaluate<string>('location.pathname + location.hash')).toBe('/activate');
    expect(guest.posts('/v1/admin-activation/start')).toBe(1);
    expect(guest.posts('/v1/admin-activation/otp/request')).toBe(0);
    await guest.fill('#act-pw', NEW_PASSWORD);
    await guest.fill('#act-pw2', NEW_PASSWORD);
    await guest.pressEnter();
    await guest.waitFor(`document.querySelector('.qr svg path')`);
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);

    await guest.click('#act-key-toggle');
    await guest.waitFor(`document.querySelector('#act-key').textContent.length > 0`);
    const secret = (await guest.text('#act-key')).replace(/\s+/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await guest.fill('#act-en-code', totpNow(secret));
    await guest.pressEnter();
    await guest.waitFor(`document.querySelector('#act-login')`);
    expect(guest.posts('/v1/admin-activation/otp/request')).toBe(0);
    expect(guest.posts('/v1/admin-activation/otp/verify')).toBe(0);
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_activation_attempts WHERE phone_verification_mode = 'DISABLED_TEST' AND status = 'COMPLETED' AND otp_verified_at IS NULL`)).toBeGreaterThanOrEqual(1);
    const cookies = await guest.cookies(`${origin}/`);
    expect(cookies.some((cookie) => cookie.name === ADMIN_SESSION_COOKIE || cookie.name.endsWith(ADMIN_SESSION_COOKIE))).toBe(false);

    // ADMIN login with the new password and the new Authenticator.
    await guest.click('#act-login');
    await guest.waitFor(`document.querySelector('#login-title')`);
    const created = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    const userId = (created.rows[0] as { user_id: string }).user_id;
    await guest.fill('#phone', phone.local);
    await guest.fill('#password', NEW_PASSWORD);
    await guest.pressEnter();
    await guest.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, userId);
    await guest.fill('#verify-code', totpNow(secret));
    await guest.pressEnter();
    await guest.waitFor(`document.querySelector('#shell-title')`);
    expect(await guest.text('.lead .role-badge')).toBe('ADMIN');
    expect(guest.consoleErrors).toEqual([]);
    await guest.close();
  }, 240_000);
});
