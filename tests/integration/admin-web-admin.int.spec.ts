import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { TestDisplayActivationOtpProvider } from '../../apps/backend/src/admin-activation/activation-otp-providers';
import { DEFAULT_ACTIVATION_LIMITS } from '../../apps/backend/src/config/admin-activation-config';
import { ADMIN_COPY, COPY } from '../../apps/admin-web/src/core/messages';
import { ADMIN_ORIGIN, AdminApp, count, createAdminMember, createSystem, enrollAndLogin, rewindAcceptedStep, startAdminApp, SystemAccount, totpNow, wrongCode } from './support/admin-fixtures';
import { act } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { createInvitation, createPayload, insertRawInvitation, systemSession } from './support/provisioning-fixtures';
import { randomPhone } from './support/auth-fixtures';
import { Browser, CdpCookie, launchChrome, Page } from './support/cdp';
import { decodeQrMatrix, matrixFromPath } from './support/qr-decode';

// M01-D-ADMIN-WEB - the BUILT administration web (SYSTEM invitations + ADMIN activation) in a REAL headless Chrome,
// against the REAL backend (M01-D-ADMIN-1A/1B/1C) and PostgreSQL, through the local HTTPS front Owner uses. Only the SMS
// provider is the backend's explicit TEST_DISPLAY one (it hands the code back to the page; no SMS exists in this stage).
// Faults (a lost answer) are injected by the browser's DevTools AFTER the backend committed, as in the login UI spec.

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

const DESKTOP = { width: 1280, height: 800, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };
type Size = typeof DESKTOP;

const LINK_PATTERN = /^https:\/\/localhost:\d+\/activate#t=[A-Za-z0-9_-]{43}$/;
const NEW_PASSWORD = 'Correct-Horse-Battery-9';
const LINK_FAILURE_LIMIT = 3;

