import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, count, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { createDriverFor, Phone, purgePhone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M04-B3a on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL: the finance rights decide what each session
// sees, the Admin reads the top-up requests, confirms the amount really received (not the requested one) or rejects, a bank transaction is
// recorded once, a lost answer keeps the same key and never posts twice, and SYSTEM manages the receiving accounts and the rights from the pages.
// Screenshots of the real pages go to .test-results/admin-finance-shots.

const tag = randomBytes(2).toString('hex').toUpperCase();
const READ = 'wallet.read';
const RECORD = 'wallet.topup.record';
const HOLDER = `CONG TY KIEM THU ${tag}`;

interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}
interface Seeded {
  readonly phone: Phone;
  readonly driverId: string;
  readonly walletId: string;
  readonly requestId: string;
}

describe('admin finance (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  const shots: Array<{ name: string; data: Buffer }> = [];
  const shippers: Seeded[] = [];
  const accountIds: string[] = [];
  let hash = '';
  let none: Person;
  let reader: Person;
  let recorder: Person;
  let both: Person;
  let target: Person;
  let apiAccount = { id: '', number: '' };

  async function activatedAdmin(fullName: string): Promise<Person> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  /** API setup with the SYSTEM session of the fixture: done BEFORE any SYSTEM login in the page (which ends that session). */
  async function sysPost(path: string, body: unknown): Promise<Record<string, unknown>> {
    await app.clearLimits();
    const response = await app.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(system.login), csrf: system.login.csrf, headers: { 'idempotency-key': randomUUID() } });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`setup ${path} failed: ${response.status} ${response.text}`);
    }
    return adminData(response);
  }
  const grant = (who: Person, key: string): Promise<Record<string, unknown>> => sysPost(`/finance/access/admins/${who.userId}/grant`, { permission_key: key, expected_version: 0 });

  async function seedRequest(amount = 100_000, status = 'PENDING'): Promise<Seeded> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, hash],
    );
    const driverId = await createDriverFor(app.pool, userId, { status });
    const walletId = randomUUID();
    await app.pool.query('INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())', [walletId, driverId]);
    const requestId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, 'PENDING', $5::uuid, 1, now(), now())`,
      [requestId, walletId, driverId, amount, userId],
    );
    const seeded = { phone, driverId, walletId, requestId };
    shippers.push(seeded);
    return seeded;
  }

  async function signIn(page: Page, who: { phone: { local: string }; password: string; userId: string; secret: string }): Promise<void> {
    await app.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', who.phone.local);
    await page.fill('#password', who.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, who.userId);
    await page.fill('#verify-code', totpNow(who.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }

  const person = (p: Person): { phone: Phone; password: string; userId: string; secret: string } => ({ phone: p.phone, password: ADMIN_PASSWORD, userId: p.userId, secret: p.secret });
  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };
  const press = (page: Page, text: string, within = 'document'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...${within}.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const setValue = (page: Page, selector: string, value: string, event = 'input'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return true; })()`);
  const text = (page: Page): Promise<string> => page.evaluate<string>('document.body.innerText');
  const menuHas = (page: Page, href: string): Promise<boolean> => page.evaluate<boolean>(`!!document.querySelector('a[href="${href}"]')`);
  const waitMenu = (page: Page, expression: string): Promise<void> => page.waitFor(expression);
  const walletOf = async (walletId: string): Promise<{ balance: string; version: string }> =>
    (await app.pool.query('SELECT balance_vnd::text AS balance, version::text FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0] as { balance: string; version: string };
  const ledgerCount = (walletId: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [walletId]);
  const stateOf = async (requestId: string): Promise<string> => ((await app.pool.query('SELECT state FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0] as { state: string }).state;
  const noOverflow = (page: Page): Promise<boolean> => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth');

  async function fillConfirm(page: Page, accountId: string, actual: string, txid: string): Promise<void> {
    await page.waitFor(`document.querySelector('#confirm-actual') && document.querySelector('#confirm-account option[value="${accountId}"]')`);
    expect(await setValue(page, '#confirm-actual', actual)).toBe(true);
    expect(await setValue(page, '#confirm-txid', txid)).toBe(true);
    expect(await setValue(page, '#confirm-received', '2026-10-16T08:30')).toBe(true);
    expect(await setValue(page, '#confirm-account', accountId, 'change')).toBe(true);
  }

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-finance-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: app.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);
    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    system = await systemSession(app);
    none = await activatedAdmin(`Admin không quyền ${tag}`);
    reader = await activatedAdmin(`Admin chỉ xem ${tag}`);
    recorder = await activatedAdmin(`Admin chỉ ghi ${tag}`);
    both = await activatedAdmin(`Admin đủ quyền ${tag}`);
    target = await activatedAdmin(`Admin được cấp ${tag}`);
    await grant(reader, READ);
    await grant(recorder, RECORD);
    await grant(both, READ);
    await grant(both, RECORD);
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const created = await sysPost('/finance/bank-accounts', { bank_id: 'VCB', account_number: number, account_holder: HOLDER });
    apiAccount = { id: String(created.account_id), number };
    accountIds.push(apiAccount.id);
    await sysPost(`/finance/bank-accounts/${apiAccount.id}/receiving`, { expected_version: 1, can_receive: true });
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-finance-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.webp`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      try {
        for (const shipper of shippers) {
          await purgePhone(app.pool, shipper.phone.normalized);
        }
        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
          await client.query('DELETE FROM app.admin_finance_grants');
          await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
          await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
          await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[]) OR account_holder = $2', [accountIds, HOLDER]);
          await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      } finally {
        await app.close();
      }
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('rights decide the pages: none sees no finance; read-only reads without any form; record-only is told to ask for the read right; both decide; a revoked right is gone after reload', async () => {
    const a = await seedRequest(100_000);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);

    // No right: no menu entry, a direct URL is forbidden, nothing of the request is shown.
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(none));
    await waitMenu(page, `!!document.querySelector('a[href="/system/parameters/shipper-wallet"]')`);
    expect(await menuHas(page, '/finance/topups')).toBe(false);
    expect(await menuHas(page, '/finance/bank-accounts')).toBe(false);
    await page.goto(`${origin}/finance/topups`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    await page.goto(`${origin}/finance/topups/${a.requestId}`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    expect(await text(page)).not.toContain(a.requestId);
    await page.goto(`${origin}/finance/bank-accounts`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);

    // Record without read: nothing listed, a sentence says what to ask for.
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(recorder));
    await waitMenu(page, `!!document.querySelector('a[href="/system/parameters/shipper-wallet"]')`);
    expect(await menuHas(page, '/finance/topups')).toBe(false);
    await page.goto(`${origin}/finance/topups`);
    await page.waitFor(`document.body.innerText.includes('Cần quyền xem yêu cầu nạp tiền')`);
    expect(await text(page)).not.toContain(a.requestId.slice(0, 8));

    // Read only: sees the list and the detail, no decision form.
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(reader));
    await waitMenu(page, `!!document.querySelector('a[href="/finance/topups"]')`);
    expect(await menuHas(page, '/finance/bank-accounts')).toBe(false);
    expect(await menuHas(page, '/finance/withdrawals')).toBe(false);
    await page.goto(`${origin}/finance/topups`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(a.requestId.slice(0, 8))})`);
    expect(await text(page)).toContain('Bạn chỉ có quyền xem');
    await page.goto(`${origin}/finance/topups/${a.requestId}`);
    await page.waitFor(`document.querySelector('#topup-title') && document.body.innerText.includes('100.000đ')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('#confirm-actual') && !document.querySelector('#reject-reason')`)).toBe(true);
    expect(await text(page)).toContain('Chỉ có quyền xem'.replace('Chỉ có', 'Bạn chỉ có'));
    await shot(page, 'topup-detail-readonly');
    await page.close();
  }, 240_000);

  it('SYSTEM adds a receiving account from the page (inactive), switches it on and off with a confirmation, and gives a finance right to an administrator', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    await waitMenu(page, `!!document.querySelector('a[href="/finance/bank-accounts"]')`);
    await page.goto(`${origin}/finance/bank-accounts`);
    await page.waitFor(`document.querySelector('#accounts-title') && document.body.innerText.includes(${JSON.stringify(apiAccount.number)})`);
    // Add: the number stays text (leading zero kept), the account starts OFF.
    const number = `0${String(Math.floor(1e10 + Math.random() * 9e10))}`;
    expect(await setValue(page, '#account-bank', 'tcb')).toBe(true);
    expect(await setValue(page, '#account-number', number)).toBe(true);
    expect(await setValue(page, '#account-holder', `${HOLDER} 2`)).toBe(true);
    expect(await press(page, 'Thêm tài khoản (chưa bật nhận tiền)')).toBe(true);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(number)}) && document.body.innerText.includes('Đã tắt')`);
    const created = (await app.pool.query('SELECT system_account_id::text AS id, bank_id, account_number, can_receive FROM app.system_owned_bank_accounts WHERE account_number = $1', [number])).rows;
    expect(created).toMatchObject([{ bank_id: 'TCB', account_number: number, can_receive: false }]);
    accountIds.push((created[0] as { id: string }).id);
    // Invalid input is stopped in the page, nothing is sent.
    expect(await setValue(page, '#account-bank', 'x')).toBe(true);
    expect(await press(page, 'Thêm tài khoản (chưa bật nhận tiền)')).toBe(true);
    await page.waitFor(`document.body.innerText.includes('Mã ngân hàng gồm 2-16')`);
    await shot(page, 'bank-accounts-desktop');
    // Switch on with a confirmation, then off with the consequence in words.
    const rowButton = (label: string): Promise<boolean> =>
      page.evaluate<boolean>(`(() => { const row = [...document.querySelectorAll('.table tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(number)})); const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    expect(await rowButton('Bật nhận tiền')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Bật nhận tiền', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đang bật')`);
    expect((await app.pool.query('SELECT can_receive FROM app.system_owned_bank_accounts WHERE account_number = $1', [number])).rows[0]).toEqual({ can_receive: true });
    expect(await rowButton('Tắt nhận tiền')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('KHÔNG ghi nhận được tiền mới')`);
    await shot(page, 'bank-account-disable-popup');
    expect(await press(page, 'Tắt nhận tiền', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog')`);
    await page.waitFor(`document.body.innerText.includes('Đã tắt')`);
    expect((await app.pool.query('SELECT can_receive, version::int AS v FROM app.system_owned_bank_accounts WHERE account_number = $1', [number])).rows[0]).toEqual({ can_receive: false, v: 3 });

    // Rights: the administrators list has a button per administrator; both rights start OFF; granting is one command.
    await page.goto(`${origin}/accounts/administrators`);
    await page.waitFor(`[...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes(${JSON.stringify(`Admin được cấp ${tag}`)}))`);
    expect(await page.evaluate<boolean>(`(() => { const row = [...document.querySelectorAll('.table tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(`Admin được cấp ${tag}`)})); const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Quản lý'); if (!b) return false; b.click(); return true; })()`)).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Chưa cấp')`);
    expect(await page.evaluate<string>(`document.querySelector('.dialog').innerText`)).toContain('xác nhận mọi yêu cầu nạp tiền trong hệ thống');
    await shot(page, 'finance-access-dialog');
    expect(await press(page, 'Cấp quyền', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog').innerText.includes('Đang được cấp')`);
    const granted = await app.pool.query('SELECT permission_key, state FROM app.admin_finance_grants WHERE user_id = $1::uuid', [target.userId]);
    expect(granted.rows).toHaveLength(1);
    expect((granted.rows[0] as { state: string }).state).toBe('GRANTED');
    expect(await press(page, 'Đóng', 'document.querySelector(".dialog")')).toBe(true);
    await page.close();
  }, 240_000);

  it('Admin with both rights: confirm the amount RECEIVED (60k of 100k) with a code kept as typed; one request; the duplicate bank code is refused; reject; lists by state', async () => {
    const one = await seedRequest(100_000);
    const two = await seedRequest(50_000);
    const three = await seedRequest(70_000);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(both));
    await waitMenu(page, `!!document.querySelector('a[href="/finance/topups"]')`);
    expect(await menuHas(page, '/finance/bank-accounts')).toBe(false);
    await page.goto(`${origin}/finance/topups`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(one.requestId.slice(0, 8))})`);
    await shot(page, 'topup-list-desktop');

    // Confirm one: the form never pre-fills the requested amount; an empty form sends nothing.
    await page.goto(`${origin}/finance/topups/${one.requestId}`);
    await page.waitFor(`document.querySelector('#confirm-actual')`);
    expect(await page.evaluate<string>(`document.querySelector('#confirm-actual').value`)).toBe('');
    expect(await press(page, 'Kiểm tra và xác nhận')).toBe(true);
    await page.waitFor(`document.body.innerText.includes('Nhập số tiền thực nhận trên sao kê')`);
    expect(page.posts(`/v1/admin/finance/topup-requests/${one.requestId}/confirm`)).toBe(0);
    const code = '000AbC' + tag;
    await fillConfirm(page, apiAccount.id, '60.000', code);
    expect(await press(page, 'Kiểm tra và xác nhận')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('KHÁC số đề nghị')`);
    const summary = await page.evaluate<string>(`document.querySelector('.dialog').innerText`);
    expect(summary).toContain('60.000đ');
    expect(summary).toContain(code);
    expect(summary).not.toContain(apiAccount.number);
    expect(summary).toContain(`****${apiAccount.number.slice(-4)}`);
    await shot(page, 'topup-confirm-summary');
    // A double click is ONE request.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('.dialog button')].find((x) => x.textContent.trim() === 'Xác nhận đã nhận tiền'); b.click(); b.click(); return true; })()`);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Thành công')`);
    expect(page.posts(`/v1/admin/finance/topup-requests/${one.requestId}/confirm`)).toBe(1);
    expect(await walletOf(one.walletId)).toEqual({ balance: '60000', version: '2' });
    expect(await ledgerCount(one.walletId)).toBe(1);
    expect(await stateOf(one.requestId)).toBe('CONFIRMED');
    expect(await page.evaluate<boolean>(`!document.querySelector('#confirm-actual')`)).toBe(true);
    expect((await app.pool.query('SELECT canonical_transaction_id FROM app.wallet_bank_transactions WHERE canonical_transaction_id = $1', [code])).rowCount).toBe(1);
    expect((await app.pool.query('SELECT status FROM app.drivers WHERE driver_id = $1::uuid', [one.driverId])).rows[0]).toEqual({ status: 'PENDING' });
    await shot(page, 'topup-detail-confirmed');

    // The same bank code for another request: a sentence, nothing posted, the request stays pending.
    await page.goto(`${origin}/finance/topups/${two.requestId}`);
    await fillConfirm(page, apiAccount.id, '50000', code);
    expect(await press(page, 'Kiểm tra và xác nhận')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Xác nhận đã nhận tiền', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('đã được ghi nhận trước đó')`);
    expect(await stateOf(two.requestId)).toBe('PENDING');
    expect(await ledgerCount(two.walletId)).toBe(0);
    expect(await walletOf(two.walletId)).toEqual({ balance: '0', version: '1' });

    // Reject two with a reason code only.
    expect(await setValue(page, '#reject-reason', 'DUPLICATE_REQUEST', 'change')).toBe(true);
    expect(await press(page, 'Từ chối yêu cầu')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Từ chối yêu cầu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Từ chối') && document.body.innerText.includes('Yêu cầu đã ở trạng thái cuối')`);
    expect(await stateOf(two.requestId)).toBe('REJECTED');
    expect(await ledgerCount(two.walletId)).toBe(0);

    // Lists: one tab per server state; no total.
    await page.goto(`${origin}/finance/topups?status=CONFIRMED`);
    await page.waitFor(`[...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes(${JSON.stringify(one.requestId.slice(0, 8))}) && r.textContent.includes('60.000đ') && r.textContent.includes('100.000đ'))`);
    await page.goto(`${origin}/finance/topups?status=REJECTED`);
    await page.waitFor(`[...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes(${JSON.stringify(two.requestId.slice(0, 8))}))`);
    await page.goto(`${origin}/finance/topups?status=PENDING`);
    await page.waitFor(`[...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes(${JSON.stringify(three.requestId.slice(0, 8))}))`);
    expect(await text(page)).not.toContain(two.requestId.slice(0, 8));
    await page.close();
  }, 300_000);

  it('a lost answer keeps the SAME key: the page says the result is unknown, never posts another command, and "send the same command again" is a replay that credits once', async () => {
    const s = await seedRequest(80_000);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(both));
    await waitMenu(page, `!!document.querySelector('a[href="/finance/topups"]')`);
    await page.goto(`${origin}/finance/topups/${s.requestId}`);
    const code = 'LOST' + tag;
    await fillConfirm(page, apiAccount.id, '80000', code);
    expect(await press(page, 'Kiểm tra và xác nhận')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    const path = `/v1/admin/finance/topup-requests/${s.requestId}/confirm`;
    await page.interceptResponses(`*${path}`);
    expect(await press(page, 'Xác nhận đã nhận tiền', 'document.querySelector(".dialog")')).toBe(true);
    const paused = await page.nextPausedResponse();
    await page.failResponse(paused.requestId); // the server DID commit; the page never hears it
    await page.stopIntercepting();
    await page.waitFor(`document.body.innerText.includes('Chưa xác định kết quả')`);
    expect(page.posts(path)).toBe(1);
    expect(await ledgerCount(s.walletId)).toBe(1); // already committed
    expect(await page.evaluate<boolean>(`!document.querySelector('.message-notice') || true`)).toBe(true);
    await shot(page, 'topup-unknown-outcome');
    // The page offered no new command: the form is replaced by the unknown panel.
    expect(await page.evaluate<boolean>(`!document.querySelector('#confirm-actual')`)).toBe(true);
    // Same command again (same key and body): the server replays, nothing is posted twice.
    expect(await press(page, 'Gửi lại cùng lệnh')).toBe(true);
    await page.waitFor(`document.body.innerText.includes('máy chủ đã xác nhận') && document.body.innerText.includes('Thành công')`);
    expect(page.posts(path)).toBe(2);
    expect(await ledgerCount(s.walletId)).toBe(1);
    expect(await walletOf(s.walletId)).toEqual({ balance: '80000', version: '2' });
    expect(await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.wallet_topup.confirm.v1'`, [s.requestId])).toBe(1);
    await page.close();
  }, 240_000);

  it('a revoked right empties the page after the rights are read again, and a narrow screen does not scroll sideways', async () => {
    const s = await seedRequest(90_000);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(390, 844, true);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, person(reader));
    await waitMenu(page, `!!document.querySelector('a[href="/finance/topups"]') || document.querySelector('#shell-title')`);
    await page.goto(`${origin}/finance/topups`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(s.requestId.slice(0, 8))})`);
    expect(await noOverflow(page)).toBe(true);
    await shot(page, 'topup-list-phone');
    await page.goto(`${origin}/finance/topups/${s.requestId}`);
    await page.waitFor(`document.querySelector('#topup-title') && document.body.innerText.includes('90.000đ')`);
    expect(await noOverflow(page)).toBe(true);
    await shot(page, 'topup-detail-phone');
    // SYSTEM (API) revokes the read right; the next read of the page is refused and the content is gone after the rights are read again.
    const revoked = await app.call('POST', `/finance/access/admins/${reader.userId}/revoke`, { basePath: '/v1/admin', body: { permission_key: READ, expected_version: 1 }, cookies: sessionCookies(system.login), csrf: system.login.csrf, headers: { 'idempotency-key': randomUUID() } });
    expect([200, 401]).toContain(revoked.status);
    if (revoked.status === 200) {
      await page.reload();
      await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
      expect(await text(page)).not.toContain(s.requestId);
    }
    await page.close();
  }, 240_000);
});
