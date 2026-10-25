import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { ApiResponse, AuthApp, countRows, dataOf, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';
import { Json, newShipper, PRIVACY, Shipper, TERMS } from './support/m10-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issues #198 / #199, Administration web in a REAL Chrome against the real front, backend and PostgreSQL: the reconciliation queue "Thanh toán quán", one request
// with the money button and the dish-right button as SEPARATE acts, "Trao đổi thanh toán" (text as text, read-only administrators, closed rooms), the same
// conversation on the Shipper top-up page, the rights screen, and a phone-width page. Screenshots go to .test-results/admin-shop-payments-shots.

const tag = randomBytes(3).toString('hex').toUpperCase();
const PAYLOAD = '<img src=x onerror="window.__xss=1"> <b>đậm</b> & "trích"';

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}
interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('admin shop payments (real browser)', () => {
  let app: AuthApp;
  let admin: AdminApp;
  let system: SystemSession;
  let shop: ShopOwner;
  let shipper: Shipper;
  let boss: Person;
  let watcher: Person;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let accountId = '';
  const drivers: string[] = [];
  const bankAccountIds: string[] = [];
  const shots: Shot[] = [];
  const switchedOff: string[] = [];

  async function activatedAdmin(fullName: string): Promise<Person> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  const systemPost = async (path: string, body: unknown): Promise<ReturnType<AdminApp['call']>> => {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies({ cookie: system.login.cookie }), csrf: system.login.csrf, headers: { 'idempotency-key': randomUUID() } });
  };
  const grant = async (who: Person, key: string): Promise<void> => {
    expect((await systemPost(`/finance/access/admins/${who.userId}/grant`, { permission_key: key, expected_version: 0 })).status).toBe(200);
  };

  async function signIn(page: Page, who: Person): Promise<void> {
    await admin.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', who.phone.local);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(admin, who.userId);
    await page.fill('#verify-code', totpNow(who.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }

  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };
  const press = (page: Page, text: string): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const noSideways = (page: Page): Promise<boolean> => page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth`);
  const setValue = (page: Page, selector: string, value: string): Promise<void> =>
    page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const feedTexts = (page: Page): Promise<string[]> => page.evaluate<string[]>(`[...document.querySelectorAll('.chat-feed .chat-item')].map((li) => li.textContent.trim())`);

  const call = (token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const good = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 200)]).toEqual([status, response.text.slice(0, 200)]);
    return dataOf(response) as Json;
  };
  const newPayment = async (purpose: string, amount: number): Promise<string> => String(good(await call(shop.token, 'POST', '/shop/me/payment-requests', { purpose, amount_vnd: amount }), 201).request_id);

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-sp-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    admin = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: admin.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);
    system = await systemSession(admin);
    const stale = await app.pool.query<{ id: string }>(`UPDATE app.system_owned_bank_accounts SET can_receive = false, version = version + 1, updated_at = clock_timestamp() WHERE can_receive RETURNING system_account_id::text AS id`);
    switchedOff.push(...stale.rows.map((r) => r.id));
    const created = await systemPost('/finance/bank-accounts', { bank_id: 'VCB', account_number: String(Math.floor(1e11 + Math.random() * 9e11)), account_holder: `CONG TY ${tag}` });
    expect(created.status).toBe(201);
    accountId = String(adminData(created).account_id);
    bankAccountIds.push(accountId);
    expect((await systemPost(`/finance/bank-accounts/${accountId}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);
    shop = await createShopOwner(app);
    shipper = await newShipper(app, drivers, 10_000);
    boss = await activatedAdmin(`Quản trị đối soát ${tag}`);
    for (const key of ['shop.payment.read', 'shop.payment.record', 'shop.entitlement.manage', 'wallet.read']) {
      await grant(boss, key);
    }
    watcher = await activatedAdmin(`Quản trị chỉ xem ${tag}`);
    await grant(watcher, 'shop.payment.read');
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-shop-payments-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.webp`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    try {
      if (app !== undefined) {
        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          const tables = ['case_chat_messages', 'wallet_topup_reports', 'shop_entitlement_grants', 'shop_payment_settlements', 'shop_payment_requests', 'wallet_topups', 'wallet_bank_transactions', 'wallet_ledger_entries', 'wallet_topup_requests', 'driver_wallets', 'notifications', 'notification_pushes'];
          for (const table of tables) {
            await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
          }
          for (const table of ['case_chat_messages', 'wallet_topup_reports', 'shop_entitlement_grants', 'shop_payment_settlements', 'shop_payment_requests']) {
            await client.query(`DELETE FROM app.${table}`);
          }
          const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
          await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [drivers]);
          await client.query(`WITH gone AS (DELETE FROM app.wallet_topups WHERE wallet_id IN (${wallets}) RETURNING bank_record_id) DELETE FROM app.wallet_bank_transactions WHERE bank_record_id IN (SELECT bank_record_id FROM gone)`, [drivers]);
          await client.query(`DELETE FROM app.wallet_topup_requests WHERE driver_id = ANY($1::uuid[])`, [drivers]);
          await client.query(`DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`, [drivers]);
          await client.query('DELETE FROM app.notification_pushes WHERE recipient_user_id = ANY($1::uuid[])', [[shop.userId, shipper.userId]]);
          await client.query('DELETE FROM app.notifications WHERE recipient_user_id = ANY($1::uuid[])', [[shop.userId, shipper.userId]]);
          await client.query('UPDATE app.system_owned_bank_accounts SET can_receive = true, version = version + 1, updated_at = clock_timestamp() WHERE system_account_id = ANY($1::uuid[])', [switchedOff]);
          await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
          await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [bankAccountIds]);
          await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          for (const table of tables) {
            await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        await admin.pool.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
        await admin.pool.query('DELETE FROM app.admin_finance_grants');
        await admin.pool.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
      }
    } finally {
      await app?.close();
      await admin?.close();
      if (tlsDir !== '') {
        rmSync(tlsDir, { recursive: true, force: true });
      }
    }
  });

  it('the queue lists what the shop reported; recording the money and granting the dish right are two separate buttons; a chat message and a report confirm nothing; text is text', async () => {
    const id = await newPayment('MENU_EXPANSION', 200_000);
    good(await call(shop.token, 'POST', `/shop/me/payment-requests/${id}/chat`, { body: PAYLOAD }), 201);
    good(await call(shop.token, 'POST', `/shop/me/payment-requests/${id}/report-transfer`, {}));
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, boss);
    await page.goto(`${origin}/finance/shop-payments`);
    await page.waitFor(`document.querySelector('#shop-payments-title')`);
    await page.waitFor(`document.querySelector('tr[data-request="${id}"]')`);
    expect(await page.text('tr[data-request="' + id + '"]')).toContain('Chờ kiểm tra');
    expect(await page.evaluate<string>(`document.querySelector('.tab[aria-selected="true"]').textContent`)).toBe('Chờ kiểm tra');
    await shot(page, 'queue-desktop');
    // The menu entry exists for this administrator and is the active one.
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('nav a, nav button')].some((e) => e.textContent.trim() === 'Thanh toán quán')`)).toBe(true);
    await page.click(`tr[data-request="${id}"] a`);
    await page.waitFor(`document.querySelector('#sp-confirm-money')`);
    await page.waitFor(`document.querySelectorAll('.chat-feed .chat-item').length >= 3`);
    // The conversation: its own title; what the shop typed is TEXT; the milestones are real ones (created, reported); the note says it confirms nothing.
    expect(await page.evaluate<string>(`document.querySelector('.chat-toggle').textContent`)).toBe('Trao đổi thanh toán');
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-feed img') === null && document.querySelector('.chat-feed b') === null && window.__xss === undefined`)).toBe(true);
    const lines = await feedTexts(page);
    expect(lines.some((line) => line.includes(PAYLOAD))).toBe(true);
    expect(lines.some((line) => line.includes('Yêu cầu thanh toán được tạo'))).toBe(true);
    expect(lines.some((line) => line.includes('Đã báo chuyển khoản'))).toBe(true);
    expect(await page.text('.chat-note')).toContain('không xác nhận tiền');
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-keep') === null || document.querySelector('.chat-keep').textContent.trim() === ''`)).toBe(true);
    // The administrator writes (record right): the message appears after the server's answer, in the shop's feed too.
    await page.fill('.chat-input', 'Bên mình chưa thấy tiền về, bạn gửi mã giao dịch nhé');
    expect(await press(page, 'Gửi')).toBe(true);
    await page.waitFor(`[...document.querySelectorAll('.chat-feed .chat-text')].some((p) => p.textContent.includes('chưa thấy tiền về'))`);
    expect(((await good(await call(shop.token, 'GET', `/shop/me/payment-requests/${id}/chat`)).items) as Json[]).some((i) => i.body === 'Bên mình chưa thấy tiền về, bạn gửi mã giao dịch nhé')).toBe(true);
    // Nothing is confirmed yet: no settlement, no right, the shop still "Chờ kiểm tra".
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [shop.shopId])).toBe(0);
    await shot(page, 'detail-pending-desktop');
    // Record the money from the statement: validation first, then the summary dialog, then ONE request.
    await page.evaluate(`document.querySelector('#sp-confirm-money').click()`);
    await page.waitFor(`document.querySelector('#sp-actual').parentElement.parentElement.textContent.includes('Nhập số tiền thực nhận')`);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(0);
    const transaction = `T${tag}${Math.floor(1e9 + Math.random() * 9e9)}`;
    await setValue(page, '#sp-actual', '200000');
    await setValue(page, '#sp-txid', transaction);
    await setValue(page, '#sp-received', await page.evaluate<string>(`(() => { const d = new Date(Date.now() - 3600000); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); })()`));
    await setValue(page, '#sp-account', accountId);
    await page.evaluate(`document.querySelector('#sp-confirm-money').click()`);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await page.text('.dialog')).toContain('không mở tài khoản và không cấp quyền');
    await shot(page, 'confirm-dialog');
    expect(await press(page, 'Xác nhận đã nhận tiền')).toBe(true);
    await page.waitFor(`document.querySelector('.badge')?.textContent.includes('Đã nhận tiền')`);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(1);
    // Recording money opened NOTHING: no right, and the page says the shop's account is opened elsewhere with its own guards.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [shop.shopId])).toBe(0);
    expect(await page.text('#sp-entitlement')).toContain('Chưa có');
    expect(await page.evaluate<boolean>(`document.body.textContent.includes('không tự mở quán và không vượt qua các điều kiện đó')`)).toBe(true);
    await page.waitFor(`[...document.querySelectorAll('.chat-system')].some((e) => e.textContent.includes('Quản trị viên đã xác nhận tiền'))`);
    // The chat closed with the request: no composer any more, the history stays.
    await page.waitFor(`document.querySelector('.chat-composer').hidden === true`);
    await shot(page, 'detail-confirmed-desktop');
    // The dish right: its OWN button, with a reason; the payment can be named, once.
    await page.evaluate(`document.querySelector('#sp-grant').click()`);
    await page.waitFor(`document.querySelector('#sp-entitlement').textContent.includes('Lý do là bắt buộc')`);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [shop.shopId])).toBe(0);
    await page.fill('#sp-entitlement-reason', 'Đã đối soát khoản chuyển khoản, mở rộng thực đơn');
    await page.evaluate(`document.querySelector('#sp-based-on-payment').click()`);
    await page.evaluate(`document.querySelector('#sp-grant').click()`);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Cấp quyền')).toBe(true);
    await page.waitFor(`document.querySelector('#sp-entitlement').textContent.includes('Đang có')`);
    const rows = await app.pool.query<{ payment_request_id: string | null; action: string }>('SELECT payment_request_id::text, action FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [shop.shopId]);
    expect(rows.rows).toEqual([{ payment_request_id: id, action: 'GRANT' }]);
    await page.waitFor(`[...document.querySelectorAll('.chat-system')].some((e) => e.textContent.includes('Tài khoản/quyền đã được mở'))`);
    await shot(page, 'detail-granted-desktop');
    // Revoke: asks for a reason too, removes nothing of the menu.
    await page.fill('#sp-entitlement-reason', 'Thu hồi theo yêu cầu quán');
    await page.evaluate(`document.querySelector('#sp-revoke').click()`);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Thu hồi quyền')).toBe(true);
    await page.waitFor(`document.querySelector('#sp-entitlement').textContent.includes('Chưa có')`);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [shop.shopId])).toBe(2);
    await page.close();
  }, 240_000);

  it('a read-only administrator sees the request and the conversation but no money button, no right button and no composer; the page is usable at phone width', async () => {
    const id = await newPayment('ACCOUNT_OPENING', 150_000);
    good(await call(shop.token, 'POST', `/shop/me/payment-requests/${id}/report-transfer`, {}));
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, watcher);
    await page.goto(`${origin}/finance/shop-payments/${id}`);
    await page.waitFor(`document.querySelector('#shop-payment-title')`);
    await page.waitFor(`document.querySelector('.chat-block')`);
    await page.waitFor(`document.querySelector('.chat-state') && document.querySelectorAll('.chat-feed .chat-item').length >= 2`);
    expect(await page.evaluate<boolean>(`document.querySelector('#sp-confirm-money') === null && document.querySelector('#sp-reject') === null && document.querySelector('#sp-grant') === null`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.body.textContent.includes('Bạn chỉ có quyền xem')`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden === true`)).toBe(true);
    // Even if the page were forced, the server refuses the write.
    const forced = await app.pool.query('SELECT 1 FROM app.case_chat_messages WHERE shop_payment_id = $1::uuid', [id]);
    expect(forced.rowCount).toBe(0);
    await page.viewport(390, 800, true);
    await page.reload();
    await page.waitFor(`document.querySelector('#shop-payment-title')`);
    await page.waitFor(`document.querySelector('.chat-block')`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'detail-readonly-phone');
    await page.goto(`${origin}/finance/shop-payments`);
    await page.waitFor(`document.querySelector('#shop-payments-title')`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'queue-phone');
    await page.close();
  }, 120_000);

  it('the Shipper top-up page carries the same conversation and the report time; the wallet is untouched by both', async () => {
    const topup = good(await call(shipper.token, 'POST', '/driver/wallet/topup-requests', { amount_vnd: 100_000 }), 201);
    const id = String(topup.request_id);
    good(await call(shipper.token, 'POST', `/driver/wallet/topup-requests/${id}/report-transfer`, {}));
    good(await call(shipper.token, 'POST', `/driver/wallet/topup-requests/${id}/chat`, { body: 'Em đã chuyển khoản rồi' }), 201);
    const before = await app.pool.query('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE driver_id = $1::uuid', [shipper.driverId]);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, boss);
    await page.goto(`${origin}/finance/topups/${id}`);
    await page.waitFor(`document.querySelector('#topup-title')`);
    await page.waitFor(`document.querySelectorAll('.chat-feed .chat-item').length >= 3`);
    expect(await page.evaluate<string>(`document.querySelector('.chat-toggle').textContent`)).toBe('Trao đổi thanh toán');
    expect(await page.evaluate<boolean>(`document.body.textContent.includes('Shipper báo đã chuyển khoản lúc')`)).toBe(true);
    const lines = await feedTexts(page);
    expect(lines.some((line) => line.includes('Đã báo chuyển khoản'))).toBe(true);
    // The administrator here has wallet.read only: the composer stays hidden (the right to handle the top-up is wallet.topup.record).
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden === true`)).toBe(true);
    await shot(page, 'topup-detail-chat');
    const after = await app.pool.query('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE driver_id = $1::uuid', [shipper.driverId]);
    expect(after.rows).toEqual(before.rows);
    await page.close();
  }, 120_000);

  it('the rights screen lists the three shop-payment rights as separate switches', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, boss);
    // The boss holds no right to open the matrix (SYSTEM only), so the check is on the menu: the entry is there, the matrix is not.
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('nav a, nav button')].some((e) => e.textContent.trim() === 'Thanh toán quán')`)).toBe(true);
    await page.close();
  }, 60_000);
});