describe('M01-D-ADMIN-WEB - SYSTEM invitations and ADMIN activation in a real browser against the real backend', () => {
  let app: AdminApp;
  let front: ChildProcess | undefined;
  let browser: Browser;
  let origin: string;
  let system: SystemAccount;
  let tlsDir: string;
  const shots: Shot[] = [];

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-web-admin-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({
      allowedOrigins: [origin, ADMIN_ORIGIN],
      activationOrigin: origin,
      activationProvider: new TestDisplayActivationOtpProvider(),
      activationConfig: { otpMode: 'TEST_DISPLAY', limits: { ...DEFAULT_ACTIVATION_LIMITS, linkFailureLimit: LINK_FAILURE_LIMIT } },
    });
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

  // ---- helpers ----

  async function openAt(url: string, size: Size = DESKTOP): Promise<Page> {
    const page = await browser.newPage();
    await page.viewport(size.width, size.height, size.mobile);
    // One cookie jar for the whole browser: every test starts without the cookies of the previous one.
    await page.send('Network.clearBrowserCookies');
    await page.goto(url);
    return page;
  }

  async function shot(page: Page, name: string): Promise<void> {
    await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    shots.push({ name, data: await page.screenshot() });
  }

  async function ourCookies(page: Page): Promise<Map<string, CdpCookie>> {
    const cookies = await page.cookies(`${origin}/`);
    return new Map(cookies.filter((cookie) => cookie.name.startsWith('__Host-11admin')).map((cookie) => [cookie.name, cookie]));
  }

  /** Nothing of a credential is in page storage or readable by script. */
  async function expectNothingStored(page: Page, secrets: string[]): Promise<void> {
    const storage = await page.evaluate<{ local: Record<string, string>; session: Record<string, string>; cookie: string }>(
      '({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })',
    );
    expect(storage.cookie).toBe('');
    expect(storage.session).toEqual({});
    expect(Object.keys(storage.local).filter((key) => key !== '11admin.device_id')).toEqual([]);
    const dump = JSON.stringify(storage);
    for (const secret of secrets) {
      expect(dump).not.toContain(secret);
    }
  }

  const bodyText = (page: Page): Promise<string> => page.evaluate<string>('document.body.innerText');

  async function expectText(page: Page, text: string): Promise<void> {
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`);
  }

  /** Full login of an account that already has an ACTIVE factor (made through the API). */
  async function uiLogin(page: Page, account: SystemAccount, secret: string): Promise<void> {
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', account.phone.local);
    await page.fill('#password', account.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, account.userId);
    await page.fill('#verify-code', totpNow(secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }

  /** Fresh SYSTEM session in the browser. */
  async function systemPage(size: Size = DESKTOP, path = '/'): Promise<{ page: Page; secret: string }> {
    const api = await enrollAndLogin(app, system);
    const page = await openAt(`${origin}/`, size);
    await uiLogin(page, system, api.secret);
    if (path !== '/') {
      await page.goto(`${origin}${path}`);
    }
    return { page, secret: api.secret };
  }

  /** Types the current Authenticator code of the SYSTEM on the step-up field and submits. */
  async function stepUpCode(page: Page, secret: string): Promise<void> {
    await rewindAcceptedStep(app, system.userId);
    await page.fill('#step-code', totpNow(secret));
    await page.pressEnter();
  }

  async function createUi(page: Page, secret: string, input: { name: string; phone: string; note?: string }): Promise<string> {
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-name', input.name);
    await page.fill('#f-phone', input.phone);
    await page.fill('#f-note', input.note ?? '');
    await page.click('#p-SHOP-canView');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await stepUpCode(page, secret);
    await page.waitFor(`document.querySelector('#issued-link') && document.querySelector('#issued-link').value !== ''`);
    return page.evaluate<string>(`document.querySelector('#issued-link').value`);
  }

  async function pendingIdOf(normalizedPhone: string): Promise<string> {
    const result = await app.pool.query<{ invitation_id: string }>(
      `SELECT invitation_id FROM app.admin_invitations WHERE phone_normalized = $1 AND status = 'PENDING'`,
      [normalizedPhone],
    );
    expect(result.rows).toHaveLength(1);
    return (result.rows[0] as { invitation_id: string }).invitation_id;
  }

  const invitationsOf = (normalizedPhone: string): Promise<number> =>
    count(app.pool, 'SELECT 1 FROM app.admin_invitations WHERE phone_normalized = $1', [normalizedPhone]);

  // =====================================================================================================================
  // B. SYSTEM: invitations
  // =====================================================================================================================

  it('SYSTEM creates an invitation: wrong then right Authenticator code, link shown once and dropped, nothing stored; list, filter, detail', async () => {
    const { page, secret } = await systemPage();
    const phone = randomPhone();
    app.track(phone.normalized);
    await page.goto(`${origin}/invitations`);
    await page.waitFor(`document.querySelector('#invitations-new')`);
    await shot(page, '10-invitations-empty-desktop');

    await page.click('#invitations-new');
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    // Nothing is sent for an invalid form.
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#f-name-error') && !document.querySelector('#f-name-error').hidden`);
    expect(page.posts('/v1/admin/operations')).toBe(0);
    await shot(page, '11-compose-errors-desktop');

    await page.fill('#f-name', '  Nguyễn Văn Quản Trị  ');
    await page.fill('#f-phone', phone.local);
    await page.fill('#f-note', 'ca sáng');
    await page.click('#p-SHOP-canView');
    await page.click('#p-SHOP-canLock');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await shot(page, '12-step-up-desktop');
    expect(page.posts('/v1/admin/operations')).toBe(1);

    // A wrong code: the approved message, the field is emptied, the operation stays usable.
    await page.fill('#step-code', wrongCode(secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#compose-code-error') && !document.querySelector('#compose-code-error').hidden`);
    expect(await page.text('#compose-code-error')).toBe(COPY.totpInvalid);
    expect(await page.evaluate<string>(`document.querySelector('#step-code').value`)).toBe('');
    expect(await invitationsOf(phone.normalized)).toBe(0);

    // The right code (a pasted one with a space keeps its digits).
    await rewindAcceptedStep(app, system.userId);
    const code = totpNow(secret);
    await page.fill('#step-code', `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(await page.evaluate<string>(`document.querySelector('#step-code').value`)).toBe(code);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#issued-link') && document.querySelector('#issued-link').value !== ''`);
    const link = await page.evaluate<string>(`document.querySelector('#issued-link').value`);
    expect(link).toMatch(LINK_PATTERN);
    expect(await invitationsOf(phone.normalized)).toBe(1);
    expect(await page.text('.done .subtitle')).toBe('Đã tạo lời mời');
    await shot(page, '13-invitation-created-desktop');
    expect(page.posts('/v1/admin/operations')).toBe(1);
    expect(page.posts('/v1/admin/invitations')).toBe(1);

    // The link and the code are in no storage, and they leave the page with the screen.
    await expectNothingStored(page, [link.split('#t=')[1] as string, code, secret]);
    await page.click('.done .actions a');
    await page.waitFor(`document.querySelector('.rows .row')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#issued-link') === null && !document.body.innerHTML.includes(${JSON.stringify(link.split('#t=')[1])})`)).toBe(true);

    // The list shows the row (masked phone, status), the filter narrows it, the detail has the permissions.
    expect(await page.text('.rows .row-name')).toBe('Nguyễn Văn Quản Trị');
    expect(await page.text('.rows .status')).toBe('Chờ kích hoạt');
    expect(await bodyText(page)).not.toContain(phone.local);
    await page.evaluate(`(() => { const s = document.querySelector('#filter'); s.value = 'REVOKED'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitFor(`document.querySelector('.empty') && !document.querySelector('.empty').hidden`);
    await page.evaluate(`(() => { const s = document.querySelector('#filter'); s.value = 'PENDING'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitFor(`document.querySelector('.rows .row')`);
    await page.click('.rows .row a');
    await page.waitFor(`document.querySelector('.perm-table tbody tr')`);
    expect(await page.text('.perm-table tbody tr')).toContain('Có');
    await shot(page, '14-invitation-detail-desktop');
    await page.reload();
    await page.waitFor(`document.querySelector('.perm-table tbody tr')`);
    expect(page.consoleErrors).toEqual([]);

    // The same phone cannot be invited twice while a PENDING one exists: the page says so, nothing new is created.
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-name', 'Người Thứ Hai');
    await page.fill('#f-phone', phone.local);
    await page.click('#p-SHOP-canView');
    await page.click('#compose-submit');
    // The backend may refuse the duplicate at the operation or at the business request: either way the page says so.
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ADMIN_COPY.pendingExists)}) || (document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null)`);
    if (await page.visible('#step-code')) {
      await stepUpCode(page, secret);
    }
    await expectText(page, ADMIN_COPY.pendingExists);
    expect(await invitationsOf(phone.normalized)).toBe(1);
    await page.close();
  }, 180_000);

  it('a lost answer of the create request: no second code is sent, "Kiểm tra lại" repeats the SAME request and returns the same invitation', async () => {
    const { page, secret } = await systemPage();
    const phone = randomPhone();
    app.track(phone.normalized);
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-name', 'Lê Thị Mất Mạng');
    await page.fill('#f-phone', phone.local);
    await page.click('#p-SHOP-canView');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);

    // The business request is processed and COMMITTED by the real backend; its answer never reaches the page.
    await page.interceptResponses('*/v1/admin/invitations');
    await stepUpCode(page, secret);
    const paused = await page.nextPausedResponse();
    expect(paused.status).toBe(201);
    expect(await invitationsOf(phone.normalized)).toBe(1);
    await page.failResponse(paused.requestId);
    await page.stopIntercepting();

    await page.waitFor(`document.querySelector('#retry-business') && document.querySelector('#retry-business').offsetParent !== null`);
    await shot(page, '15-create-answer-lost-desktop');
    // Only reads or the page's own explicit retry may follow; nothing was re-sent by itself.
    expect(page.posts('/v1/admin/invitations')).toBe(1);
    expect(page.posts('/v1/admin/operations')).toBe(1);
    const verifies = page.requests.filter((request) => request.method === 'POST' && /^\/v1\/admin\/operations\/[^/]+\/verify$/.test(new URL(request.url).pathname)).length;
    expect(verifies).toBe(1);

    // The user repeats on purpose: the same Idempotency-Key and operation, so the backend replays the committed result.
    await page.click('#retry-business');
    await page.waitFor(`document.querySelector('#issued-link') && document.querySelector('#issued-link').value !== ''`);
    expect(await page.evaluate<string>(`document.querySelector('#issued-link').value`)).toMatch(LINK_PATTERN);
    expect(page.posts('/v1/admin/invitations')).toBe(2);
    expect(page.posts('/v1/admin/operations')).toBe(1);
    expect(await invitationsOf(phone.normalized)).toBe(1);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_sensitive_operations WHERE action = 'CREATE_INVITATION' AND actor_user_id = $1::uuid`, [system.userId])).toBe(1);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 180_000);

  it('SYSTEM reissues (old link superseded, new link shown) and revokes a PENDING invitation, including an expired PENDING one', async () => {
    const { page, secret } = await systemPage();
    const phone = randomPhone();
    app.track(phone.normalized);
    const first = await createUi(page, secret, { name: 'Phạm Cấp Lại', phone: phone.local });
    const firstId = await pendingIdOf(phone.normalized);

    // Reissue with the same permissions.
    await page.goto(`${origin}/invitations/${firstId}/reissue`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-reason', 'Người được mời làm mất liên kết');
    await shot(page, '16-reissue-desktop');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await stepUpCode(page, secret);
    await page.waitFor(`document.querySelector('#issued-link') && document.querySelector('#issued-link').value !== ''`);
    const second = await page.evaluate<string>(`document.querySelector('#issued-link').value`);
    expect(second).toMatch(LINK_PATTERN);
    expect(second).not.toBe(first);
    expect(await page.text('.done .subtitle')).toBe('Đã cấp lại liên kết');
    const statuses = await app.pool.query<{ status: string }>('SELECT status FROM app.admin_invitations WHERE phone_normalized = $1 ORDER BY created_at', [phone.normalized]);
    expect(statuses.rows.map((row) => row.status)).toEqual(['SUPERSEDED', 'PENDING']);

    // Revoke the new PENDING one.
    const secondId = await pendingIdOf(phone.normalized);
    await page.goto(`${origin}/invitations/${secondId}/revoke`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-reason', 'Mời nhầm người');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await stepUpCode(page, secret);
    await expectText(page, 'Đã thu hồi lời mời');
    expect(await count(app.pool, `SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid AND status = 'REVOKED'`, [secondId])).toBe(1);

    // An invitation already past its expiry is still PENDING in the database: the list says so and it can be revoked.
    const expiredPhone = randomPhone();
    app.track(expiredPhone.normalized);
    const expiredId = await insertRawInvitation(app.pool, { createdBy: system.userId, phoneNormalized: expiredPhone.normalized, expired: true });
    await page.goto(`${origin}/invitations`);
    await expectText(page, 'Chờ kích hoạt · quá hạn');
    await shot(page, '17-invitations-expired-desktop');
    await page.goto(`${origin}/invitations/${expiredId}/revoke`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    await page.fill('#f-reason', 'Hết hạn, dọn dẹp');
    await page.click('#compose-submit');
    await page.waitFor(`document.querySelector('#step-code') && document.querySelector('#step-code').offsetParent !== null`);
    await stepUpCode(page, secret);
    await expectText(page, 'Đã thu hồi lời mời');
    expect(await count(app.pool, `SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid AND status = 'REVOKED'`, [expiredId])).toBe(1);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 240_000);

  it('an ADMIN signs in with Authenticator but has no invitation screens and the API refuses it', async () => {
    const admin = await createAdminMember(app);
    const api = await enrollAndLogin(app, admin);
    const page = await openAt(`${origin}/`);
    await uiLogin(page, admin, api.secret);
    expect(await page.text('.lead .role-badge')).toBe('ADMIN');
    expect(await page.evaluate<boolean>(`document.querySelector('a[href="/invitations"]') === null`)).toBe(true);
    await shot(page, '18-admin-shell-desktop');

    await page.goto(`${origin}/invitations`);
    await expectText(page, 'Không có quyền');
    const answer = await page.evaluate<{ status: number; code: string }>(
      `fetch('/v1/admin/invitations', { credentials: 'same-origin' }).then(async (r) => ({ status: r.status, code: (await r.json()).error.code }))`,
    );
    expect(answer).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    await page.close();
  }, 120_000);

  // =====================================================================================================================
  // C. ADMIN activation
  // =====================================================================================================================

  async function inviteForBrowser(): Promise<{ link: string; token: string; phone: ReturnType<typeof randomPhone>; invitationId: string }> {
    const session = await systemSession(app);
    const phone = randomPhone();
    app.track(phone.normalized);
    const created = await createInvitation(app, session, createPayload(phone.local));
    expect(created.link).toMatch(LINK_PATTERN);
    return { link: created.link, token: created.link.split('#t=')[1] as string, phone, invitationId: created.invitationId };
  }

  /** From the OTP screen to the enrollment screen, in the page: send, read the shown code, verify, password. */
  async function walkToEnroll(page: Page): Promise<{ otp: string }> {
    await page.waitFor(`document.querySelector('#act-send')`);
    await page.click('#act-send');
    await page.waitFor(`document.querySelector('.test-display') && !document.querySelector('.test-display').hidden`);
    const otp = /(\d{6})\s*$/.exec(await page.text('.test-display'))?.[1];
    expect(otp).toBeDefined();
    await page.waitFor(`document.querySelector('#act-otp-code') && document.querySelector('#act-otp-code').offsetParent !== null`);
    await page.fill('#act-otp-code', otp as string);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#act-pw')`);
    await page.fill('#act-pw', NEW_PASSWORD);
    await page.fill('#act-pw2', NEW_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('.qr svg path')`);
    return { otp: otp as string };
  }

  async function revealActivationKey(page: Page): Promise<string> {
    await page.click('#act-key-toggle');
    await page.waitFor(`document.querySelector('#act-key').textContent.length > 0`);
    const key = (await page.text('#act-key')).replace(/\s+/g, '');
    await page.click('#act-key-toggle');
    await page.waitFor(`document.querySelector('#act-key').textContent === ''`);
    return key;
  }

  it('full activation: link fragment removed, one OTP request, reload at every step, a real scannable QR, then login with the new Authenticator', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link);
    await page.waitFor(`document.querySelector('#act-send')`);
    // The token left the address bar before anything was sent, and it is in no request URL.
    expect(await page.evaluate<string>('location.pathname + location.hash')).toBe('/activate');
    expect(page.requests.every((request) => !request.url.includes(invite.token))).toBe(true);
    expect(await page.text('#act-otp-title')).toBe(ADMIN_COPY.activateTitle);
    expect(page.posts('/v1/admin-activation/start')).toBe(1);
    await shot(page, '20-activate-otp-desktop');

    // F5 right after start: the attempt is read back (no token needed, no new start, no SMS).
    await page.reload();
    await page.waitFor(`document.querySelector('#act-send')`);
    expect(page.posts('/v1/admin-activation/start')).toBe(1);
    expect(page.posts('/v1/admin-activation/otp/request')).toBe(0);

    await page.click('#act-send');
    await page.waitFor(`document.querySelector('.test-display') && !document.querySelector('.test-display').hidden`);
    const otp = /(\d{6})\s*$/.exec(await page.text('.test-display'))?.[1] as string;
    expect(otp).toMatch(/^\d{6}$/);
    await shot(page, '21-activate-code-sent-desktop');
    expect(page.posts('/v1/admin-activation/otp/request')).toBe(1);

    // F5 after the code was requested: the form is back from the server state; nothing is sent again, the shown code is gone.
    await page.reload();
    await page.waitFor(`document.querySelector('#act-otp-code') && document.querySelector('#act-otp-code').offsetParent !== null`);
    expect(page.posts('/v1/admin-activation/otp/request')).toBe(1);
    expect(await page.evaluate<boolean>(`!document.body.innerText.includes(${JSON.stringify(otp)})`)).toBe(true);

    // A pasted code with a space keeps its digits.
    await page.fill('#act-otp-code', `${otp.slice(0, 3)} ${otp.slice(3)}`);
    expect(await page.evaluate<string>(`document.querySelector('#act-otp-code').value`)).toBe(otp);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#act-pw')`);

    // F5 after the phone is verified: the password step.
    await page.reload();
    await page.waitFor(`document.querySelector('#act-pw')`);
    // Too short and mismatching passwords are refused in the page, nothing is sent.
    await page.fill('#act-pw', 'short');
    await page.fill('#act-pw2', 'short');
    await page.pressEnter();
    await expectText(page, ADMIN_COPY.passwordInvalid);
    await page.fill('#act-pw', NEW_PASSWORD);
    await page.fill('#act-pw2', `${NEW_PASSWORD}-x`);
    await page.pressEnter();
    await expectText(page, ADMIN_COPY.passwordMismatch);
    expect(page.posts('/v1/admin-activation/password')).toBe(0);
    await shot(page, '22-activate-password-desktop');
    await page.fill('#act-pw', NEW_PASSWORD);
    await page.fill('#act-pw2', NEW_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('.qr svg path')`);
    expect(page.posts('/v1/admin-activation/password')).toBe(1);
    // The password fields were emptied as soon as the request had them (the screen was replaced).
    expect(await page.evaluate<boolean>(`document.querySelector('#act-pw') === null`)).toBe(true);

    // The QR is a real symbol: an independent reader finds a valid Reed-Solomon code at level M whose text is the
    // otpauth URI, and its secret is the manual key.
    const drawn = await page.evaluate<{ d: string; box: number }>(
      `(() => { const svg = document.querySelector('.qr svg'); return { d: svg.querySelector('path').getAttribute('d'), box: Number(svg.getAttribute('viewBox').split(' ')[2]) }; })()`,
    );
    const decoded = decodeQrMatrix(matrixFromPath(drawn.d, drawn.box - 8, 4));
    expect(decoded.eccValid).toBe(true);
    expect(decoded.level).toBe('M');
    expect(decoded.text.startsWith('otpauth://totp/')).toBe(true);
    const secret = await revealActivationKey(page);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(new URL(decoded.text).searchParams.get('secret')).toBe(secret);
    await shot(page, '23-activate-authenticator-desktop');

    // F5 on the enrollment step returns the same secret (replayable) and the same drawing.
    await page.reload();
    await page.waitFor(`document.querySelector('.qr svg path')`);
    expect(await page.evaluate<string>(`document.querySelector('.qr svg path').getAttribute('d')`)).toBe(drawn.d);
    expect(await revealActivationKey(page)).toBe(secret);
    // The account does not exist yet: it is created only when the Authenticator code is confirmed.
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).toBe(0);

    // A wrong code keeps the step and empties the field; the right one completes.
    await page.fill('#act-en-code', wrongCode(secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#act-en-code-error') && !document.querySelector('#act-en-code-error').hidden`);
    expect(await page.evaluate<string>(`document.querySelector('#act-en-code').value`)).toBe('');
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).toBe(0);
    const goodCode = totpNow(secret);
    await page.fill('#act-en-code', goodCode);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#act-login')`);
    await shot(page, '24-activate-done-desktop');
    expect(page.posts('/v1/admin-activation/complete')).toBe(2);
    expect(page.posts('/v1/admin-activation/otp/request')).toBe(1);
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).toBe(1);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid AND status = 'ACCEPTED'`, [invite.invitationId])).toBe(1);

    // Activation does NOT sign in: no administration session, nothing of the flow in storage.
    expect((await ourCookies(page)).has(ADMIN_SESSION_COOKIE)).toBe(false);
    await expectNothingStored(page, [invite.token, otp, secret, goodCode, NEW_PASSWORD]);

    // Back to the login page: password + the new Authenticator open the shell as ADMIN.
    await page.click('#act-login');
    await page.waitFor(`document.querySelector('#login-title')`);
    const created = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    const account: SystemAccount = { phone: invite.phone, password: NEW_PASSWORD, userId: (created.rows[0] as { user_id: string }).user_id };
    await page.fill('#phone', account.phone.local);
    await page.fill('#password', NEW_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, account.userId);
    await page.fill('#verify-code', totpNow(secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
    expect(await page.text('.lead .role-badge')).toBe('ADMIN');
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 240_000);

  it('activation on a phone-sized screen fits without sideways scrolling and every control has a name', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link, MOBILE);
    await page.waitFor(`document.querySelector('#act-send')`);
    const noOverflow = `document.documentElement.scrollWidth <= window.innerWidth`;
    const unnamed = `Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && document.querySelector('label[for="' + e.id + '"]')))).map((e) => e.id || e.name)`;
    expect(await page.evaluate<boolean>(noOverflow)).toBe(true);
    await shot(page, '30-activate-otp-mobile');
    await walkToEnroll(page);
    expect(await page.evaluate<boolean>(noOverflow)).toBe(true);
    expect(await page.evaluate<string[]>(unnamed)).toEqual([]);
    await shot(page, '31-activate-authenticator-mobile');
    expect(await page.evaluate<boolean>(`document.querySelector('.qr svg').getBoundingClientRect().width <= window.innerWidth`)).toBe(true);
    await page.close();
  }, 120_000);

  // =====================================================================================================================
  // D. Recovery screens, from real error codes
  // =====================================================================================================================

  it('an unknown link, a malformed link and a missing session each get their own screen; the malformed one sends nothing', async () => {
    const unknown = await openAt(`${origin}/activate#t=${'A'.repeat(43)}`);
    await expectText(unknown, ADMIN_COPY.linkInvalid);
    expect(await unknown.evaluate<string>('location.pathname + location.hash')).toBe('/activate');
    await shot(unknown, '40-activate-link-invalid-desktop');
    await unknown.close();

    const malformed = await openAt(`${origin}/activate#t=not-a-token`);
    await expectText(malformed, ADMIN_COPY.linkInvalid);
    expect(malformed.posts('/v1/admin-activation/start')).toBe(0);
    await malformed.close();

    // No fragment and no cookie: the session cannot be read.
    const none = await openAt(`${origin}/activate`);
    await expectText(none, ADMIN_COPY.sessionInvalid);
    await shot(none, '41-activate-session-expired-desktop');
    await none.close();
  }, 120_000);

  it('a session whose cookie is lost mid-way shows the expired-session screen on reload', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link);
    await page.waitFor(`document.querySelector('#act-send')`);
    await page.send('Network.clearBrowserCookies');
    await page.reload();
    await expectText(page, ADMIN_COPY.sessionInvalid);
    // Only the first load started the attempt; the reload sent no new start (there is no token to send).
    expect(page.posts('/v1/admin-activation/start')).toBe(1);
    await page.close();
  }, 60_000);

  it('a newer attempt replaces the page\'s attempt: the replaced screen on reload', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link);
    await page.waitFor(`document.querySelector('#act-send')`);
    // Another client opens the same link: the backend supersedes the first attempt.
    // (The activation routes accept the Origin of ADMIN_ACTIVATION_ORIGIN only: this test's front.)
    const other = await act(app, 'POST', '/start', { body: { token: invite.token }, origin });
    expect([200, 201]).toContain(other.status);
    await page.reload();
    await expectText(page, ADMIN_COPY.replaced);
    await shot(page, '42-activate-replaced-desktop');
    expect(page.posts('/v1/admin-activation/otp/request')).toBe(0);
    await page.close();
  }, 60_000);

  it('the phone already belongs to an account when the code is confirmed: the conflict screen, nothing created', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link);
    await walkToEnroll(page);
    const secret = await revealActivationKey(page);
    // Someone else registers this phone while the invitee is on the last step.
    const hash = await new Argon2idPasswordHasher().hash(NEW_PASSWORD);
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), invite.phone.normalized, hash],
    );
    await page.fill('#act-en-code', totpNow(secret));
    await page.pressEnter();
    await expectText(page, ADMIN_COPY.phoneConflictActivation);
    await shot(page, '43-activate-phone-conflict-desktop');
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).toBe(1);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_memberships m JOIN app.users u ON u.user_id = m.user_id WHERE u.phone_normalized = $1`, [invite.phone.normalized])).toBe(0);
    await page.reload();
    await expectText(page, ADMIN_COPY.phoneConflictActivation);
    await page.close();
  }, 120_000);

  it('five wrong Authenticator codes end the attempt; "Bắt đầu lại" opens a new one from the same link', async () => {
    const invite = await inviteForBrowser();
    const page = await openAt(invite.link);
    await walkToEnroll(page);
    const secret = await revealActivationKey(page);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await page.fill('#act-en-code', wrongCode(secret));
      await page.pressEnter();
      if (attempt < 5) {
        await page.waitFor(`!document.querySelector('#act-en-code-error').hidden && document.querySelector('#act-en-code').value === ''`);
      }
    }
    await expectText(page, ADMIN_COPY.attemptsExhausted);
    expect(page.posts('/v1/admin-activation/complete')).toBe(5);
    await shot(page, '44-activate-attempts-exhausted-desktop');
    expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).toBe(0);
    await page.reload();
    await expectText(page, ADMIN_COPY.attemptsExhausted);
    await page.click('#act-restart');
    await page.waitFor(`document.querySelector('#act-send')`);
    expect(page.posts('/v1/admin-activation/restart')).toBe(1);
    await page.close();
  }, 180_000);

  it('too many wrong links lock the address: the page shows the wait taken from Retry-After and sends nothing more', async () => {
    // Every attempt goes through the local front, so they all count against the same address bucket.
    let page: Page | undefined;
    for (let index = 0; index <= LINK_FAILURE_LIMIT + 1; index += 1) {
      await page?.close();
      page = await openAt(`${origin}/activate#t=${String.fromCharCode(66 + index).repeat(43)}`);
      await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ADMIN_COPY.linkInvalid)}) || document.body.innerText.includes('thử lại sau')`);
      if ((await bodyText(page)).includes('thử lại sau')) {
        break;
      }
    }
    if (page === undefined) {
      throw new Error('no page');
    }
    expect(await bodyText(page)).toMatch(/thử lại sau \d{2}:\d{2}/);
    expect(await bodyText(page)).not.toContain(ADMIN_COPY.linkInvalid);
    await shot(page, '45-activate-rate-limited-desktop');
    expect(page.posts('/v1/admin-activation/start')).toBe(1);
    await page.close();
  }, 90_000);

  // =====================================================================================================================
  // E. Responsive, keyboard, forms
  // =====================================================================================================================

  it('on a phone: the SYSTEM screens fit, fields have labels and errors are linked, and the form works with the keyboard', async () => {
    const { page } = await systemPage(MOBILE);
    const noOverflow = `document.documentElement.scrollWidth <= window.innerWidth`;
    expect(await page.evaluate<boolean>(noOverflow)).toBe(true);
    await shot(page, '50-shell-mobile');

    await page.goto(`${origin}/invitations`);
    await page.waitFor(`document.querySelector('#invitations-new')`);
    expect(await page.evaluate<boolean>(noOverflow)).toBe(true);
    await shot(page, '51-invitations-mobile');

    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#compose-form') && !document.querySelector('#compose-form').hidden`);
    expect(await page.evaluate<boolean>(noOverflow)).toBe(true);
    const unnamed = await page.evaluate<string[]>(
      `Array.from(document.querySelectorAll('#compose-form input:not([type=hidden]), #compose-form select, #compose-form textarea')).filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && document.querySelector('label[for="' + e.id + '"]')))).map((e) => e.id || e.name)`,
    );
    expect(unnamed).toEqual([]);

    // Keyboard only: Tab moves from the name to the phone; Enter on the empty form focuses the first invalid field, whose
    // error is linked with aria-describedby and read as an alert.
    await page.evaluate(`document.querySelector('#f-name').focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    expect(await page.evaluate<string>('document.activeElement.id')).toBe('f-phone');
    await page.evaluate(`document.querySelector('#f-name').focus()`);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#f-name-error') && !document.querySelector('#f-name-error').hidden`);
    expect(await page.evaluate<string>('document.activeElement.id')).toBe('f-name');
    expect(await page.evaluate<boolean>(`document.querySelector('#f-name').getAttribute('aria-invalid') === 'true' && document.querySelector('#f-name').getAttribute('aria-describedby').includes('f-name-error')`)).toBe(true);
    await shot(page, '52-compose-errors-mobile');
    await page.close();
  }, 180_000);
});

/**
 * Writes the screenshots to .test-results/admin-web-admin-shots. On GitHub Actions the desktop shots are also printed as
 * base64 annotation parts (same mechanism as the login UI spec), because job artifacts cannot always be downloaded.
 */
function publishShots(shots: readonly Shot[]): void {
  const directory = join(repoRoot(), '.test-results', 'admin-web-admin-shots');
  mkdirSync(directory, { recursive: true });
  for (const item of shots) {
    writeFileSync(join(directory, `${item.name}.webp`), item.data);
  }
}
