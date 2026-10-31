import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { ApiResponse, AuthApp, dataOf, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';
import { cleanupOrders, Customer, Dish, Json, newCustomer, newDish, openAllWeek, PRIVACY, TERMS } from './support/m10-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issue #191, Administration web in a REAL Chrome against the real front, backend and PostgreSQL: "Trao đổi đơn hàng" and "Lưu lịch sử trao đổi" in the order
// and the delivery drawers. ORDER and DIRECT rooms, the rights (view / send / hold), open / closed / expired, complaint and manual hold, a lost answer retried
// with the SAME key (one message, one hold), a drawer changed while a request is on its way, a draft kept across a refresh, and what people typed shown as text.
// Screenshots of the real pages go to .test-results/admin-order-chat-shots.

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

describe('admin order chat (real browser)', () => {
  let app: AuthApp;
  let admin: AdminApp;
  let router: http.Server;
  let system: SystemSession;
  let shop: ShopOwner;
  let customer: Customer;
  let pho: Dish;
  let viewer: Person;
  let reviewer: Person;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let addedPolicy = false;
  const shots: Shot[] = [];
  const complaints: string[] = [];

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<Person> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function signIn(page: Page, who: { phone: { local: string }; password: string; userId: string; secret: string }): Promise<void> {
    await admin.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', who.phone.local);
    await page.fill('#password', who.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(admin, who.userId);
    await page.fill('#verify-code', totpNow(who.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }
  const asViewer = (page: Page): Promise<void> => signIn(page, { phone: viewer.phone, password: ADMIN_PASSWORD, userId: viewer.userId, secret: viewer.secret });
  const asReviewer = (page: Page): Promise<void> => signIn(page, { phone: reviewer.phone, password: ADMIN_PASSWORD, userId: reviewer.userId, secret: reviewer.secret });
  const asSystem = (page: Page): Promise<void> => signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });

  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };
  const press = (page: Page, text: string, within = 'document'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...${within}.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const feedText = (page: Page): Promise<string[]> => page.evaluate<string[]>(`[...document.querySelectorAll('.chat-feed .chat-item')].map((li) => li.textContent.trim())`);
  const texts = (page: Page, selector: string): Promise<string[]> => page.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent.trim())`);
  const waitChat = (page: Page, predicate: string): Promise<void> => page.waitFor(`(() => { const items = [...document.querySelectorAll('.chat-feed li')].map((li) => li.textContent); const keep = document.querySelector('.chat-keep')?.textContent ?? ''; const state = document.querySelector('.chat-state')?.textContent ?? ''; return ${predicate}; })()`);
  const noSideways = (page: Page): Promise<boolean> => page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth`);

  // ---- the application side (customer, shop) -----------------------------------------------------------------------------------

  const call = (token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const good = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 200)]).toEqual([status, response.text.slice(0, 200)]);
    return dataOf(response) as Json;
  };
  async function confirmedOrder(): Promise<Json> {
    const lines = [{ item_id: pho.itemId, quantity: 2, unit_price_vnd: pho.price }];
    const draft = { shop_id: shop.shopId, lines, recipient_name: 'Người nhận', recipient_phone: '0912345678', address: { address_text: '12 Phố Huế, Hà Nội', lat: 21.0, lng: 105.82 } };
    const preview = good(await call(customer.token, 'POST', '/customers/me/orders/preview', { ...draft, lines: lines.map(({ item_id, quantity }) => ({ item_id, quantity })) }));
    const fee = preview.fee as Json;
    const placed = good(
      await call(customer.token, 'POST', '/customers/me/orders', { client_ref: randomUUID(), ...draft, items_total_vnd: 90_000, expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot } }),
      201,
    );
    return good(await call(shop.token, 'POST', `/shop/me/orders/${String(placed.order_id)}/confirm`, { expected_version: placed.version }));
  }
  const customerSays = (orderId: string, body: string): Promise<Json> => Promise.resolve(call(customer.token, 'POST', `/customers/me/orders/${orderId}/chat`, { body })).then((r) => good(r, 201));
  const shopSays = (orderId: string, body: string): Promise<Json> => Promise.resolve(call(shop.token, 'POST', `/shop/me/orders/${orderId}/chat`, { body })).then((r) => good(r, 201));
  const cancel = async (order: Json): Promise<void> => {
    const fresh = good(await call(customer.token, 'GET', `/customers/me/orders/${String(order.order_id)}`));
    good(await call(shop.token, 'POST', `/shop/me/orders/${String(order.order_id)}/cancel`, { expected_version: fresh.version, reason: 'Hết hàng' }));
  };
  const stored = async (where: string, id: string, body?: string): Promise<number> =>
    (await app.pool.query(`SELECT 1 FROM app.order_chat_messages WHERE ${where} = $1::uuid ${body === undefined ? '' : 'AND body = $2'}`, body === undefined ? [id] : [id, body])).rowCount ?? 0;
  const audits = async (action: string, id: string): Promise<number> => (await app.pool.query('SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, id])).rowCount ?? 0;
  async function withoutTriggers(table: string, sql: string, params: unknown[]): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      await client.query(sql, params);
      await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const backdateEnd = (orderId: string, days: number): Promise<void> => withoutTriggers('orders', 'UPDATE app.orders SET ended_at = ended_at - make_interval(days => $2::int) WHERE order_id = $1::uuid', [orderId, days]);

  async function openOrder(page: Page, code: string): Promise<void> {
    await page.goto(`${origin}/operations/orders`);
    await page.waitFor(`document.querySelector('#order-search')`);
    await page.fill('#order-search', code);
    await page.waitFor(`document.querySelector(${JSON.stringify(`button[aria-label="Xem đơn ${code}"]`)})`);
    await page.click(`button[aria-label="Xem đơn ${code}"]`);
    await page.waitFor(`document.querySelector('#order-drawer .chat-block')`);
  }
  async function openDelivery(page: Page, code: string): Promise<void> {
    await page.goto(`${origin}/operations/deliveries`);
    await page.waitFor(`document.querySelector('#delivery-search')`);
    await page.fill('#delivery-search', code);
    await page.waitFor(`document.querySelector(${JSON.stringify(`button[aria-label="Xem giao hàng ${code}"]`)})`);
    await page.click(`button[aria-label="Xem giao hàng ${code}"]`);
    await page.waitFor(`document.querySelector('.drawer .chat-block')`);
  }

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const routerOrigin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-chat-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin: routerOrigin, timeoutMs: 3000 } }] });
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
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    customer = await newCustomer(app, 'Khách Trao đổi');
    pho = await newDish(app, shop.token, 'Phở admin', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    viewer = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }], `Quản trị xem ${tag}`);
    reviewer = await activatedAdmin([{ app: 'DRIVER', can_view: true, can_review_profile: true, can_lock: false }], `Quản trị duyệt ${tag}`);
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-order-chat-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.png`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      for (const id of complaints) {
        await withoutTriggers('complaints', 'DELETE FROM app.complaints WHERE complaint_id = $1::uuid', [id]).catch(() => undefined);
      }
      await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [customer.userId], drivers: [], userIds: [customer.userId, shop.userId], policyAdded: addedPolicy });
      await app.close();
    }
    if (admin !== undefined) {
      await admin.close();
    }
    await new Promise<void>((resolve) => router.close(() => resolve()));
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('a viewer reads the room of an ORDER (names, roles, times, neutral milestones), types are text, collapses it, sends after the ACK, and keeps the investigation log', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    await customerSays(id, PAYLOAD);
    await shopSays(id, 'Quán đã nhận, sẽ làm ngay');
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asViewer(page);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.length >= 3`);
    // Open by default, collapsible; the label is exactly the specified one.
    expect(await page.evaluate<string>(`document.querySelector('.chat-toggle').textContent`)).toBe('Trao đổi đơn hàng');
    expect(await page.evaluate<string>(`document.querySelector('.chat-toggle').getAttribute('aria-expanded')`)).toBe('true');
    // What people typed is TEXT: no element, no script ran, the exact characters are on the page.
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-feed img') === null && document.querySelector('.chat-feed b') === null && window.__xss === undefined`)).toBe(true);
    expect(await texts(page, '.chat-message .chat-text')).toContain(PAYLOAD);
    // Name, role and time per message; milestones are neutral lines without a sender.
    const first = await page.evaluate<{ name: string; role: string; time: string }>(
      `(() => { const li = [...document.querySelectorAll('.chat-message')].find((x) => x.querySelector('.chat-text').textContent === ${JSON.stringify(PAYLOAD)}); return { name: li.querySelector('.chat-name').textContent, role: li.querySelector('.chat-role').textContent, time: li.querySelector('time').textContent }; })()`,
    );
    expect(first.role).toBe('Khách');
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.time).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/u);
    expect(await page.evaluate<number>(`document.querySelectorAll('.chat-system').length`)).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-system .chat-name') === null`)).toBe(true);
    // The investigation log of the drawer is still there, and the chat does not repeat the technical events.
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('#order-drawer h3')].some((h) => h.textContent === 'Diễn biến')`)).toBe(true);
    expect((await texts(page, '.chat-feed')).join(' ')).not.toMatch(/order\.|delivery\.|_BY_|\.v1/u);
    // Who sees what: the note says the participants read it; the real days; the viewer has NO hold button.
    expect(await page.text('.chat-note')).toContain('các bên tham gia');
    await waitChat(page, `keep.includes('7 ngày') && keep.includes('Hồ sơ đang mở')`);
    expect(await press(page, 'Giữ chứng cứ')).toBe(false);
    expect(await press(page, 'Kết thúc giữ chứng cứ')).toBe(false);
    await shot(page, 'order-chat-open-desktop');
    // Collapse and open again.
    await page.click('.chat-toggle');
    await page.waitFor(`document.querySelector('.chat-body').hidden === true`);
    await page.click('.chat-toggle');
    await page.waitFor(`document.querySelector('.chat-body').hidden === false`);
    // Send: nothing on screen or in the table before the server acknowledged; after it, one message with the staff label.
    await page.fill('.chat-input', 'Bộ phận hỗ trợ đang xem đơn');
    expect(await page.text('.chat-count')).toBe(`${String([...'Bộ phận hỗ trợ đang xem đơn'].length)}/500`);
    expect(await press(page, 'Gửi')).toBe(true);
    await waitChat(page, `items.some((t) => t.includes('Bộ phận hỗ trợ đang xem đơn'))`);
    expect(await stored('order_id', id, 'Bộ phận hỗ trợ đang xem đơn')).toBe(1);
    expect(await page.evaluate<string>(`document.querySelector('.chat-input').value`)).toBe('');
    const mine = await page.evaluate<string>(`document.querySelector('.chat-mine .chat-role').textContent`);
    expect(mine).toBe('Admin');
    expect((await app.pool.query('SELECT sender_role FROM app.order_chat_messages WHERE order_id = $1::uuid AND body = $2', [id, 'Bộ phận hỗ trợ đang xem đơn'])).rows[0]).toMatchObject({ sender_role: 'ADMIN' });
    // The customer sees the staff message with its own label.
    const asCustomer = good(await call(customer.token, 'GET', `/customers/me/orders/${id}/chat`));
    expect((asCustomer.items as Json[]).some((i) => i.type === 'message' && (i.sender as Json).role === 'ADMIN' && i.body === 'Bộ phận hỗ trợ đang xem đơn')).toBe(true);
    // Too long: refused on the page, nothing is sent.
    await page.fill('.chat-input', 'a'.repeat(501));
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer button[type=submit]').disabled`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-count').classList.contains('chat-count-over')`)).toBe(true);
    await page.fill('.chat-input', '');
    // 390 px: no sideways scroll, the composer and the feed fit.
    await page.viewport(390, 844, true);
    await page.waitFor(`document.querySelector('.chat-block')`);
    expect(await noSideways(page)).toBe(true);
    await page.evaluate(`document.querySelector('.chat-block').scrollIntoView()`);
    await shot(page, 'order-chat-open-mobile');
    await page.close();
  }, 300_000);

  it('a refresh brings new messages without losing the draft or the reading place, and older messages page in', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    // 40 messages straight into the table (the send limit is 12 a minute): the newest page holds 30, the rest is behind "Xem tin cũ hơn".
    await app.pool.query(
      `INSERT INTO app.order_chat_messages (message_id, room_type, order_id, sender_user_id, sender_role, sender_name, body, client_key, created_at)
       SELECT gen_random_uuid(), 'ORDER', $1::uuid, $2::uuid, 'CUSTOMER', 'Khách Trao đổi', 'Tin số ' || n, gen_random_uuid(), date_trunc('milliseconds', now()) - make_interval(secs => 100 - n) FROM generate_series(1, 40) n`,
      [id, customer.userId],
    );
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asViewer(page);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.some((t) => t.includes('Tin số 40'))`);
    // One page is 30 entries of the feed (messages and milestones together); the rest is behind "Xem tin cũ hơn".
    expect(await page.evaluate<number>(`document.querySelectorAll('.chat-feed .chat-item').length`)).toBe(30);
    expect(await page.evaluate<boolean>(`!document.querySelector('.chat-older').hidden`)).toBe(true);
    expect(await texts(page, '.chat-message .chat-text')).not.toContain('Tin số 1');
    // Older page: the reading place stays on what was read (nothing jumps to the top or the bottom).
    await page.evaluate(`document.querySelector('.chat-feed').scrollTop = 0`);
    const anchorBefore = await page.evaluate<number>(`(() => { const li = [...document.querySelectorAll('.chat-message')].find((x) => x.textContent.includes('Tin số 20')); return li.getBoundingClientRect().top - document.querySelector('.chat-feed').getBoundingClientRect().top; })()`);
    expect(await press(page, 'Xem tin cũ hơn')).toBe(true);
    await page.waitFor(`document.querySelector('.chat-older').hidden && document.querySelectorAll('.chat-message').length === 40`);
    expect(await texts(page, '.chat-message .chat-text')).toContain('Tin số 1');
    expect(await page.evaluate<number>(`document.querySelectorAll('.chat-message').length`)).toBe(40);
    const anchorAfter = await page.evaluate<number>(`(() => { const li = [...document.querySelectorAll('.chat-message')].find((x) => x.textContent.includes('Tin số 20')); return li.getBoundingClientRect().top - document.querySelector('.chat-feed').getBoundingClientRect().top; })()`);
    expect(Math.abs(anchorAfter - anchorBefore)).toBeLessThan(4);
    // A draft, a reading place in the middle, and a new message from the customer: "Tải tin mới" adds it and touches neither.
    await page.fill('.chat-input', 'đang gõ dở');
    await page.evaluate(`document.querySelector('.chat-feed').scrollTop = 40`);
    await customerSays(id, 'Tin mới từ khách');
    expect(await press(page, 'Tải tin mới')).toBe(true);
    await waitChat(page, `items.some((t) => t.includes('Tin mới từ khách'))`);
    expect(await page.evaluate<string>(`document.querySelector('.chat-input').value`)).toBe('đang gõ dở');
    expect(await page.evaluate<number>(`document.querySelector('.chat-feed').scrollTop`)).toBe(40);
    // Offline: the page says so, keeps what it has and the draft; online again, the refresh works.
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(await press(page, 'Tải tin mới')).toBe(true);
    await waitChat(page, `state.includes('Mất kết nối')`);
    expect(await page.evaluate<string>(`document.querySelector('.chat-input').value`)).toBe('đang gõ dở');
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(await press(page, 'Tải tin mới')).toBe(true);
    await waitChat(page, `!state.includes('Mất kết nối')`);
    await page.close();
  }, 300_000);

  it('a lost answer: "Thử lại" sends the SAME message under the SAME key; one row, nothing is shown before the server acknowledged it', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    await shopSays(id, 'Mở đầu');
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asViewer(page);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.some((t) => t.includes('Mở đầu'))`);
    const before = await page.evaluate<number>(`document.querySelectorAll('.chat-message').length`);
    await page.fill('.chat-input', 'Tin cần gửi đúng một lần');
    await page.interceptResponses(`*/v1/admin/orders/${id}/chat`);
    expect(await press(page, 'Gửi')).toBe(true);
    // The server really stores it; the answer never reaches the page.
    for (let guard = 0; guard < 10; guard += 1) {
      const paused = await page.nextPausedResponse();
      if (paused.status === 201) {
        await page.failResponse(paused.requestId);
        break;
      }
      await page.send('Fetch.continueRequest', { requestId: paused.requestId });
    }
    await page.stopIntercepting();
    await page.waitFor(`[...document.querySelectorAll('.chat-composer button')].some((b) => b.textContent.trim() === 'Thử lại')`);
    expect(await page.text('.chat-composer [id$="-status"]')).toContain('Chưa xác nhận được kết quả');
    expect(await page.evaluate<number>(`document.querySelectorAll('.chat-message').length`)).toBe(before);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-input').disabled`)).toBe(true);
    expect(await stored('order_id', id, 'Tin cần gửi đúng một lần')).toBe(1);
    await shot(page, 'order-chat-unknown-desktop');
    expect(await press(page, 'Thử lại')).toBe(true);
    await waitChat(page, `items.some((t) => t.includes('Tin cần gửi đúng một lần'))`);
    expect(await stored('order_id', id, 'Tin cần gửi đúng một lần')).toBe(1);
    expect(await page.evaluate<number>(`[...document.querySelectorAll('.chat-message .chat-text')].filter((e) => e.textContent === 'Tin cần gửi đúng một lần').length`)).toBe(1);
    expect(await page.evaluate<boolean>(`!document.querySelector('.chat-input').disabled && document.querySelector('.chat-input').value === ''`)).toBe(true);
    await page.close();
  }, 300_000);

  it('the order closes while the viewer types: the send is refused with the draft kept, the room turns read-only; after the retention days it says it expired and shows nothing', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    await customerSays(id, 'Tin trước khi đóng');
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asViewer(page);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.some((t) => t.includes('Tin trước khi đóng'))`);
    await page.fill('.chat-input', 'Tin gõ dở khi đơn bị hủy');
    await cancel(order);
    expect(await press(page, 'Gửi')).toBe(true);
    await page.waitFor(`document.querySelector('.chat-composer').textContent.includes('Hồ sơ đã đóng')`);
    expect(await stored('order_id', id, 'Tin gõ dở khi đơn bị hủy')).toBe(0);
    await waitChat(page, `state.includes('chỉ xem')`);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden`)).toBe(true);
    expect(await page.evaluate<string>(`document.querySelector('.chat-input').value`)).toBe('Tin gõ dở khi đơn bị hủy');
    expect(await texts(page, '.chat-message .chat-text')).toContain('Tin trước khi đóng');
    await waitChat(page, `keep.includes('Hồ sơ đóng lúc') && keep.includes('Hết hạn lúc')`);
    await shot(page, 'order-chat-closed-desktop');
    // Past the retention: the messages are gone for good and the page says so; the business log of the drawer is untouched.
    await backdateEnd(id, 8);
    await page.reload();
    await page.waitFor(`document.querySelector('#order-search')`);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.some((t) => t.includes('hết hạn lưu')) && keep.includes('Đã hết hạn lưu')`);
    expect(await page.evaluate<number>(`document.querySelectorAll('.chat-message').length`)).toBe(0);
    expect(await press(page, 'Giữ chứng cứ')).toBe(false);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('#order-drawer h3')].some((h) => h.textContent === 'Diễn biến')`)).toBe(true);
    await shot(page, 'order-chat-expired-desktop');
    await page.close();
  }, 300_000);

  it('a reviewer places and releases the evidence hold (reason and confirmation each time, a lost answer retried with one key); a complaint keeps holding; it never reopens the chat', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    await customerSays(id, 'Bằng chứng cần giữ');
    await cancel(order);
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asReviewer(page);
    await openOrder(page, String(order.code));
    await waitChat(page, `items.some((t) => t.includes('Bằng chứng cần giữ')) && keep.includes('Giữ chứng cứ')`);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden`)).toBe(true);
    expect(await press(page, 'Kết thúc giữ chứng cứ')).toBe(false);
    // Reason and confirmation are both required; nothing is sent before.
    expect(await press(page, 'Giữ chứng cứ', 'document.querySelector(".chat-keep")')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Giữ chứng cứ', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#chat-hold-reason-error').textContent.includes('Lý do là bắt buộc')`);
    await page.fill('#chat-hold-reason', 'Khiếu nại của khách về chất lượng');
    expect(await press(page, 'Giữ chứng cứ', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#chat-hold-reason-error').textContent.includes('xác nhận')`);
    expect(await audits('admin.order_chat.hold.v1', id)).toBe(0);
    await shot(page, 'order-chat-hold-dialog-desktop');
    await page.click('#chat-hold-sure');
    // The answer is lost: the dialog freezes on "Thử lại"; the retry is the same request (one hold, one audit row).
    await page.interceptResponses(`*/v1/admin/orders/${id}/chat-hold/place`);
    expect(await press(page, 'Giữ chứng cứ', 'document.querySelector(".dialog")')).toBe(true);
    const paused = await page.nextPausedResponse();
    await page.failResponse(paused.requestId);
    await page.stopIntercepting();
    await page.waitFor(`[...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === 'Thử lại')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#chat-hold-reason').disabled`)).toBe(true);
    expect(await audits('admin.order_chat.hold.v1', id)).toBe(1);
    expect(await press(page, 'Thử lại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.querySelector('.chat-keep').textContent.includes('Đang giữ từ')`);
    expect(await audits('admin.order_chat.hold.v1', id)).toBe(1);
    expect((await app.pool.query('SELECT 1 FROM app.order_chat_holds WHERE order_id = $1::uuid AND released_at IS NULL', [id])).rowCount).toBe(1);
    expect(await page.text('.chat-hold-reason')).toBe('Khiếu nại của khách về chất lượng');
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden`)).toBe(true);
    expect(await press(page, 'Giữ chứng cứ', 'document.querySelector(".chat-keep")')).toBe(false);
    await waitChat(page, `keep.includes('Đang được giữ')`);
    await shot(page, 'order-chat-hold-placed-desktop');
    // A complaint about the order is open: releasing the manual hold changes nothing about the complaint hold.
    const complaintId = randomUUID();
    complaints.push(complaintId);
    await app.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, order_id, shop_id, related_code, shop_name, scope_key, status, body, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, 'K', 'Quán', $4::uuid, 'PENDING', 'Đơn có vấn đề', now(), now())`,
      [complaintId, `PA${String(Date.now()).slice(-9)}`, customer.userId, id, shop.shopId],
    );
    await page.reload();
    await page.waitFor(`document.querySelector('#order-search')`);
    await openOrder(page, String(order.code));
    await waitChat(page, `keep.includes('Giữ do khiếu nại: Có') && keep.includes('Đang giữ từ')`);
    expect(await press(page, 'Kết thúc giữ chứng cứ', 'document.querySelector(".chat-keep")')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    await page.fill('#chat-hold-reason', 'Đã làm việc xong với khách');
    await page.click('#chat-hold-sure');
    expect(await press(page, 'Kết thúc giữ chứng cứ', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.querySelector('.chat-keep').textContent.includes('Giữ chứng cứ: Không')`);
    expect(await audits('admin.order_chat.release.v1', id)).toBe(1);
    await waitChat(page, `keep.includes('Giữ do khiếu nại: Có') && keep.includes('Đang được giữ')`);
    expect(await page.evaluate<boolean>(`document.querySelector('.chat-composer').hidden`)).toBe(true);
    expect(await texts(page, '.chat-message .chat-text')).toContain('Bằng chứng cần giữ');
    await shot(page, 'order-chat-complaint-hold-desktop');
    await page.close();
  }, 300_000);

  it('changing the drawer while a read is on its way never shows the earlier order\'s messages in the later one', async () => {
    const first = await confirmedOrder();
    const second = await confirmedOrder();
    await customerSays(String(first.order_id), 'Chỉ có trong đơn thứ nhất');
    await customerSays(String(second.order_id), 'Chỉ có trong đơn thứ hai');
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asViewer(page);
    await page.goto(`${origin}/operations/orders`);
    await page.waitFor(`document.querySelector('#order-search')`);
    await page.waitFor(`document.querySelector(${JSON.stringify(`button[aria-label="Xem đơn ${String(first.code)}"]`)}) && document.querySelector(${JSON.stringify(`button[aria-label="Xem đơn ${String(second.code)}"]`)})`);
    // The first order's chat answer is held back; the second order is opened meanwhile.
    await page.interceptResponses(`*/v1/admin/orders/${String(first.order_id)}/chat*`);
    await page.click(`button[aria-label="Xem đơn ${String(first.code)}"]`);
    const held = await page.nextPausedResponse();
    await page.click(`button[aria-label="Xem đơn ${String(second.code)}"]`);
    await page.waitFor(`document.querySelectorAll('#order-drawer .chat-block').length === 1`);
    await waitChat(page, `items.some((t) => t.includes('Chỉ có trong đơn thứ hai'))`);
    // Only now the earlier answer arrives: it must change nothing.
    await page.send('Fetch.continueRequest', { requestId: held.requestId });
    await page.stopIntercepting();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const seen = (await feedText(page)).join(' ');
    expect(seen).toContain('Chỉ có trong đơn thứ hai');
    expect(seen).not.toContain('Chỉ có trong đơn thứ nhất');
    expect(await page.evaluate<boolean>(`document.querySelector('#order-drawer').textContent.includes(${JSON.stringify(String(second.code))})`)).toBe(true);
    await page.close();
  }, 300_000);

  it('SYSTEM in the delivery drawer: an ORDER delivery uses the room of its order, a DIRECT delivery the room of the delivery (never a second room)', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    await customerSays(id, 'Tin của đơn có giao hàng');
    const called = good(await call(shop.token, 'POST', `/shop/me/orders/${id}/call-shipper`, { expected_version: order.version }), 201);
    const orderDelivery = called.delivery as Json;
    const direct = good(
      await call(shop.token, 'POST', '/shop/me/deliveries', { recipient_name: 'Khách nhận', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'CUSTOMER' }),
      201,
    );
    const directId = String(direct.delivery_id);
    good(await call(shop.token, 'POST', `/shop/me/deliveries/${directId}/chat`, { body: 'Tin giao trực tiếp' }), 201);
    const rooms = async (): Promise<number> => (await app.pool.query('SELECT 1 FROM app.order_chat_messages WHERE order_id = $1::uuid OR delivery_id = $2::uuid', [id, directId])).rowCount ?? 0;
    const before = await rooms();
    const ordersBefore = (await app.pool.query('SELECT 1 FROM app.orders WHERE shop_id = $1::uuid', [shop.shopId])).rowCount;
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await asSystem(page);
    // ORDER delivery: the order's messages, in the order's room.
    await openDelivery(page, String(orderDelivery.code));
    await waitChat(page, `items.some((t) => t.includes('Tin của đơn có giao hàng'))`);
    expect(await page.evaluate<string>(`document.querySelector('.drawer .chat-block').getAttribute('data-room')`)).toBe('ORDER');
    expect((await feedText(page)).join(' ')).not.toContain('Tin giao trực tiếp');
    await page.fill('.chat-input', 'SYSTEM nhắn từ màn giao hàng');
    expect(await press(page, 'Gửi')).toBe(true);
    await waitChat(page, `items.some((t) => t.includes('SYSTEM nhắn từ màn giao hàng'))`);
    expect((await app.pool.query('SELECT order_id, delivery_id, sender_role FROM app.order_chat_messages WHERE body = $1', ['SYSTEM nhắn từ màn giao hàng'])).rows[0]).toMatchObject({ order_id: id, delivery_id: null, sender_role: 'SYSTEM' });
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('.drawer h3')].some((h) => h.textContent === 'Diễn biến')`)).toBe(true);
    await shot(page, 'delivery-chat-order-desktop');
    // DIRECT delivery: the delivery's own room, and not the order's messages.
    await openDelivery(page, String(direct.code));
    await waitChat(page, `items.some((t) => t.includes('Tin giao trực tiếp'))`);
    expect(await page.evaluate<string>(`document.querySelector('.drawer .chat-block').getAttribute('data-room')`)).toBe('DIRECT');
    expect((await feedText(page)).join(' ')).not.toContain('Tin của đơn có giao hàng');
    await page.fill('.chat-input', 'SYSTEM nhắn vào giao trực tiếp');
    expect(await press(page, 'Gửi')).toBe(true);
    await waitChat(page, `items.some((t) => t.includes('SYSTEM nhắn vào giao trực tiếp'))`);
    expect((await app.pool.query('SELECT order_id, delivery_id, sender_role FROM app.order_chat_messages WHERE body = $1', ['SYSTEM nhắn vào giao trực tiếp'])).rows[0]).toMatchObject({ order_id: null, delivery_id: directId, sender_role: 'SYSTEM' });
    expect(await rooms()).toBe(before + 2);
    expect((await app.pool.query('SELECT 1 FROM app.orders WHERE shop_id = $1::uuid', [shop.shopId])).rowCount).toBe(ordersBefore);
    await shot(page, 'delivery-chat-direct-desktop');
    await page.close();
  }, 300_000);
  it('Business Dashboard reuses the live session at phone width and sends financial chat through the real API', async()=>{
    const requestId=randomUUID();
    await app.pool.query(`INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,shop_id,amount_requested_vnd,state) VALUES($1,'SHOP_PAYMENT',$2,$3,29000,'PENDING')`,[requestId,shop.userId,shop.shopId]);
    const page=await (browser as Browser).newPage();
    try {
      await page.viewport(390,844,true);await page.send('Network.clearBrowserCookies');await asSystem(page);
      await page.goto(origin+'/business/');
      await page.waitFor(`document.querySelector('.business-nav') && document.querySelector('.business-tile strong')`);
      expect(await noSideways(page)).toBe(true);
      expect(await page.evaluate<number>(`document.querySelectorAll('.business-nav button').length`)).toBe(6);
      expect(await page.evaluate<boolean>(`document.querySelector('.business-error').hidden`)).toBe(true);
      await shot(page,'business-overview-phone');
      await page.goto(origin+'/business/chat?request='+requestId);
      await page.waitFor(`document.querySelector('.business-message p') && document.querySelector('textarea[aria-label="Tin nhắn"]')`);
      await page.fill('textarea[aria-label="Tin nhắn"]','Quản trị đã nhận thông tin, đang đối chiếu');
      expect(await press(page,'Gửi tin nhắn')).toBe(true);
      await page.waitFor(`[...document.querySelectorAll('.business-message p')].some(p=>p.textContent.includes('Quản trị đã nhận thông tin'))`);
      expect((await app.pool.query(`SELECT count(*)::int AS n FROM app.business_finance_messages WHERE request_id=$1 AND sender_role='SYSTEM' AND body=$2`,[requestId,'Quản trị đã nhận thông tin, đang đối chiếu'])).rows[0].n).toBe(1);
      await shot(page,'business-finance-chat-phone');
      await page.reload();await page.waitFor(`document.querySelector('.business-messages')?.textContent.includes('Quản trị đã nhận thông tin')`);
      expect(await noSideways(page)).toBe(true);
      expect(await page.evaluate<boolean>(`document.querySelector('link[rel="manifest"]').getAttribute('href')==='/business.webmanifest'`)).toBe(true);
      const manifest=await page.evaluate<{scope:string;display:string}>(`fetch('/business.webmanifest').then(r=>r.json())`);
      expect(manifest).toMatchObject({scope:'/business/',display:'standalone'});
      await page.viewport(1280,900,false);expect(await noSideways(page)).toBe(true);
      await shot(page,'business-finance-chat-desktop');
    } finally {await page.close();}
  },180000);

  it('#237: an ADMIN that may only view the SHOP app keeps the whole PWA: a tab it may not read says which grant is missing and the other tabs still open', async () => {
    const page = await (browser as Browser).newPage();
    try {
      await page.viewport(390, 844, true);
      await page.send('Network.clearBrowserCookies');
      await asViewer(page);
      await page.goto(origin + '/business/overview');
      await page.waitFor(`document.querySelector('.business-nav') && document.querySelector('.business-error') && !document.querySelector('.business-error').hidden && document.querySelector('.business-error').textContent.includes('report.read')`);
      const refusal = await page.evaluate<string>(`document.querySelector('.business-error').textContent`);
      expect(refusal).toContain('chưa được cấp quyền');
      expect(refusal).toContain('report.read');
      expect(refusal).toContain('Các mục khác vẫn dùng bình thường');
      expect(await page.evaluate<number>(`document.querySelectorAll('.business-nav button').length`)).toBe(6);
      // Another tab on the same session still opens: the refusal of one tab is not a blank application.
      await page.goto(origin + '/business/finance');
      await page.waitFor(`document.querySelector('.business-error') && !document.querySelector('.business-error').hidden && document.querySelector('.business-error').textContent.includes('wallet.read')`);
      await page.goto(origin + '/business/orders');
      await page.waitFor(`document.querySelector('.business-content h2') && document.querySelector('.business-content h2').textContent.startsWith('Đơn món') && document.querySelector('.business-error') && document.querySelector('.business-error').hidden`);
      expect(await page.evaluate<boolean>(`document.querySelector('.business-error').hidden`)).toBe(true);
      expect(await page.evaluate<number>(`document.querySelectorAll('.business-nav button').length`)).toBe(6);
    } finally {
      await page.close();
    }
  }, 180000);

  it('#236: the order detail of the Mini Business offers only the exception actions the SERVER allows: a viewer sees "Chỉ xem"; SYSTEM cancels with a mandatory reason and the page reloads from the server', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    const open = `(() => { [...document.querySelectorAll('.business-request')][0].click(); return true; })()`;
    const viewerPage = await (browser as Browser).newPage();
    try {
      await viewerPage.viewport(390, 844, true);
      await viewerPage.send('Network.clearBrowserCookies');
      await asViewer(viewerPage);
      await viewerPage.goto(origin + '/business/orders');
      await viewerPage.waitFor(`document.querySelectorAll('.business-request').length > 0`);
      await viewerPage.evaluate(open);
      await viewerPage.waitFor(`[...document.querySelectorAll('.business-content p')].some((p) => p.textContent.includes('Chỉ xem'))`);
      expect(await viewerPage.evaluate<number>(`[...document.querySelectorAll('.business-content button')].filter((b) => b.textContent.includes('Hủy đơn món') || b.textContent.includes('Không hoàn tất')).length`)).toBe(0);
    } finally {
      await viewerPage.close();
    }
    const page = await (browser as Browser).newPage();
    try {
      await page.viewport(390, 844, true);
      await page.send('Network.clearBrowserCookies');
      await asSystem(page);
      await page.goto(origin + '/business/orders');
      await page.waitFor(`document.querySelectorAll('.business-request').length > 0`);
      await page.evaluate(open);
      await page.waitFor(`[...document.querySelectorAll('.business-content button')].some((b) => b.textContent.includes('Hủy đơn món'))`);
      // No reason: refused before anything is sent. With a reason and the confirmation: sent once, then the detail is read again from the server.
      await page.evaluate(`window.confirm = () => true; true`);
      expect(await press(page, 'Xác nhận: Hủy đơn món')).toBe(true);
      expect(await page.evaluate<string>(`document.querySelector('.business-error').textContent`)).toContain('Lý do là bắt buộc');
      expect((await app.pool.query('SELECT status FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0]?.status).toBe('PREPARING');
      await page.fill('textarea[aria-label="Lý do cho Hủy đơn món"]', 'Quán hết nguyên liệu');
      expect(await press(page, 'Xác nhận: Hủy đơn món')).toBe(true);
      await page.waitFor(`document.querySelector('.business-error') && document.querySelector('.business-error').textContent.includes('Đã cập nhật')`);
      const row = (await app.pool.query('SELECT status, end_reason FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0];
      expect(row?.status).toBe('CANCELLED_BY_SHOP');
      expect(row?.end_reason).toBe('Quán hết nguyên liệu');
    } finally {
      await page.close();
    }
  }, 240000);

  it('#241/#242: the "Vận hành" tab shows the four questions with honest empty states, never 0 % for no data, the anomaly list says it is for review only; an ADMIN without report.read is told it has no right', async () => {
    const page = await (browser as Browser).newPage();
    try {
      await page.viewport(390, 844, true);
      await page.send('Network.clearBrowserCookies');
      await asSystem(page);
      await page.goto(origin + '/business/ops');
      await page.waitFor(`document.querySelectorAll('.business-ops [data-block]').length >= 5`);
      expect(await page.evaluate<number>(`document.querySelectorAll('.business-nav button').length`)).toBe(6);
      expect(await noSideways(page)).toBe(true);
      const text = await page.evaluate<string>(`document.querySelector('.business-ops').textContent`);
      for (const part of ['1 · Không tìm được shipper', '2 · Quán xác nhận chậm', '3 · Giờ nghi thiếu shipper', '4 · Đơn bị hủy nhiều nhất ở bước nào', 'không tự khóa, hạn chế, trừ tiền hay đổi quyền nhận chuyến']) expect(text).toContain(part);
      expect(text).not.toContain('(0/0)');
      await shot(page, 'business-ops-phone');
    } finally {
      await page.close();
    }
    const denied = await (browser as Browser).newPage();
    try {
      await denied.viewport(390, 844, true);
      await denied.send('Network.clearBrowserCookies');
      await asViewer(denied);
      await denied.goto(origin + '/business/ops');
      await denied.waitFor(`document.querySelector('.business-error') && !document.querySelector('.business-error').hidden && document.querySelector('.business-error').textContent.includes('chưa được cấp quyền')`);
      expect(await denied.evaluate<number>(`document.querySelectorAll('.business-nav button').length`)).toBe(6);
    } finally {
      await denied.close();
    }
  }, 240000);

  it('a delayed finance response cannot restore another account\'s requests after logout and login in the same PWA',async()=>{
    const requestId=randomUUID();
    await app.pool.query(`INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,shop_id,amount_requested_vnd,state) VALUES($1,'SHOP_PAYMENT',$2,$3,29000,'PENDING')`,[requestId,shop.userId,shop.shopId]);
    const page=await (browser as Browser).newPage();
    try{
      await page.viewport(390,844,true);await page.send('Network.clearBrowserCookies');await asSystem(page);
      await page.interceptResponses('*/v1/admin/business/reports*');
      await page.goto(origin+'/business/finance');
      const held=await page.nextPausedResponse();
      expect(await press(page,'Đăng xuất')).toBe(true);
      await page.waitFor(`document.querySelector('#login-title')`);
      await admin.clearLimits();
      await page.fill('#phone',viewer.phone.local);await page.fill('#password',ADMIN_PASSWORD);await page.pressEnter();
      await page.waitFor(`document.querySelector('#verify-title')`);
      await rewindAcceptedStep(admin,viewer.userId);await page.fill('#verify-code',totpNow(viewer.secret));await page.pressEnter();
      await page.waitFor(`document.querySelector('.business-nav') && document.querySelector('.business-error')?.textContent.includes('chưa được cấp quyền')`);
      await page.send('Fetch.continueRequest',{requestId:held.requestId});await page.stopIntercepting();
      await new Promise(resolve=>setTimeout(resolve,800));
      expect(await page.evaluate<number>(`document.querySelectorAll('.business-request').length`)).toBe(0);
      expect(await page.evaluate<string>(`document.querySelector('.business-content').textContent`)).toBe('');
      expect(await page.evaluate<string>(`location.pathname`)).toBe('/business/finance');
    }finally{await page.close();}
  },180000);

});
