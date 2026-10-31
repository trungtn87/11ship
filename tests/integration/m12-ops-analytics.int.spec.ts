import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { OpsAnalyticsService } from '../../apps/backend/src/ops-analytics/ops-analytics-service';
import { OpsAnomalyService } from '../../apps/backend/src/ops-analytics/ops-anomaly-service';
import { AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { ApiResponse, AuthApp, createActiveShopFor, dataOf, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, Customer, Dish, Json, newCustomer, newDish, openAllWeek, PRIVACY, TERMS } from './support/m10-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, permission, postAs, purgeDeliveriesOfShops, purgeGrants, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';

// Issues #241 / #242 on a REAL PostgreSQL: the operations analytics (four questions, Vietnam days, denominators, "chưa đủ dữ liệu" is null and never 0, the supply count
// every 15 minutes, drill-downs without personal data) and the anomaly SIGNALS (one case per rule and subject, no duplicate on a second run, system / shop / search outcomes
// are never blamed on the person, evidence kept, read / manage rights apart, SYSTEM settings with a version, and NOTHING ever changes an account, an order or a wallet).

const tag = randomBytes(3).toString('hex').toUpperCase();
const vietnamDay = (ms: number): string => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);

describe('issues #241/#242 — operations analytics and anomaly signals', () => {
  let app: AuthApp;
  let admin: AdminApp;
  let router: http.Server;
  let system: SystemSession;
  let shop: ShopOwner;
  let pho: Dish;
  let reader: ActivatedAdmin;
  let shopOnly: ActivatedAdmin;
  let manager: ActivatedAdmin;
  let none: ActivatedAdmin;
  let addedPolicy = false;
  const seededShops: string[] = [];
  const customers: Customer[] = [];

  const get = (who: ActivatedAdmin | undefined, path: string): Promise<AdminResponse> => getAs(admin, who?.login, path);
  const body = (response: AdminResponse): Json => adminData(response) as Json;
  const range = (): string => {
    const today = vietnamDay(Date.now());
    return `range=custom&from=${today}&to=${today}`;
  };

  const api = (token: string, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(payload === undefined ? {} : { body: payload }) });
  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 200)]).toEqual([status, response.text.slice(0, 200)]);
    return dataOf(response) as Json;
  };
  /** A customer sends an Order and (optionally) cancels it before the shop confirms, the way the app does. */
  async function placeOrder(c: Customer): Promise<Json> {
    const lines = [{ item_id: pho.itemId, quantity: 1, unit_price_vnd: pho.price }];
    const draft = { shop_id: shop.shopId, lines, recipient_name: 'Người nhận', recipient_phone: '0912345678', address: { address_text: '12 Phố Huế, Hà Nội', lat: 21.0, lng: 105.82 } };
    const preview = ok(await api(c.token, 'POST', '/customers/me/orders/preview', { ...draft, lines: lines.map(({ item_id, quantity }) => ({ item_id, quantity })) }));
    const fee = preview.fee as Json;
    return ok(await api(c.token, 'POST', '/customers/me/orders', { client_ref: randomUUID(), ...draft, items_total_vnd: pho.price, expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot } }), 201);
  }
  const cancelByCustomer = async (c: Customer, order: Json): Promise<void> => {
    ok(await api(c.token, 'POST', `/customers/me/orders/${String(order.order_id)}/cancel`, { expected_version: order.version }));
  };

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] });
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    pho = await newDish(app, shop.token, 'Phở phân tích', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    reader = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Phân tích đủ app ${tag}`);
    shopOnly = await activatedAdmin(admin, system, [permission('SHOP')], `Phân tích quán ${tag}`);
    manager = await activatedAdmin(admin, system, [{ ...permission('SHOP'), can_manage_shops: true }, permission('DRIVER', { view: true, review: true })], `Phân tích quản lý ${tag}`);
    none = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Phân tích không quyền ${tag}`);
    for (const who of [reader, shopOnly, manager]) {
      expect((await changeGrant(admin, system, 'grant', who.userId, 'report.read', 0)).status).toBe(200);
    }
  }, 300_000);

  afterAll(async () => {
    try {
      await admin.pool.query('DELETE FROM app.ops_online_snapshots');
      const client = await admin.pool.connect();
      try {
        await client.query('DELETE FROM app.ops_anomaly_case_events');
        await client.query('DELETE FROM app.ops_anomaly_cases');
      } finally {
        client.release();
      }
      await admin.pool.query('UPDATE app.ops_anomaly_settings SET window_days = 7, min_samples = 5, rate_pct = 40, repeat_per_day = 3, version = 1');
      await purgeDeliveriesOfShops(admin.pool, seededShops);
      await purgeGrants(admin.pool);
      await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: customers.map((c) => c.userId), drivers: [], userIds: [...customers.map((c) => c.userId), shop.userId], policyAdded: addedPolicy });
      await admin.pool.query('DELETE FROM app.shop_members WHERE shop_id = ANY($1::uuid[])', [seededShops]);
      await purgeShopDisplayCodes(admin.pool, seededShops);
      await admin.pool.query('DELETE FROM app.shops WHERE shop_id = ANY($1::uuid[])', [seededShops]);
    } finally {
      await app.close();
      await admin.close();
      await new Promise<void>((resolve) => router.close(() => resolve()));
    }
  });

  // ---- #241 ---------------------------------------------------------------------------------------------------------------------

  it('#241 rights: no session 401; no report.read 403; SHOP-only gets the shop block and FORBIDDEN delivery blocks (never the system total); SHOP+DRIVER and SYSTEM get all; bad input is 400', async () => {
    expect((await get(undefined, `/ops-analytics?${range()}`)).status).toBe(401);
    expect([(await get(none, `/ops-analytics?${range()}`)).status, adminErrorCode(await get(none, `/ops-analytics?${range()}`))]).toEqual([403, 'ADMIN_FORBIDDEN']);
    const shopData = body(await get(shopOnly, `/ops-analytics?${range()}`));
    expect(shopData.search_failures).toEqual({ status: 'FORBIDDEN' });
    expect(shopData.supply_demand).toEqual({ status: 'FORBIDDEN' });
    expect(shopData.cancellations).toEqual({ status: 'FORBIDDEN' });
    expect((shopData.shop_confirmation as Json).status).toBe('OK');
    for (const who of [reader, undefined]) {
      const data = body(await (who === undefined ? getAs(admin, systemLoginOf(system), `/ops-analytics?${range()}`) : get(who, `/ops-analytics?${range()}`)));
      for (const key of ['search_failures', 'shop_confirmation', 'supply_demand', 'cancellations']) expect((data[key] as Json).status).toBe('OK');
      expect(data.timezone).toBe('Asia/Ho_Chi_Minh');
    }
    for (const bad of ['range=century', 'range=custom', `range=7d&from=${vietnamDay(Date.now())}`, 'source=ALL2', 'x=1']) expect([bad, (await get(reader, `/ops-analytics?${bad}`)).status]).toEqual([bad, 400]);
  });

  it('#241 search failures: only closed requests are the denominator, a request still searching is counted apart, "no data" is null not 0 %, DIRECT has no shop-confirmation block, the drill-down lists codes without personal data', async () => {
    const shopId = await createActiveShopFor(admin.pool, system.account.userId);
    seededShops.push(shopId);
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'search_stopped', createdAtIso: now });
    await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'waiting_driver', createdAtIso: now });

    const all = body(await get(reader, `/ops-analytics?${range()}`));
    const search = all.search_failures as Json;
    expect(search).toMatchObject({ requests: 4, still_searching: 1, matched: 0 });
    expect(search.failed).toEqual({ numerator: 3, denominator: 3, pct: 100 });
    expect(search.low_sample).toBe(true);
    expect((search.causes as Json[])[0]).toMatchObject({ code: 'SEARCH_TIMEOUT', count: 3 });

    const orderOnly = body(await get(reader, `/ops-analytics?${range()}&source=ORDER`));
    expect((orderOnly.search_failures as Json).failed).toEqual({ numerator: 0, denominator: 0, pct: null });
    expect(((orderOnly.shop_confirmation as Json).slow as Json).pct).toBeNull();
    const direct = body(await get(reader, `/ops-analytics?${range()}&source=DIRECT`));
    expect((direct.shop_confirmation as Json).status).toBe('NOT_APPLICABLE');
    expect(((direct.cancellations as Json).order)).toBeNull();

    const page = body(await get(reader, `/ops-analytics/drilldown?${range()}&kind=search_failed&limit=2&offset=2`));
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect((page.items as Json[])).toHaveLength(1);
    expect(Object.keys((page.items as Json[])[0] as Json).sort()).toEqual(['at', 'code', 'detail', 'kind', 'shop_name', 'state']);
    expect((await get(shopOnly, `/ops-analytics/drilldown?${range()}&kind=search_failed`)).status).toBe(403);
    expect((await get(reader, `/ops-analytics/drilldown?${range()}&kind=cancelled_at_step`)).status).toBe(400);
  });

  it('#241 supply / demand: demand by Vietnam weekday and hour; supply is the 15-minute COUNT of Online Shippers (counts only), recorded once per slot, and "no supply data" is said, not filled with 0', async () => {
    const before = body(await get(reader, `/ops-analytics?${range()}`));
    const heat = before.supply_demand as Json;
    expect(heat.supply_available).toBe(false);
    const cell = (heat.cells as Json[])[0] as Json;
    expect(cell).toMatchObject({ requests: 4, not_matched: 3 });
    expect(cell.weekday).toBeGreaterThanOrEqual(1);
    expect(cell.weekday).toBeLessThanOrEqual(7);
    expect(cell.supply_avg_online).toBeNull();

    const analytics = admin.running.app.get(OpsAnalyticsService);
    const now = Date.now();
    expect(await analytics.recordOnlineSnapshot(now)).toBe(true);
    expect(await analytics.recordOnlineSnapshot(now + 1000)).toBe(false); // the same 15-minute slot
    const columns = await admin.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'ops_online_snapshots' ORDER BY column_name");
    expect(columns.rows.map((r) => r.column_name)).toEqual(['created_at', 'online_count', 'ready_count', 'slot_at']);
    const after = body(await get(reader, `/ops-analytics?${range()}`));
    expect((after.supply_demand as Json).supply_available).toBe(true);
  });

  // ---- #242 ---------------------------------------------------------------------------------------------------------------------

  it('#242 settings: the Owner defaults (7 days, 5 samples, 40 %, 3 a day) are readable; only SYSTEM changes them, with a reason and the version; a stale version or a bound violation is refused', async () => {
    const read = body(await get(reader, '/ops-anomalies'));
    expect(read.settings).toMatchObject({ window_days: 7, min_samples: 5, rate_pct: 40, repeat_per_day: 3, editable: false });
    const version = (read.settings as Json).version as number;
    const change = { window_days: 7, min_samples: 2, rate_pct: 40, repeat_per_day: 3, expected_version: version, reason: 'Thử trên dữ liệu pilot' };
    expect((await postAs(admin, manager.login, '/ops-anomalies/settings', change)).status).toBe(403);
    expect((await postAs(admin, systemLoginOf(system), '/ops-anomalies/settings', { ...change, min_samples: 1 })).status).toBe(400);
    expect((await postAs(admin, systemLoginOf(system), '/ops-anomalies/settings', { ...change, expected_version: version + 5 })).status).toBe(409);
    const saved = await postAs(admin, systemLoginOf(system), '/ops-anomalies/settings', change);
    expect(body(saved)).toMatchObject({ min_samples: 2, version: version + 1, editable: true });
    const audit = await admin.pool.query("SELECT metadata FROM app.audit_logs WHERE action = 'ops.anomaly.settings.v1' ORDER BY occurred_at DESC LIMIT 1");
    expect((audit.rows[0]?.metadata as Json).reason).toBe('Thử trên dữ liệu pilot');
  });

  it('#242 detection: a customer who cancels their own Orders gets ONE case with the evidence (stage and reason, UNKNOWN kept as UNKNOWN); a second run opens nothing; cancellations by the shop are not blamed; nothing about the account, the order or a wallet changes', async () => {
    const a = await newCustomer(app, 'Khách hay hủy');
    const b = await newCustomer(app, 'Khách hủy một lần');
    const c = await newCustomer(app, 'Khách bị quán từ chối');
    customers.push(a, b, c);
    for (let i = 0; i < 2; i += 1) await cancelByCustomer(a, await placeOrder(a));
    await cancelByCustomer(b, await placeOrder(b));
    const refused = await placeOrder(c);
    ok(await api(shop.token, 'POST', `/shop/me/orders/${String(refused.order_id)}/reject`, { expected_version: refused.version, reason: 'Hết món' }));
    const accountBefore = (await admin.pool.query('SELECT status, version::text FROM app.users WHERE user_id = ANY($1::uuid[]) ORDER BY user_id', [[a.userId, b.userId, c.userId]])).rows;
    const ordersBefore = (await admin.pool.query('SELECT order_id, status, version::text FROM app.orders WHERE customer_user_id = ANY($1::uuid[]) ORDER BY order_id', [[a.userId, b.userId, c.userId]])).rows;

    const anomalies = admin.running.app.get(OpsAnomalyService);
    const first = await anomalies.detect(Date.now());
    expect(first.opened).toBeGreaterThanOrEqual(1);
    const second = await anomalies.detect(Date.now());
    expect(second.opened).toBe(0);
    const cases = (await admin.pool.query<{ subject_id: string; occurrences: number; sample: number; status: string; evidence: Json[] }>("SELECT subject_id::text, occurrences, sample, status, evidence FROM app.ops_anomaly_cases WHERE rule_kind = 'CUSTOMER_ORDER_CANCELS' AND subject_id = ANY($1::uuid[])", [[a.userId, b.userId, c.userId]])).rows;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ subject_id: a.userId, occurrences: 2, sample: 2, status: 'NEW' });
    expect(cases[0]?.evidence).toHaveLength(2);
    expect(cases[0]?.evidence[0]).toMatchObject({ stage: 'BEFORE_SHOP_CONFIRM', reason: 'UNKNOWN' });
    // A flag is information: no account, order or wallet moved, and the person was told nothing.
    expect((await admin.pool.query('SELECT status, version::text FROM app.users WHERE user_id = ANY($1::uuid[]) ORDER BY user_id', [[a.userId, b.userId, c.userId]])).rows).toEqual(accountBefore);
    expect((await admin.pool.query('SELECT order_id, status, version::text FROM app.orders WHERE customer_user_id = ANY($1::uuid[]) ORDER BY order_id', [[a.userId, b.userId, c.userId]])).rows).toEqual(ordersBefore);
    expect((await admin.pool.query("SELECT 1 FROM app.notifications WHERE recipient_user_id = ANY($1::uuid[]) AND kind LIKE '%ANOMALY%'", [[a.userId, b.userId, c.userId]])).rowCount).toBe(0);
  });

  it('#242 reading and acting: read needs report.read and the apps of the rule; closing needs the right to manage those objects (not the view); notes and dismissals need a reason; every step is audited; a closed case is not re-opened by old facts', async () => {
    const list = body(await get(shopOnly, '/ops-anomalies?status=OPEN'));
    const item = (list.items as Json[]).find((i) => i.rule === 'CUSTOMER_ORDER_CANCELS') as Json;
    expect(item).toMatchObject({ status: 'NEW', can: [] });
    const id = String(item.case_id);
    const noApp = await activatedAdmin(admin, system, [permission('DRIVER')], `Chỉ shipper ${tag}`);
    expect((await changeGrant(admin, system, 'grant', noApp.userId, 'report.read', 0)).status).toBe(200);
    expect((await get(noApp, `/ops-anomalies/${id}`)).status).toBe(404); // outside the rules it may read: as if it did not exist
    expect(((body(await get(noApp, '/ops-anomalies')).items) as Json[]).some((i) => i.case_id === id)).toBe(false);
    expect((await get(none, '/ops-anomalies')).status).toBe(403); // no report.read at all
    expect(body(await get(shopOnly, `/ops-anomalies/${id}`)).evidence).toHaveLength(2);

    const act = (who: ActivatedAdmin, payload: Json) => postAs(admin, who.login, `/ops-anomalies/${id}/action`, payload);
    expect((await act(shopOnly, { action: 'review', expected_version: 1 })).status).toBe(403); // sees, may not close
    const managed = body(await get(manager, `/ops-anomalies/${id}`));
    expect(managed.can).toEqual(['review', 'check', 'dismiss', 'note']);
    expect((await act(manager, { action: 'dismiss', expected_version: 1 })).status).toBe(400); // a reason is required
    expect(body(await act(manager, { action: 'review', expected_version: 1 }))).toMatchObject({ status: 'REVIEWING', version: 2 });
    expect((await act(manager, { action: 'review', expected_version: 1 })).status).toBe(409); // stale
    const dismissed = body(await act(manager, { action: 'dismiss', expected_version: 2, note: 'Khách thử nghiệm, đã gọi hỏi' }));
    expect(dismissed).toMatchObject({ status: 'DISMISSED', note: 'Khách thử nghiệm, đã gọi hỏi' });
    expect((dismissed.history as Json[]).map((h) => [h.action, h.to])).toEqual([['review', 'REVIEWING'], ['dismiss', 'DISMISSED']]);
    expect((await admin.pool.query("SELECT 1 FROM app.audit_logs WHERE action = 'ops.anomaly.action.v1' AND resource_id = $1", [id])).rowCount).toBe(2);

    // The same old facts do not open a new case after a person looked at it.
    const anomalies = admin.running.app.get(OpsAnomalyService);
    expect((await anomalies.detect(Date.now())).opened).toBe(0);
    expect((await admin.pool.query("SELECT 1 FROM app.ops_anomaly_cases WHERE rule_kind = 'CUSTOMER_ORDER_CANCELS' AND status IN ('NEW', 'REVIEWING')")).rowCount).toBe(0);
    // It can be re-opened by a person, once.
    expect(body(await act(manager, { action: 'reopen', expected_version: 3 }))).toMatchObject({ status: 'REVIEWING' });
    expect((await act(manager, { action: 'reopen', expected_version: 4 })).status).toBe(409);
  });
});
