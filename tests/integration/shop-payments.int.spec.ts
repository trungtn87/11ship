import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok as activationOk, post } from './support/activation-fixtures';
import { ApiResponse, AuthApp, countRows, createActiveShopFor, createServiceArea, dataOf, grantStrayRole, obtainProof, PASSWORD, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { codeOf as clientCode, Json, newShipper, PRIVACY, Shipper, TERMS, WEB_FOOD, walletOf } from './support/m10-fixtures';
import { createCategory, createItem, getMenu, itemAction, jpegBase64, uploadImage } from './support/menu-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issues #198 (shop payment requests, manual entitlement, dish limit) and #199 (payment conversation) on a REAL Nest pipeline and PostgreSQL:
//  - a report ("Tôi đã chuyển khoản") and a chat message never confirm money, open an account or grant a right; only the administrator's own buttons do;
//  - recording the money received (one proof per request, one proof per bank transaction, also against Shipper top-ups) and granting the dish right are separate
//    commands under separate rights, with a reason, idempotency and audit;
//  - without the right a shop shows at most 20 dishes at once (HIDDEN ones do not count; nothing is removed when the right is revoked), also against a race;
//  - one room per request, strangers get NOT_FOUND, a read-only administrator cannot write, a closed request is read-only and send-vs-close has one winner;
//  - the Shipper top-up keeps its M04 behaviour: the report and the chat leave the wallet and the ledger untouched.

const tag = randomBytes(3).toString('hex').toUpperCase();
const SHOP_READ = 'shop.payment.read';
const SHOP_RECORD = 'shop.payment.record';
const SHOP_MANAGE = 'shop.entitlement.manage';
const WALLET_READ = 'wallet.read';
const WALLET_RECORD = 'wallet.topup.record';

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}
interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('#198 / #199 — shop payments and the payment conversation', () => {
  let app: AuthApp;
  let admin: AdminApp;
  let system: SystemSession;
  let shop: ShopOwner;
  let otherShop: ShopOwner;
  let quotaShop: ShopOwner;
  let bare: Login;
  let reader: Login;
  let recorder: Login;
  let manager: Login;
  let walletReader: Login;
  let walletRecorder: Login;
  let managerUser = '';
  let accountId = '';
  const drivers: string[] = [];
  const shippers: Shipper[] = [];
  const bankAccountIds: string[] = [];
  /** Receiving accounts of earlier runs / suites, switched off for the duration so that "no account yet" is a fact, then switched back on. */
  const switchedOff: string[] = [];
  const clientShopUsers: string[] = [];
  type Owner = { readonly token: string; readonly userId: string };

  const permission = (name: string, view: boolean): Record<string, unknown> => ({ app: name, can_view: view, can_review_profile: false, can_lock: false });

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    const stale = await app.pool.query<{ id: string }>(`UPDATE app.system_owned_bank_accounts SET can_receive = false, version = version + 1, updated_at = clock_timestamp() WHERE can_receive RETURNING system_account_id::text AS id`);
    switchedOff.push(...stale.rows.map((r) => r.id));
    shop = await createShopOwner(app);
    otherShop = await createShopOwner(app);
    quotaShop = await createShopOwner(app);
    const make = async (name: string, rights: string[]): Promise<{ login: Login; userId: string }> => {
      const who = await activatedAdmin([permission('DRIVER', true)], `${name} ${tag}`);
      for (const right of rights) {
        expect((await grant(who.userId, right)).status).toBe(200);
      }
      return { login: await login(who), userId: who.userId };
    };
    bare = (await make('Admin trống', [])).login;
    reader = (await make('Admin đọc quán', [SHOP_READ])).login;
    recorder = (await make('Admin ghi quán', [SHOP_READ, SHOP_RECORD])).login;
    const managed = await make('Admin quyền món', [SHOP_READ, SHOP_MANAGE]);
    manager = managed.login;
    managerUser = managed.userId;
    walletReader = (await make('Admin đọc ví', [WALLET_READ])).login;
    walletRecorder = (await make('Admin ghi ví', [WALLET_READ, WALLET_RECORD])).login;
  });

  afterAll(async () => {
    for (let pass = 0; pass < 200 && (await app.running.app.get(NotificationRuntime).dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    try {
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const tables = ['case_chat_messages', 'wallet_topup_reports', 'shop_entitlement_grants', 'shop_payment_settlements', 'shop_payment_requests', 'wallet_topups', 'wallet_bank_transactions', 'wallet_ledger_entries', 'wallet_topup_requests', 'driver_wallets', 'notifications', 'notification_pushes'];
        for (const table of tables) {
          await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
        }
        await client.query('DELETE FROM app.case_chat_messages');
        await client.query('DELETE FROM app.wallet_topup_reports');
        await client.query('DELETE FROM app.shop_entitlement_grants');
        await client.query('DELETE FROM app.shop_payment_settlements');
        await client.query('DELETE FROM app.shop_payment_requests');
        const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
        await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [drivers]);
        // The topup and its bank record point at each other: one statement removes both.
        await client.query(
          `WITH gone AS (DELETE FROM app.wallet_topups WHERE wallet_id IN (${wallets}) RETURNING bank_record_id)
           DELETE FROM app.wallet_bank_transactions WHERE bank_record_id IN (SELECT bank_record_id FROM gone)`,
          [drivers],
        );
        await client.query(`DELETE FROM app.wallet_topup_requests WHERE driver_id = ANY($1::uuid[])`, [drivers]);
        await client.query(`DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`, [drivers]);
        await client.query('DELETE FROM app.notification_pushes WHERE recipient_user_id = ANY($1::uuid[])', [[shop.userId, otherShop.userId, quotaShop.userId, ...clientShopUsers, ...shippers.map((s) => s.userId)]]);
        await client.query('DELETE FROM app.notifications WHERE recipient_user_id = ANY($1::uuid[])', [[shop.userId, otherShop.userId, quotaShop.userId, ...clientShopUsers, ...shippers.map((s) => s.userId)]]);
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
    } finally {
      await app.close();
      await admin.close();
    }
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    activationOk(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(activationOk(await post(admin, '/totp/enrollment', session))).secret);
    activationOk(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: ActivatedAdmin): Promise<Login> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const aGet = (who: Login | undefined, path: string): Promise<AdminResponse> => admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  async function aPost(who: Login, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const aCode = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  const aJson = (r: AdminResponse): Json => {
    expect([r.status, r.text.slice(0, 300)]).toEqual([200, r.text.slice(0, 300)]);
    return adminData(r) as Json;
  };
  const grant = (target: string, key: string): Promise<AdminResponse> => aPost(systemLogin(), `/finance/access/admins/${target}/grant`, { permission_key: key, expected_version: 0 });

  type Verb = 'GET' | 'POST';
  const call = (token: string, method: Verb, path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: clientCode(response) });
  const drain = async (): Promise<void> => {
    const runtime = app.running.app.get(NotificationRuntime);
    for (let pass = 0; pass < 200 && (await runtime.dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
  };

  async function ensureAccount(): Promise<void> {
    if (accountId !== '') {
      return;
    }
    const created = await aPost(systemLogin(), '/finance/bank-accounts', { bank_id: 'VCB', account_number: String(Math.floor(1e11 + Math.random() * 9e11)), account_holder: `CONG TY ${tag}` });
    expect(created.status).toBe(201);
    accountId = String(adminData(created).account_id);
    bankAccountIds.push(accountId);
    expect((await aPost(systemLogin(), `/finance/bank-accounts/${accountId}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);
  }

  const txid = (): string => `T${tag}${Math.floor(1e9 + Math.random() * 9e9)}`;
  const confirmBody = (version: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    expected_version: version,
    actual_amount_vnd: 200_000,
    bank_id: 'VCB',
    system_owned_account_id: accountId,
    canonical_transaction_id: txid(),
    received_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });

  async function newRequest(owner: Owner, purpose = 'MENU_EXPANSION', amount = 200_000): Promise<Json> {
    await ensureAccount();
    return ok(await call(owner.token, 'POST', '/shop/me/payment-requests', { purpose, amount_vnd: amount }), 201);
  }
  const reportOf = (owner: Owner, id: string, key?: string): Promise<ApiResponse> => call(owner.token, 'POST', `/shop/me/payment-requests/${id}/report-transfer`, {}, key);
  const shopChat = (owner: Owner, id: string, method: Verb, body?: unknown, key?: string, query = ''): Promise<ApiResponse> => call(owner.token, method, `/shop/me/payment-requests/${id}/chat${query}`, body, key);
  const adminShopChat = (who: Login, id: string, method: Verb, body?: unknown, key?: string): Promise<AdminResponse> =>
    method === 'GET' ? aGet(who, `/shop-payments/${id}/chat`) : aPost(who, `/shop-payments/${id}/chat`, body, key);
  const messagesIn = (feed: Json): string[] => (feed.items as Json[]).filter((i) => i.type === 'message').map((i) => String(i.body));
  const systemIn = (feed: Json): string[] => (feed.items as Json[]).filter((i) => i.type === 'system').map((i) => String(i.text));
  const rows = (sql: string, values: unknown[] = []): Promise<Json[]> => app.pool.query(sql, values).then((r) => r.rows as Json[]);
  const shopState = async (id: string): Promise<Json> => (await rows('SELECT state, version::text AS version, reported_at IS NOT NULL AS reported FROM app.shop_payment_requests WHERE request_id = $1::uuid', [id]))[0] as Json;

  /** A shop owner whose session is a CLIENT session of the Food app (the notification routes only serve client sessions). */
  async function newClientShop(): Promise<Owner & { shopId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: `Quán ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    await grantStrayRole(app.pool, userId, 'SHOP');
    const shopId = await createActiveShopFor(app.pool, userId, await createServiceArea(app.pool));
    const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD } } });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    expect((await app.call('POST', '/auth/role/select', { bearer: token, body: { role: 'SHOP' } })).status).toBe(200);
    clientShopUsers.push(userId);
    return { userId, token, shopId };
  }

  // ---- #198: requests ---------------------------------------------------------------------------------------------------------------

  it('a request needs a real receiving account; the shop creates, lists and reads only its own; the same purpose cannot be opened twice; a retry returns the same request', async () => {
    const before = await call(shop.token, 'POST', '/shop/me/payment-requests', { purpose: 'MENU_EXPANSION', amount_vnd: 200_000 });
    expect(refused(before)).toEqual({ status: 409, code: 'SHOP_PAYMENT_RECEIVING_ACCOUNT_NOT_CONFIGURED' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_requests WHERE shop_id = $1::uuid', [shop.shopId])).toBe(0);
    await ensureAccount();
    const accounts = ok(await call(shop.token, 'GET', '/shop/me/payment-receiving-accounts'));
    expect((accounts.accounts as Json[]).some((a) => a.bank_id === 'VCB')).toBe(true);
    const key = randomUUID();
    const first = ok(await call(shop.token, 'POST', '/shop/me/payment-requests', { purpose: 'MENU_EXPANSION', amount_vnd: 200_000 }, key), 201);
    expect(first).toMatchObject({ purpose: 'MENU_EXPANSION', amount_requested_vnd: 200_000, state: 'PENDING', can_report: true, can_cancel: true, awaiting_check: false, reported_at: null });
    const again = ok(await call(shop.token, 'POST', '/shop/me/payment-requests', { purpose: 'MENU_EXPANSION', amount_vnd: 200_000 }, key), 201);
    expect(again.request_id).toBe(first.request_id);
    expect(refused(await call(shop.token, 'POST', '/shop/me/payment-requests', { purpose: 'MENU_EXPANSION', amount_vnd: 200_000 }))).toEqual({ status: 409, code: 'SHOP_PAYMENT_OPEN_EXISTS' });
    // The body is exactly {purpose, amount_vnd}: no shop, state, price default or extra field.
    for (const bad of [{ purpose: 'MENU_EXPANSION' }, { purpose: 'SUBSCRIPTION', amount_vnd: 29_000 }, { purpose: 'OTHER', amount_vnd: 0 }, { purpose: 'OTHER', amount_vnd: 1.5 }, { purpose: 'OTHER', amount_vnd: 1_000_000_000 }, { purpose: 'OTHER', amount_vnd: 1000, shop_id: otherShop.shopId }, { purpose: 'OTHER', amount_vnd: 1000, state: 'CONFIRMED' }]) {
      expect((await call(shop.token, 'POST', '/shop/me/payment-requests', bad)).status).toBe(400);
    }
    const id = String(first.request_id);
    expect(ok(await call(shop.token, 'GET', `/shop/me/payment-requests/${id}`))).toMatchObject({ request_id: id, state: 'PENDING', received_amount_vnd: null, entitlement: null, menu_expanded: false });
    expect(((ok(await call(shop.token, 'GET', '/shop/me/payment-requests')).items) as Json[]).map((r) => r.request_id)).toContain(id);
    // Another shop: the request does not exist for it; and it never sees the first shop's list.
    expect(refused(await call(otherShop.token, 'GET', `/shop/me/payment-requests/${id}`))).toEqual({ status: 404, code: 'SHOP_PAYMENT_NOT_FOUND' });
    expect(refused(await call(otherShop.token, 'POST', `/shop/me/payment-requests/${id}/report-transfer`, {}))).toEqual({ status: 404, code: 'SHOP_PAYMENT_NOT_FOUND' });
    expect(((ok(await call(otherShop.token, 'GET', '/shop/me/payment-requests')).items) as Json[]).map((r) => r.request_id)).not.toContain(id);
    expect(refused(await call(shop.token, 'GET', '/shop/me/payment-requests/not-a-uuid'))).toEqual({ status: 404, code: 'SHOP_PAYMENT_NOT_FOUND' });
  });

  it('"Tôi đã chuyển khoản" writes ONE mark and confirms nothing: no settlement, no ACTIVE change, no right, no ledger; a second report (any key) writes nothing new; cancel is only before the report', async () => {
    const request = await newRequest(otherShop, 'ACCOUNT_OPENING', 150_000);
    const id = String(request.request_id);
    const shopBefore = (await rows('SELECT status, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [otherShop.shopId]))[0];
    const key = randomUUID();
    const reported = ok(await reportOf(otherShop, id, key));
    expect(reported).toMatchObject({ state: 'PENDING', awaiting_check: true, can_report: false, can_cancel: false });
    expect(reported.reported_at).not.toBeNull();
    // Retry (lost response), another key, another phone: the same answer, one mark, one audit row.
    expect(ok(await reportOf(otherShop, id, key)).reported_at).toBe(reported.reported_at);
    expect(ok(await reportOf(otherShop, id)).reported_at).toBe(reported.reported_at);
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'shop.payment_request.report.v1'`, [id])).toBe(1);
    expect(await shopState(id)).toMatchObject({ state: 'PENDING', reported: true });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [otherShop.shopId])).toBe(0);
    expect((await rows('SELECT status, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [otherShop.shopId]))[0]).toEqual(shopBefore);
    // After the report the shop cannot withdraw (money may be on its way); before it, it can.
    expect(refused(await call(otherShop.token, 'POST', `/shop/me/payment-requests/${id}/cancel`, { expected_version: 2 }))).toEqual({ status: 409, code: 'SHOP_PAYMENT_STATE_CONFLICT' });
    const fresh = await newRequest(quotaShop, 'OTHER', 5_000);
    expect(refused(await call(quotaShop.token, 'POST', `/shop/me/payment-requests/${String(fresh.request_id)}/cancel`, { expected_version: 9 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(ok(await call(quotaShop.token, 'POST', `/shop/me/payment-requests/${String(fresh.request_id)}/cancel`, { expected_version: 1 }))).toMatchObject({ state: 'CANCELLED' });
    expect(refused(await reportOf(quotaShop, String(fresh.request_id)))).toEqual({ status: 409, code: 'SHOP_PAYMENT_STATE_CONFLICT' });
  });

  // ---- #198: the administration ------------------------------------------------------------------------------------------------------

  it('rights: no right, read only, record and manage are each their own switch; the queue shows the reported ones; every command is asked again on the server', async () => {
    const request = await newRequest(shop, 'ACCOUNT_OPENING', 200_000);
    const id = String(request.request_id);
    ok(await reportOf(shop, id));
    expect((await aGet(undefined, '/shop-payments')).status).toBe(401);
    for (const r of [await aGet(bare, '/shop-payments'), await aGet(bare, `/shop-payments/${id}`), await aPost(bare, `/shop-payments/${id}/confirm`, confirmBody(2)), await aPost(bare, `/shop-payments/${id}/reject`, { expected_version: 2, reason_code: 'OTHER' })]) {
      expect(aCode(r)).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    const queue = aJson(await aGet(reader, '/shop-payments?reported=true&status=PENDING&limit=50'));
    const item = (queue.items as Json[]).find((r) => r.request_id === id) as Json;
    expect(item).toMatchObject({ state: 'PENDING', awaiting_check: true, shop: { shop_id: shop.shopId } });
    expect((aJson(await aGet(reader, '/shop-payments?reported=false&limit=50')).items as Json[]).map((r) => r.request_id)).not.toContain(id);
    // Read only: sees the detail, cannot record, reject or grant.
    expect(aJson(await aGet(reader, `/shop-payments/${id}`))).toMatchObject({ may_record: false, may_manage: false, settlement: null });
    expect(aCode(await aPost(reader, `/shop-payments/${id}/confirm`, confirmBody(2)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(aCode(await aPost(reader, `/shop-payments/shops/${shop.shopId}/menu-expanded/grant`, { reason: 'thử thôi', payment_request_id: null }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // Record only on the money; manage only on the right: recording money does not open the right, and managing does not record money.
    expect(aCode(await aPost(manager, `/shop-payments/${id}/confirm`, confirmBody(2)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(aCode(await aPost(recorder, `/shop-payments/shops/${shop.shopId}/menu-expanded/grant`, { reason: 'thử thôi', payment_request_id: null }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // A top-up right is not a shop-payment right.
    expect(aCode(await aGet(walletReader, '/shop-payments'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(await shopState(id)).toMatchObject({ state: 'PENDING', version: '2' });
    expect(aCode(await aGet(manager, `/shop-payments/shops/${shop.shopId}/entitlements`)).status).toBe(200);
    expect(aCode(await aGet(bare, `/shop-payments/shops/${shop.shopId}/entitlements`))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
  });

  it('confirming records the money RECEIVED once (the proof is immutable) and opens nothing: no grant, no ACTIVE change; replay writes nothing; the proof of one transfer is never used twice (also against a Shipper top-up)', async () => {
    // The earlier test left otherShop's reported ACCOUNT_OPENING request open: it is the one confirmed here.
    const open = (await rows(`SELECT request_id::text AS id, version::text AS version FROM app.shop_payment_requests WHERE shop_id = $1::uuid AND state = 'PENDING' ORDER BY created_at`, [otherShop.shopId]))[0] as Json;
    const id = String(open.id);
    const shopBefore = (await rows('SELECT status, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [otherShop.shopId]))[0];
    const key = randomUUID();
    const body = confirmBody(Number(open.version), { actual_amount_vnd: 120_000, canonical_transaction_id: `  ${txid()}  ` });
    const done = aJson(await aPost(recorder, `/shop-payments/${id}/confirm`, body, key));
    expect(done).toMatchObject({ state: 'CONFIRMED', amount_requested_vnd: 150_000, settlement: { amount_vnd: 120_000, bank_id: 'VCB' }, menu_expanded: false });
    expect(await rows('SELECT amount_vnd::text AS a, confirmed_by_user_id::text AS by FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toHaveLength(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [otherShop.shopId])).toBe(0);
    expect((await rows('SELECT status, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [otherShop.shopId]))[0]).toEqual(shopBefore);
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.shop_payment.confirm.v1'`, [id])).toBe(1);
    // The shop sees what was received, never the bank reference.
    const asShop = ok(await call(otherShop.token, 'GET', `/shop/me/payment-requests/${id}`));
    expect(asShop).toMatchObject({ state: 'CONFIRMED', received_amount_vnd: 120_000, entitlement: null });
    expect(JSON.stringify(asShop)).not.toContain(String(body.canonical_transaction_id).trim());
    // Replay of the same key: same answer, nothing more; the same key with another body is refused; a new key on a resolved request is a conflict.
    expect(aJson(await aPost(recorder, `/shop-payments/${id}/confirm`, body, key)).state).toBe('CONFIRMED');
    expect(adminErrorCode(await aPost(recorder, `/shop-payments/${id}/confirm`, confirmBody(2), key))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(aCode(await aPost(recorder, `/shop-payments/${id}/confirm`, confirmBody(2)))).toEqual({ status: 409, code: 'SHOP_PAYMENT_STATE_CONFLICT' });
    expect(aCode(await aPost(recorder, `/shop-payments/${id}/reject`, { expected_version: 2, reason_code: 'OTHER' }))).toEqual({ status: 409, code: 'SHOP_PAYMENT_STATE_CONFLICT' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(1);
    // The proof cannot be edited or removed, not even by SQL.
    await expect(app.pool.query('UPDATE app.shop_payment_settlements SET amount_vnd = 1 WHERE request_id = $1::uuid', [id])).rejects.toThrow();
    await expect(app.pool.query('DELETE FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).rejects.toThrow();
    // The same bank transaction cannot settle another request.
    const second = await newRequest(otherShop, 'OTHER', 120_000);
    const reuse = confirmBody(1, { actual_amount_vnd: 120_000, canonical_transaction_id: String(body.canonical_transaction_id).trim() });
    expect(aCode(await aPost(recorder, `/shop-payments/${String(second.request_id)}/confirm`, reuse))).toEqual({ status: 409, code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    expect(await shopState(String(second.request_id))).toMatchObject({ state: 'PENDING' });
    // Reject: a reason from the list, no proof; the request closes.
    expect(aCode(await aPost(recorder, `/shop-payments/${String(second.request_id)}/reject`, { expected_version: 1, reason_code: 'FREE_TEXT' })).status).toBe(400);
    expect(aJson(await aPost(recorder, `/shop-payments/${String(second.request_id)}/reject`, { expected_version: 1, reason_code: 'NOT_RECEIVED' }))).toMatchObject({ state: 'REJECTED', reject_reason_code: 'NOT_RECEIVED', settlement: null });
    // A Shipper top-up that already used a bank transaction blocks the shop payment that names it (and the other way round).
    const shipper = await newShipper(app, drivers, 10_000);
    shippers.push(shipper);
    const topup = ok(await call(shipper.token, 'POST', '/driver/wallet/topup-requests', { amount_vnd: 100_000 }), 201);
    const shared = txid();
    expect(aJson(await aPost(walletRecorder, `/finance/topup-requests/${String(topup.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 100_000, canonical_transaction_id: shared }))).state).toBe('CONFIRMED');
    const third = await newRequest(otherShop, 'OTHER', 100_000);
    expect(aCode(await aPost(recorder, `/shop-payments/${String(third.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 100_000, canonical_transaction_id: shared })))).toEqual({ status: 409, code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    const fresh = txid();
    expect(aJson(await aPost(recorder, `/shop-payments/${String(third.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 100_000, canonical_transaction_id: fresh }))).state).toBe('CONFIRMED');
    const fourth = ok(await call(shipper.token, 'POST', '/driver/wallet/topup-requests', { amount_vnd: 100_000 }), 201);
    expect(aCode(await aPost(walletRecorder, `/finance/topup-requests/${String(fourth.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 100_000, canonical_transaction_id: fresh })))).toEqual({ status: 409, code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    expect(ok(await call(shipper.token, 'GET', `/driver/wallet/topup-requests/${String(fourth.request_id)}`)).state).toBe('PENDING');
    // The database says the same when it is asked directly (the guard does not depend on the application).
    await expect(
      app.pool.query(
        `INSERT INTO app.shop_payment_settlements (settlement_id, request_id, shop_id, bank_id, system_owned_account_id, canonical_transaction_id, amount_vnd, received_at, confirmed_by_user_id, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'VCB', $4::uuid, $5, 1, now(), $6::uuid, now())`,
        [randomUUID(), String(second.request_id), otherShop.shopId, accountId, shared, managerUser],
      ),
    ).rejects.toThrow();
  });

  it('two administrators confirming the same request at once leave exactly one proof; two requests naming the same transfer at once leave exactly one', async () => {
    const a = await newRequest(quotaShop, 'ACCOUNT_OPENING', 70_000);
    const b = await newRequest(quotaShop, 'MENU_EXPANSION', 70_000);
    const sameRequest = await Promise.all([
      aPost(recorder, `/shop-payments/${String(a.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 70_000 })),
      aPost(systemLogin(), `/shop-payments/${String(a.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 70_000 })),
    ]);
    expect(sameRequest.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [String(a.request_id)])).toBe(1);
    const shared = txid();
    const sameTransfer = await Promise.all([
      aPost(recorder, `/shop-payments/${String(b.request_id)}/confirm`, confirmBody(1, { actual_amount_vnd: 70_000, canonical_transaction_id: shared })),
      aPost(systemLogin(), `/finance/topup-requests/${randomUUID()}/confirm`, confirmBody(1, { actual_amount_vnd: 70_000, canonical_transaction_id: shared })),
    ]);
    expect(sameTransfer[0].status).toBe(200);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE canonical_transaction_id = $1', [shared])).toBe(1);
  });

  it('the dish right is granted and revoked by its own command: reason, right, state and one-payment-one-grant are enforced; it never follows from money alone; audit and history are kept', async () => {
    const paid = (await rows(`SELECT request_id::text AS id FROM app.shop_payment_requests WHERE shop_id = $1::uuid AND state = 'CONFIRMED' ORDER BY created_at LIMIT 1`, [otherShop.shopId]))[0] as Json;
    const pending = await newRequest(otherShop, 'MENU_EXPANSION', 90_000);
    const path = `/shop-payments/shops/${otherShop.shopId}/menu-expanded`;
    // The reason is mandatory (3..300 characters), the body exact.
    for (const bad of [{ payment_request_id: null }, { reason: 'ab', payment_request_id: null }, { reason: 'đủ dài', payment_request_id: 'x' }, { reason: 'đủ dài', payment_request_id: null, extra: 1 }]) {
      expect(aCode(await aPost(manager, `${path}/grant`, bad)).status).toBe(400);
    }
    // A payment that is not confirmed, or belongs to another shop, is not a basis for a grant.
    expect(aCode(await aPost(manager, `${path}/grant`, { reason: 'chưa có tiền', payment_request_id: String(pending.request_id) }))).toEqual({ status: 409, code: 'SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED' });
    expect(aCode(await aPost(manager, `/shop-payments/shops/${shop.shopId}/menu-expanded/grant`, { reason: 'sai quán', payment_request_id: String((paid).id) }))).toEqual({ status: 409, code: 'SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED' });
    expect(aCode(await aPost(manager, `${path}/revoke`, { reason: 'chưa từng cấp' }))).toEqual({ status: 409, code: 'SHOP_ENTITLEMENT_STATE_CONFLICT' });
    const key = randomUUID();
    const granted = aJson(await aPost(manager, `${path}/grant`, { reason: 'Quán đã chuyển khoản, đối soát xong', payment_request_id: String(paid.id) }, key));
    expect(granted).toMatchObject({ menu_expanded: true, visible_limit: null, over_limit: false });
    expect(aJson(await aPost(manager, `${path}/grant`, { reason: 'Quán đã chuyển khoản, đối soát xong', payment_request_id: String(paid.id) }, key)).menu_expanded).toBe(true);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [otherShop.shopId])).toBe(1);
    // A second grant, or another grant for the same payment, is a conflict.
    expect(aCode(await aPost(manager, `${path}/grant`, { reason: 'lần hai', payment_request_id: null }))).toEqual({ status: 409, code: 'SHOP_ENTITLEMENT_STATE_CONFLICT' });
    // The shop sees the right on its confirmed request; the chat milestone "Tài khoản/quyền đã được mở" exists because the grant really happened.
    expect(ok(await call(otherShop.token, 'GET', `/shop/me/payment-requests/${String(paid.id)}`))).toMatchObject({ menu_expanded: true, entitlement: { kind: 'MENU_EXPANDED' } });
    expect(systemIn(ok(await shopChat(otherShop, String(paid.id), 'GET')))).toContain('Tài khoản/quyền đã được mở');
    const revoked = aJson(await aPost(manager, `${path}/revoke`, { reason: 'Thu hồi theo yêu cầu quán' }));
    expect(revoked).toMatchObject({ menu_expanded: false, visible_limit: 20 });
    expect((revoked.entitlement_history as Json[]).map((h) => h.action)).toEqual(['REVOKE', 'GRANT']);
    expect(aCode(await aPost(manager, `${path}/grant`, { reason: 'dùng lại khoản cũ', payment_request_id: String(paid.id) }))).toEqual({ status: 409, code: 'SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED' });
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action IN ('admin.shop_entitlement.grant.v1','admin.shop_entitlement.revoke.v1')`, [otherShop.shopId])).toBe(2);
    // History rows are immutable.
    await expect(app.pool.query('UPDATE app.shop_entitlement_grants SET reason = $2 WHERE shop_id = $1::uuid', [otherShop.shopId, 'sửa lại'])).rejects.toThrow();
    await expect(app.pool.query('DELETE FROM app.shop_entitlement_grants WHERE shop_id = $1::uuid', [otherShop.shopId])).rejects.toThrow();
    // A right granted without a payment is possible by policy, with a reason, and does not pretend money was paid.
    expect(aJson(await aPost(manager, `${path}/grant`, { reason: 'Quán thân thiết, miễn phí theo quyết định', payment_request_id: null })).menu_expanded).toBe(true);
    expect(aJson(await aPost(manager, `${path}/revoke`, { reason: 'Hết ưu đãi' })).menu_expanded).toBe(false);
  });

  // ---- #198: the 20 visible dishes ---------------------------------------------------------------------------------------------------

  it('without the right a shop shows at most 20 dishes at once: HIDDEN ones do not count, hide/show can be repeated, the limit holds against a race; granting lifts it; revoking removes nothing', async () => {
    const category = await createCategory(app.pool, `Nhóm quota ${tag}`);
    const upload = await uploadImage(app, shop.token, { content_type: 'image/jpeg', data_base64: jpegBase64() });
    const imageId = String((upload.body.data as Json).image_id);
    const make = async (name: string): Promise<Json> => {
      const created = await createItem(app, shop.token, { name, price_vnd: 30_000, category_id: category, image_id: imageId });
      expect([created.status, created.text.slice(0, 200)]).toEqual([201, created.text.slice(0, 200)]);
      return (dataOf(created) as Json).item as Json;
    };
    const items: Json[] = [];
    for (let i = 1; i <= 20; i += 1) {
      items.push(await make(`Món ${String(i)}`));
    }
    const visible = async (): Promise<number> => countRows(app.pool, `SELECT 1 FROM app.menu_items WHERE shop_id = $1::uuid AND status = 'VISIBLE'`, [shop.shopId]);
    expect(await visible()).toBe(20);
    expect((ok(await getMenu(app, shop.token)).visible as Json)).toEqual({ count: 20, limit: 20, expanded: false });
    const blocked = await createItem(app, shop.token, { name: 'Món 21', price_vnd: 30_000, category_id: category, image_id: imageId });
    expect(refused(blocked)).toEqual({ status: 409, code: 'MENU_VISIBLE_LIMIT_REACHED' });
    expect(await visible()).toBe(20);
    // Hiding frees a place without deleting anything; the hidden dish keeps its data; the number of changes is not limited.
    let first = items[0] as Json;
    for (let round = 0; round < 3; round += 1) {
      const hidden = ok(await itemAction(app, shop.token, String(first.item_id), 'hide', Number(first.version)));
      first = ok(await itemAction(app, shop.token, String(first.item_id), 'show', Number((hidden.item as Json).version))).item as Json;
    }
    expect(await visible()).toBe(20);
    const hidden = ok(await itemAction(app, shop.token, String(first.item_id), 'hide', Number(first.version))).item as Json;
    expect(await visible()).toBe(19);
    expect((await rows('SELECT name, price_vnd, image_id::text AS image FROM app.menu_items WHERE item_id = $1::uuid', [String(first.item_id)]))[0]).toEqual({ name: 'Món 1', price_vnd: 30_000, image: imageId });
    // The 20th place is contended by a new dish and by showing the hidden one at once: exactly one wins.
    const race = await Promise.all([createItem(app, shop.token, { name: 'Món đua', price_vnd: 30_000, category_id: category, image_id: imageId }), itemAction(app, shop.token, String(first.item_id), 'show', Number(hidden.version))]);
    expect(race.filter((r) => r.status === 409).length).toBe(1);
    expect(await visible()).toBe(20);
    // Granting lifts the limit, at once, for the next write.
    expect(aJson(await aPost(manager, `/shop-payments/shops/${shop.shopId}/menu-expanded/grant`, { reason: 'Mở rộng thực đơn thủ công', payment_request_id: null })).visible_count).toBe(20);
    const extra = await make('Món 21');
    const extra2 = await make('Món 22');
    expect(await visible()).toBe(22);
    expect((ok(await getMenu(app, shop.token)).visible as Json)).toEqual({ count: 22, limit: null, expanded: true });
    const totalBefore = await countRows(app.pool, `SELECT 1 FROM app.menu_items WHERE shop_id = $1::uuid`, [shop.shopId]);
    // Revoking removes nothing: 22 dishes stay visible, nothing is hidden or deleted; only adding / showing another is refused until the shop is back under 20.
    expect(aJson(await aPost(manager, `/shop-payments/shops/${shop.shopId}/menu-expanded/revoke`, { reason: 'Thu hồi quyền mở rộng' }))).toMatchObject({ menu_expanded: false, over_limit: true, visible_count: 22 });
    expect(await visible()).toBe(22);
    expect(await countRows(app.pool, `SELECT 1 FROM app.menu_items WHERE shop_id = $1::uuid AND status = 'DELETED'`, [shop.shopId])).toBe(0);
    expect(await countRows(app.pool, `SELECT 1 FROM app.menu_items WHERE shop_id = $1::uuid`, [shop.shopId])).toBe(totalBefore);
    expect(refused(await createItem(app, shop.token, { name: 'Món 23', price_vnd: 30_000, category_id: category, image_id: imageId }))).toEqual({ status: 409, code: 'MENU_VISIBLE_LIMIT_REACHED' });
    // The shop chooses what to hide; editing a visible dish stays possible while over the limit.
    expect((await call(shop.token, 'POST', '/shop/me/menu/items/' + String(extra.item_id) + '/hide', { expected_version: extra.version })).status).toBe(200);
    expect((await call(shop.token, 'POST', '/shop/me/menu/items/' + String(extra2.item_id) + '/hide', { expected_version: extra2.version })).status).toBe(200);
    expect(await visible()).toBe(20);
    expect(refused(await createItem(app, shop.token, { name: 'Món 24', price_vnd: 30_000, category_id: category, image_id: imageId }))).toEqual({ status: 409, code: 'MENU_VISIBLE_LIMIT_REACHED' });
  });

  // ---- #199: the shop payment conversation ----------------------------------------------------------------------------------------------

  it('one room per request: the owner and the permitted administrator write, strangers do not exist, a read-only administrator cannot write, text is stored as text, 500 characters, paging and idempotent retry', async () => {
    const request = await newRequest(quotaShop, 'OTHER', 33_000);
    const id = String(request.request_id);
    const mine = ok(await shopChat(quotaShop, id, 'POST', { body: '  Em đã chuyển   khoản <script>alert(1)</script> rồi ạ  ' }), 201);
    expect(mine.message).toMatchObject({ type: 'message', body: 'Em đã chuyển khoản <script>alert(1)</script> rồi ạ', sender: { role: 'SHOP', mine: true } });
    expect(mine.room).toMatchObject({ kind: 'SHOP_PAYMENT', id, open: true, can_send: true });
    // A retry with the same key returns the stored message; the same key with another text is refused; nothing is written twice.
    const key = randomUUID();
    const sent = ok(await shopChat(quotaShop, id, 'POST', { body: 'Một tin' }, key), 201);
    expect(ok(await shopChat(quotaShop, id, 'POST', { body: 'Một tin' }, key), 201)).toMatchObject({ replayed: true, message: { id: (sent.message as Json).id } });
    expect(refused(await shopChat(quotaShop, id, 'POST', { body: 'Tin khác' }, key))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.case_chat_messages WHERE shop_payment_id = $1::uuid', [id])).toBe(2);
    // Text only: 1..500 characters, exact body.
    expect((await shopChat(quotaShop, id, 'POST', { body: '' })).status).toBe(400);
    expect((await shopChat(quotaShop, id, 'POST', { body: 'x'.repeat(501) })).status).toBe(400);
    expect((await shopChat(quotaShop, id, 'POST', { body: 'ok', sender: 'ADMIN' })).status).toBe(400);
    expect((await shopChat(quotaShop, id, 'POST', { body: 'x'.repeat(500) })).status).toBe(201);
    // Strangers: the other shop and the Shipper side read it as a room that does not exist; an administrator without a right is refused.
    expect(refused(await shopChat(otherShop, id, 'GET'))).toEqual({ status: 404, code: 'SHOP_PAYMENT_NOT_FOUND' });
    expect(refused(await shopChat(otherShop, id, 'POST', { body: 'xin chào' }))).toEqual({ status: 404, code: 'SHOP_PAYMENT_NOT_FOUND' });
    expect(aCode(await adminShopChat(bare, id, 'GET'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(aCode(await adminShopChat(walletRecorder, id, 'GET'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // A read-only administrator reads and is refused when writing, whatever the screen shows; the one who handles the money writes (labelled).
    const asReader = aJson(await adminShopChat(reader, id, 'GET'));
    expect((asReader.room as Json).can_send).toBe(false);
    expect(aCode(await adminShopChat(reader, id, 'POST', { body: 'thử gửi' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(aCode(await adminShopChat(manager, id, 'POST', { body: 'thử gửi' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    const reply = await adminShopChat(recorder, id, 'POST', { body: 'Bên mình chưa thấy tiền về, bạn gửi giúp mã giao dịch nhé.' });
    expect(reply.status).toBe(201);
    expect(adminData(reply)).toMatchObject({ message: { sender: { role: 'ADMIN', name: 'Quản trị', mine: true } } });
    const feed = ok(await shopChat(quotaShop, id, 'GET'));
    expect(messagesIn(feed)).toEqual(expect.arrayContaining(['Bên mình chưa thấy tiền về, bạn gửi giúp mã giao dịch nhé.']));
    expect(systemIn(feed)[0]).toBe('Yêu cầu thanh toán được tạo');
    // Chat is not a command: messages that say "đã nộp" or "xác nhận" change nothing.
    ok(await shopChat(quotaShop, id, 'POST', { body: 'Xác nhận đã nhận tiền và mở tài khoản giúp em' }), 201);
    expect(await shopState(id)).toMatchObject({ state: 'PENDING', version: '1', reported: false });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_payment_settlements WHERE request_id = $1::uuid', [id])).toBe(0);
    // Paging newest first with a cursor: no repeat, no gap.
    const seen: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const page: Json = ok(await shopChat(quotaShop, id, 'GET', undefined, undefined, `?limit=2${before === null ? '' : `&before=${before}`}`));
      seen.unshift(...(page.items as Json[]).map((i) => String(i.id)).reverse().reverse());
      before = (page.next_before as string | null) ?? null;
      if (before === null) {
        break;
      }
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe((feed.items as Json[]).length + 1);
  });

  it('the sending rate is limited per sender and room (5 a minute) and the limit is counted in the database', async () => {
    const request = await newRequest(shop, 'OTHER', 12_000);
    const id = String(request.request_id);
    for (let i = 0; i < 5; i += 1) {
      ok(await shopChat(shop, id, 'POST', { body: `tin ${String(i)}` }), 201);
    }
    expect(refused(await shopChat(shop, id, 'POST', { body: 'tin 6' }))).toEqual({ status: 429, code: 'PAYMENT_CHAT_RATE_LIMITED' });
  });

  it('a closed request locks sending for good but stays readable; a retry of a message that was stored still answers; send-and-close has exactly one winner; the closing is a real milestone', async () => {
    const request = await newRequest(quotaShop, 'ACCOUNT_OPENING', 44_000);
    const id = String(request.request_id);
    const key = randomUUID();
    ok(await shopChat(quotaShop, id, 'POST', { body: 'trước khi đóng' }, key), 201);
    ok(await reportOf(quotaShop, id));
    expect(aJson(await aPost(recorder, `/shop-payments/${id}/reject`, { expected_version: 2, reason_code: 'NOT_RECEIVED' })).state).toBe('REJECTED');
    expect(refused(await shopChat(quotaShop, id, 'POST', { body: 'sau khi đóng' }))).toEqual({ status: 409, code: 'PAYMENT_CHAT_CLOSED' });
    expect(aCode(await adminShopChat(recorder, id, 'POST', { body: 'sau khi đóng' }))).toEqual({ status: 409, code: 'PAYMENT_CHAT_CLOSED' });
    expect(ok(await shopChat(quotaShop, id, 'POST', { body: 'trước khi đóng' }, key), 201)).toMatchObject({ replayed: true });
    const feed = ok(await shopChat(quotaShop, id, 'GET'));
    expect(feed.room).toMatchObject({ open: false, can_send: false, state: 'REJECTED' });
    expect(messagesIn(feed)).toEqual(['trước khi đóng']);
    expect(systemIn(feed)).toEqual(['Yêu cầu thanh toán được tạo', 'Đã báo chuyển khoản', 'Yêu cầu bị từ chối']);
    expect(aJson(await adminShopChat(reader, id, 'GET')).room).toMatchObject({ open: false, can_send: false });
    // The race: a message and the confirmation at the same time. Whatever wins, a message that was accepted is older than the closing, and none comes after it.
    const second = await newRequest(otherShop, 'ACCOUNT_OPENING', 55_000);
    const sid = String(second.request_id);
    const [sentResult, closeResult] = await Promise.all([shopChat(otherShop, sid, 'POST', { body: 'đua với đóng' }), aPost(recorder, `/shop-payments/${sid}/confirm`, confirmBody(1, { actual_amount_vnd: 55_000 }))]);
    expect(closeResult.status).toBe(200);
    expect([201, 409]).toContain(sentResult.status);
    const late = await rows(`SELECT count(*)::int AS n FROM app.case_chat_messages m JOIN app.shop_payment_requests r ON r.request_id = m.shop_payment_id WHERE r.request_id = $1::uuid AND m.created_at > r.resolved_at`, [sid]);
    expect((late[0] as Json).n).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.case_chat_messages WHERE shop_payment_id = $1::uuid', [sid])).toBe(sentResult.status === 201 ? 1 : 0);
  });

  it('M08: the owner is told once per room (no text), an administrator is not pushed, the settlement is told once, and the card opens only for the owner', async () => {
    const food = await newClientShop();
    const request = await newRequest(food, 'OTHER', 21_000);
    const id = String(request.request_id);
    await drain();
    const cards = (kind: string): Promise<Json[]> => rows(`SELECT target_type, target_id::text AS target_id, title, body, item_count FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = $2 AND target_id = $3::uuid`, [food.userId, kind, id]);
    ok(await shopChat(food, id, 'POST', { body: 'tin của chủ quán' }), 201);
    await drain();
    expect(await cards('PAYMENT_CHAT_MESSAGE')).toEqual([]);
    expect((await adminShopChat(recorder, id, 'POST', { body: 'Nội dung bí mật không được vào thông báo' })).status).toBe(201);
    expect((await adminShopChat(recorder, id, 'POST', { body: 'Tin thứ hai' })).status).toBe(201);
    await drain();
    const delivered = await cards('PAYMENT_CHAT_MESSAGE');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ target_type: 'SHOP_PAYMENT', target_id: id });
    expect(JSON.stringify(delivered)).not.toContain('bí mật');
    const inbox = ok(await call(food.token, 'GET', '/notifications?limit=50'));
    const card = (inbox.items as Json[]).find((n) => n.kind === 'PAYMENT_CHAT_MESSAGE') as Json | undefined;
    expect(card).toBeDefined();
    expect(ok(await call(food.token, 'POST', `/notifications/${String((card as Json).notification_id)}/open`, {}))).toMatchObject({ outcome: 'OK', target: { type: 'SHOP_PAYMENT', id } });
    // Another account cannot open that card, nor does it have one.
    expect(((await rows(`SELECT notification_id::text AS nid FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid`, [shop.userId, id])) as Json[]).length).toBe(0);
    ok(await reportOf(food, id));
    aJson(await aPost(recorder, `/shop-payments/${id}/confirm`, confirmBody(2, { actual_amount_vnd: 21_000 })));
    await drain();
    expect(await cards('SHOP_PAYMENT_UPDATED')).toHaveLength(1);
    // A closed request no longer pushes chat cards.
    expect(aCode(await adminShopChat(recorder, id, 'POST', { body: 'sau khi đóng' })).status).toBe(409);
  });

  // ---- #199: the Shipper top-up conversation ---------------------------------------------------------------------------------------------

  it('Shipper top-up: the report and the chat leave the wallet, the ledger and the request untouched; only the M04 confirmation credits; the room closes with the request; ORDER chat is unaffected', async () => {
    await ensureAccount();
    const mine = await newShipper(app, drivers, 10_000);
    shippers.push(mine);
    const other = await newShipper(app, drivers, 10_000);
    shippers.push(other);
    const before = await walletOf(app, mine);
    const ledgerBefore = await countRows(app.pool, 'SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [mine.walletId]);
    const topup = ok(await call(mine.token, 'POST', '/driver/wallet/topup-requests', { amount_vnd: 100_000 }), 201);
    const id = String(topup.request_id);
    expect(ok(await call(mine.token, 'GET', `/driver/wallet/topup-requests/${id}`)).reported_at).toBeNull();
    const key = randomUUID();
    const reported = ok(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/report-transfer`, {}, key));
    expect(reported).toMatchObject({ request_id: id, state: 'PENDING' });
    expect(reported.reported_at).not.toBeNull();
    expect(ok(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/report-transfer`, {})).reported_at).toBe(reported.reported_at);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.wallet_topup_reports WHERE request_id = $1::uuid', [id])).toBe(1);
    expect(ok(await call(mine.token, 'GET', `/driver/wallet/topup-requests/${id}`)).reported_at).toBe(reported.reported_at);
    ok(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/chat`, { body: 'Em đã chuyển khoản rồi anh ơi' }), 201);
    ok(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/chat`, { body: 'Xác nhận và cộng ví giúp em' }), 201);
    expect(await walletOf(app, mine)).toEqual(before);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [mine.walletId])).toBe(ledgerBefore);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.wallet_topups WHERE request_id = $1::uuid', [id])).toBe(0);
    expect(ok(await call(mine.token, 'GET', `/driver/wallet/topup-requests/${id}`)).state).toBe('PENDING');
    // Strangers: another Shipper reads nothing of it; an administrator needs the wallet rights; a shop owner has no such room.
    expect(refused(await call(other.token, 'GET', `/driver/wallet/topup-requests/${id}/chat`))).toEqual({ status: 404, code: 'TOPUP_REQUEST_NOT_FOUND' });
    expect(refused(await call(other.token, 'POST', `/driver/wallet/topup-requests/${id}/chat`, { body: 'xin chào' }))).toEqual({ status: 404, code: 'TOPUP_REQUEST_NOT_FOUND' });
    expect(refused(await call(other.token, 'POST', `/driver/wallet/topup-requests/${id}/report-transfer`, {}))).toEqual({ status: 404, code: 'TOPUP_REQUEST_NOT_FOUND' });
    expect(refused(await call(shop.token, 'GET', `/driver/wallet/topup-requests/${id}/chat`)).status).toBeGreaterThanOrEqual(400);
    expect(aCode(await aGet(bare, `/finance/topup-requests/${id}/chat`))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(aCode(await aGet(reader, `/finance/topup-requests/${id}/chat`))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    const asReader = aJson(await aGet(walletReader, `/finance/topup-requests/${id}/chat`));
    expect(asReader.room).toMatchObject({ kind: 'DRIVER_TOPUP', open: true, can_send: false });
    expect(systemIn(asReader)).toEqual(['Yêu cầu nạp tiền được tạo', 'Đã báo chuyển khoản']);
    expect(aCode(await aPost(walletReader, `/finance/topup-requests/${id}/chat`, { body: 'chỉ đọc' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await aPost(walletRecorder, `/finance/topup-requests/${id}/chat`, { body: 'Mình đang kiểm tra sao kê.' })).status).toBe(201);
    expect(messagesIn(ok(await call(mine.token, 'GET', `/driver/wallet/topup-requests/${id}/chat`)))).toContain('Mình đang kiểm tra sao kê.');
    // M08: the Shipper is told once (a collapsed card on the wallet target, no text) while the request is open.
    await drain();
    const cards = await rows(`SELECT target_type, title, body FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'PAYMENT_CHAT_MESSAGE' AND target_id = $2::uuid`, [mine.userId, id]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ target_type: 'WALLET_TXN' });
    expect(JSON.stringify(cards)).not.toContain('sao kê');
    // The queue of the top-ups shows the report to the administration (a notice, not a state).
    const listed = aJson(await aGet(walletReader, '/finance/topup-requests?status=PENDING&limit=50'));
    expect((listed.items as Json[]).find((r) => r.request_id === id)).toMatchObject({ state: 'PENDING', reported_at: reported.reported_at });
    // The M04 confirmation is the only thing that credits; the chat closes with it and stays readable; a shop payment room never mixes with it.
    const done = aJson(await aPost(walletRecorder, `/finance/topup-requests/${id}/confirm`, confirmBody(1, { actual_amount_vnd: 100_000 })));
    expect(done.state).toBe('CONFIRMED');
    expect((await walletOf(app, mine)).balance).toBe(before.balance + 100_000);
    expect(refused(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/chat`, { body: 'sau khi cộng ví' }))).toEqual({ status: 409, code: 'PAYMENT_CHAT_CLOSED' });
    expect(refused(await call(mine.token, 'POST', `/driver/wallet/topup-requests/${id}/report-transfer`, {}))).toEqual({ status: 409, code: 'TOPUP_REQUEST_STATE_CONFLICT' });
    const closed = ok(await call(mine.token, 'GET', `/driver/wallet/topup-requests/${id}/chat`));
    expect(closed.room).toMatchObject({ open: false, can_send: false, state: 'CONFIRMED' });
    expect(systemIn(closed)).toEqual(['Yêu cầu nạp tiền được tạo', 'Đã báo chuyển khoản', 'Quản trị viên đã xác nhận tiền']);
    expect(refused(await call(mine.token, 'GET', `/shop/me/payment-requests/${id}/chat`)).status).toBeGreaterThanOrEqual(400);
    // The order chat has nothing to do with it.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.order_chat_messages WHERE sender_user_id = ANY($1::uuid[])', [[mine.userId, other.userId, shop.userId]])).toBe(0);
  });

  it('the reconciliation is auditable and leaves no secret in audit or events', async () => {
    const request = await newRequest(quotaShop, 'MENU_EXPANSION', 9_000);
    const id = String(request.request_id);
    ok(await reportOf(quotaShop, id));
    const transaction = txid();
    aJson(await aPost(recorder, `/shop-payments/${id}/confirm`, confirmBody(2, { actual_amount_vnd: 9_000, canonical_transaction_id: transaction })));
    const evidence = JSON.stringify([
      await rows('SELECT metadata FROM app.audit_logs WHERE resource_id = $1', [id]),
      await rows('SELECT payload FROM app.outbox_events WHERE resource_id = $1', [id]),
    ]);
    expect(evidence).not.toContain(transaction);
    const holder = (await rows('SELECT account_number FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [accountId]))[0] as Json;
    expect(evidence).not.toContain(String(holder.account_number));
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action IN ('shop.payment_request.create.v1','shop.payment_request.report.v1','admin.shop_payment.confirm.v1')`, [id])).toBe(3);
    // No subscription machinery exists anywhere in the schema.
    const tables = await rows(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND (table_name LIKE '%subscription%' OR table_name LIKE 'shop_wallet%' OR table_name LIKE '%renewal%')`);
    expect(tables).toEqual([]);
    const columns = await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name LIKE 'shop_%' AND (column_name LIKE '%period%' OR column_name LIKE '%expires%' OR column_name LIKE '%renew%')`);
    expect(columns).toEqual([]);
  });
});
