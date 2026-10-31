import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01 (11Food shop onboarding) — the shared client side: the shop wire of the auth adapter and the in-memory shop controller, with
// a CONTROLLED fetch and a CONTROLLED geolocation. The same wire against the real backend and PostgreSQL, through a real Chrome, is
// tests/integration/food-shop-onboarding-browser.int.spec.ts (CI).

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'shop-flow-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

const USER = '11111111-1111-4111-8111-111111111111';
const SHOP = '55555555-5555-4555-8555-555555555555';
const AREA_A = '66666666-6666-4666-8666-666666666661';
const AREA_B = '66666666-6666-4666-8666-666666666662';
const TOKEN = 'A'.repeat(43);
const expiresIn = (ms) => new Date(Date.now() + ms).toISOString();
const identity = (over = {}) => ({
  user_id: USER,
  phone_normalized: '+84987654321',
  available_roles: ['CUSTOMER'],
  active_role: 'CUSTOMER',
  profile: { full_name: 'Nguyễn Văn An', version: 1 },
  capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
  onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
  onboarding_required: false,
  role_selection_required: false,

  phone_verification_status: 'VERIFIED',
  ...over,
});
const signInBody = { data: { ...identity(), access_token: TOKEN, session: { expires_at: expiresIn(86_400_000) } } };
const meBody = (over = {}) => ({ data: { ...identity(over), session: { expires_at: expiresIn(86_400_000) } } });
const errorBody = (code) => ({ error: { code, message: 'RAW_SERVER_MESSAGE_MARKER', request_id: 'r-1', details: {} } });
const shopRow = (over = {}) => ({
  shop_id: SHOP,
  name: 'Quán A',
  contact_phone: '+84912345678',
  zalo: null,
  facebook: null,
  address_text: '1 Đường A',
  pickup_lat: null,
  pickup_lng: null,
  service_area_id: null,
  status: 'INCOMPLETE',
  accepting_orders: false,
  version: 1,
  ...over,
});
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/** A fetch whose answers come from `handler(call)`; an Error returned is a dropped connection. */
function stub(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { url: String(url), path: new URL(String(url)).pathname, method: init.method, headers, body: init.body };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { fetch: fn, calls };
}

/** Signed-in client + controller. `routes` answers the shop/context/me calls; login is built in. */
async function make(routes, geoResults = []) {
  const { createAuthClient } = await load('auth/client.js');
  const { createShopController } = await load('shop-flow.js');
  let counter = 0;
  const http = stub((call, index) => {
    if (call.path === '/v1/client-auth/login') {
      return reply(200, signInBody);
    }
    return routes(call, index);
  });
  const auth = createAuthClient({
    fetch: http.fetch,
    app: 'FOOD',
    baseUrl: 'https://app.test',
    newKey: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    deviceId: 'web-test-device-0001',
  });
  const geoCalls = [];
  const geo = {
    locate: async () => {
      geoCalls.push(1);
      return geoResults.shift() ?? { kind: 'failure', reason: 'UNAVAILABLE' };
    },
  };
  const shop = createShopController({ auth, geo });
  assert.equal((await auth.login({ phone: '0987654321', password: 'Correct-Horse-9' })).kind, 'ok');
  return { auth, shop, calls: http.calls, geoCalls };
}

const areasBody = { data: [{ service_area_id: AREA_A, name: 'Khu A' }, { service_area_id: AREA_B, name: 'Khu B' }] };
const fix = { lat: 10.762622, lng: 106.660172, accuracyMeters: 12.4, measuredAtMs: 1_760_000_000_000 };
const FIX_OK = { kind: 'ok', fix };

/** A tiny in-memory server for one shop: what the real backend does, as far as the client can tell. */
function fakeServer(initial = { shop: null, areas: areasBody }) {
  const state = { shop: initial.shop, areas: initial.areas, saves: [], completes: [], contexts: [] };
  const handler = (call) => {
    const bearer = call.headers.authorization;
    assert.equal(bearer, `Bearer ${TOKEN}`, `${call.method} ${call.path} carries the bearer`);
    switch (`${call.method} ${call.path}`) {
      case 'GET /v1/onboarding/shop/profile':
        return reply(200, { data: state.shop });
      case 'GET /v1/onboarding/shop/service-areas':
        return reply(200, state.areas);
      case 'PUT /v1/onboarding/shop/profile': {
        const body = JSON.parse(call.body);
        state.saves.push({ body, key: call.headers['idempotency-key'] });
        const created = state.shop === null;
        if (created && body.expected_version !== null) {
          return reply(409, errorBody('VERSION_CONFLICT'));
        }
        if (!created && body.expected_version !== state.shop.version) {
          return reply(409, errorBody('VERSION_CONFLICT'));
        }
        const version = created ? 1 : state.shop.version + 1;
        state.shop = shopRow({ name: body.name, contact_phone: `+84${body.contact_phone.slice(1)}`, address_text: body.address_text, zalo: body.zalo, facebook: body.facebook, pickup_lat: body.pickup_lat, pickup_lng: body.pickup_lng, service_area_id: body.service_area_id, version });
        return reply(created ? 201 : 200, { data: { shop_id: SHOP, status: 'INCOMPLETE', version, role_granted: false } });
      }
      case 'POST /v1/onboarding/shop/complete': {
        const body = JSON.parse(call.body);
        state.completes.push({ body, key: call.headers['idempotency-key'] });
        state.shop = { ...state.shop, status: 'ACTIVE', version: state.shop.version + 1 };
        return reply(200, { data: { shop_id: SHOP, status: 'ACTIVE', accepting_orders: false, role_granted: true, version: state.shop.version } });
      }
      case 'GET /v1/client-auth/me':
        return reply(200, meBody(state.shop?.status === 'ACTIVE' ? { available_roles: ['CUSTOMER', 'SHOP_OWNER'], onboarding: { shop: 'COMPLETED', driver: 'NOT_STARTED' } } : {}));
      case 'POST /v1/client-auth/context': {
        const body = JSON.parse(call.body);
        state.contexts.push(body.context);
        return reply(200, meBody({ available_roles: ['CUSTOMER', 'SHOP_OWNER'], active_role: body.context, onboarding: { shop: 'COMPLETED', driver: 'NOT_STARTED' } }));
      }
      default:
        throw new Error(`unexpected ${call.method} ${call.path}`);
    }
  };
  return { state, handler };
}

const FORM = { name: 'Quán A', phone: '0912345678', address: '1 Đường A' };
function fill(shop, form = FORM) {
  shop.setField('name', form.name);
  shop.setField('phone', form.phone);
  shop.setField('address', form.address);
}

// ---- the wire --------------------------------------------------------------------------------------------------------

describe('shop wire (auth adapter)', () => {
  it('reads the shop (none, or the row) and the ACTIVE areas, with the bearer and nothing else', async () => {
    const server = fakeServer({ shop: null, areas: areasBody });
    const { auth, calls } = await make(server.handler);
    const none = await auth.readShop();
    assert.deepEqual(none, { kind: 'ok', value: null });
    const areas = await auth.readServiceAreas();
    assert.equal(areas.kind, 'ok');
    assert.deepEqual(areas.value, [{ serviceAreaId: AREA_A, name: 'Khu A' }, { serviceAreaId: AREA_B, name: 'Khu B' }]);
    server.state.shop = shopRow({ pickup_lat: 10.5, pickup_lng: 106.5, service_area_id: AREA_A });
    const row = await auth.readShop();
    assert.equal(row.value.serviceAreaId, AREA_A);
    assert.equal(row.value.pickupLat, 10.5);
    const reads = calls.filter((call) => call.method === 'GET' && call.path.startsWith('/v1/onboarding'));
    assert.equal(reads.length, 3);
    for (const call of reads) {
      assert.equal(call.body, undefined);
      assert.equal(call.headers['idempotency-key'], undefined);
      assert.equal(new URL(call.url).search, '');
    }
  });

  it('an empty area list is a valid answer; a malformed one is BAD_RESPONSE', async () => {
    for (const [body, expected] of [
      [{ data: [] }, 'ok'],
      [{ data: [{ service_area_id: AREA_A }] }, 'BAD_RESPONSE'],
      [{ data: [{ service_area_id: AREA_A, name: 'A', status: 'ACTIVE' }] }, 'BAD_RESPONSE'],
      [{ data: [{ service_area_id: 'x', name: 'A' }] }, 'BAD_RESPONSE'],
      [{ data: [{ service_area_id: AREA_A, name: 'A' }, { service_area_id: AREA_A, name: 'B' }] }, 'BAD_RESPONSE'],
      [{ data: [], extra: 1 }, 'BAD_RESPONSE'],
    ]) {
      const { auth } = await make(() => reply(200, body));
      const answer = await auth.readServiceAreas();
      assert.equal(answer.kind === 'ok' ? 'ok' : answer.code, expected, JSON.stringify(body));
    }
  });

  it('saves with exact bytes (expected_version null = create) and accepts 201 and 200', async () => {
    const server = fakeServer();
    const { auth, calls } = await make(server.handler);
    const first = await auth.saveShop({ name: ' Quán A ', contactPhone: '0912345678', addressText: '1 Đường A', zalo: null, facebook: null, pickup: null, serviceAreaId: null, expectedVersion: null });
    assert.deepEqual(first, { kind: 'ok', value: { shopId: SHOP, version: 1 } });
    const put = calls.find((call) => call.method === 'PUT');
    assert.equal(put.body, JSON.stringify({ name: 'Quán A', contact_phone: '0912345678', address_text: '1 Đường A', zalo: null, facebook: null, pickup_lat: null, pickup_lng: null, service_area_id: null, expected_version: null }));
    assert.match(put.headers['idempotency-key'], /^00000000-0000-4000-8000-/);
    const second = await auth.saveShop({ name: 'Quán A', contactPhone: '0912345678', addressText: '1 Đường A', zalo: null, facebook: null, pickup: { lat: 10.5, lng: 106.5 }, serviceAreaId: AREA_A, expectedVersion: 1 });
    assert.deepEqual(second, { kind: 'ok', value: { shopId: SHOP, version: 2 } });
  });

  it('refuses a bad input before any request', async () => {
    const { auth, calls } = await make(() => {
      throw new Error('no request expected');
    });
    const ok = { name: 'Q', contactPhone: '0912345678', addressText: 'A', zalo: null, facebook: null, pickup: null, serviceAreaId: null, expectedVersion: null };
    const before = calls.length;
    assert.equal((await auth.saveShop({ ...ok, contactPhone: '123' })).code, 'INVALID_PHONE');
    for (const bad of [{ name: '  ' }, { addressText: '' }, { zalo: 'ftp://x' }, { pickup: { lat: 91, lng: 0 } }, { serviceAreaId: 'not-a-uuid' }, { expectedVersion: 0 }]) {
      assert.equal((await auth.saveShop({ ...ok, ...bad })).code, 'BAD_REQUEST', JSON.stringify(bad));
    }
    assert.equal((await auth.completeShop({ expectedVersion: 0 })).code, 'BAD_REQUEST');
    assert.equal(calls.length, before);
  });

  it('an unknown outcome keeps the key and the exact body; the same input replays them, another input starts a new intent', async () => {
    let attempt = 0;
    const { auth, calls } = await make((call) => {
      attempt += 1;
      return attempt === 1 ? new Error('connection dropped') : attempt === 2 ? reply(503, errorBody('SERVICE_UNAVAILABLE')) : reply(200, { data: { shop_id: SHOP, status: 'INCOMPLETE', version: 2, role_granted: false } });
    });
    const input = { name: 'Q', contactPhone: '0912345678', addressText: 'A', zalo: null, facebook: null, pickup: null, serviceAreaId: null, expectedVersion: 1 };
    const lost = await auth.saveShop(input);
    assert.deepEqual([lost.kind, lost.code, lost.unresolved], ['failure', 'OFFLINE', true]);
    const busy = await auth.saveShop(input);
    assert.deepEqual([busy.code, busy.unresolved], ['SERVICE_UNAVAILABLE', true]);
    const done = await auth.saveShop(input);
    assert.equal(done.kind, 'ok');
    const puts = calls.filter((call) => call.method === 'PUT');
    assert.equal(puts.length, 3);
    assert.equal(new Set(puts.map((call) => call.headers['idempotency-key'])).size, 1, 'one intent, one key');
    assert.equal(new Set(puts.map((call) => call.body)).size, 1, 'the same bytes');
    attempt = 0;
    await auth.saveShop({ ...input, name: 'Khác' });
    const last = calls.filter((call) => call.method === 'PUT').at(-1);
    assert.notEqual(last.headers['idempotency-key'], puts[0].headers['idempotency-key'], 'another input is another intent');
  });

  it('maps the server codes of save and complete to their own typed failures (never the server text)', async () => {
    const cases = [
      ['PUT', 409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'],
      ['PUT', 409, 'SHOP_ONBOARDING_EXISTS', 'SHOP_EXISTS'],
      ['PUT', 400, 'INVALID_SERVICE_AREA', 'AREA_INVALID'],
      ['PUT', 400, 'INVALID_PHONE', 'INVALID_PHONE'],
      ['POST', 409, 'SHOP_PROFILE_INCOMPLETE', 'SHOP_INCOMPLETE'],
      ['POST', 409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'],
      ['POST', 409, 'SHOP_ONBOARDING_EXISTS', 'SHOP_EXISTS'],
      ['POST', 400, 'INVALID_SERVICE_AREA', 'AREA_INVALID'],
    ];
    for (const [method, status, serverCode, code] of cases) {
      const { auth } = await make(() => reply(status, errorBody(serverCode)));
      const answer = method === 'PUT' ? await auth.saveShop({ name: 'Q', contactPhone: '0912345678', addressText: 'A', zalo: null, facebook: null, pickup: null, serviceAreaId: null, expectedVersion: null }) : await auth.completeShop({ expectedVersion: 1 });
      assert.deepEqual([answer.kind, answer.code, answer.unresolved], ['failure', code, false], `${method} ${serverCode}`);
      assert.doesNotMatch(JSON.stringify(answer), /RAW_SERVER_MESSAGE_MARKER/);
    }
  });

  it('completes with exactly {expected_version} and only an exact ACTIVE / role_granted answer is accepted', async () => {
    const good = { data: { shop_id: SHOP, status: 'ACTIVE', accepting_orders: false, role_granted: true, version: 3 } };
    const { auth, calls } = await make(() => reply(200, good));
    assert.deepEqual(await auth.completeShop({ expectedVersion: 2 }), { kind: 'ok', value: { shopId: SHOP, version: 3 } });
    assert.equal(calls.find((call) => call.method === 'POST' && call.path.endsWith('/complete')).body, '{"expected_version":2}');
    for (const bad of [{ ...good.data, accepting_orders: true }, { ...good.data, role_granted: false }, { ...good.data, status: 'INCOMPLETE' }, { ...good.data, extra: 1 }]) {
      const other = await make(() => reply(200, { data: bad }));
      assert.equal((await other.auth.completeShop({ expectedVersion: 2 })).code, 'BAD_RESPONSE');
    }
  });

  it('a session the server calls invalid ends the session', async () => {
    const { auth } = await make(() => reply(401, errorBody('SESSION_REVOKED')));
    const answer = await auth.readShop();
    assert.deepEqual([answer.kind, answer.code], ['failure', 'SESSION_EXPIRED']);
    assert.equal(auth.session.state().kind, 'anonymous');
  });
});

// ---- the controller --------------------------------------------------------------------------------------------------

describe('shop controller', () => {
  it('saves a draft WITHOUT a position, reads it back, then saves with a position + ACTIVE area, then completes and switches context', async () => {
    const server = fakeServer();
    const { shop, auth, geoCalls } = await make(server.handler, [FIX_OK]);
    assert.equal((await shop.load()).kind, 'ok');
    assert.equal(shop.state().shop, null);
    assert.equal(shop.completeBlocker(), 'Lưu hồ sơ trước, rồi mới hoàn tất được.');
    fill(shop);
    assert.equal(shop.dirty(), true);
    assert.equal((await shop.save()).kind, 'ok');
    assert.deepEqual([server.state.saves[0].body.pickup_lat, server.state.saves[0].body.service_area_id, server.state.saves[0].body.expected_version], [null, null, null], 'no GPS, no area, create');
    assert.equal(shop.dirty(), false);
    assert.match(shop.completeBlocker(), /vị trí/);
    assert.equal(geoCalls.length, 0, 'the position was never asked without a press');

    // Read the draft again from the server (a new visit).
    assert.equal((await shop.load({ force: true })).kind, 'ok');
    assert.equal(shop.state().form.name, 'Quán A');
    assert.equal(shop.state().form.phone, '+84912345678');

    // Position: a measurement is a candidate until it is confirmed.
    assert.equal((await shop.locate()).kind, 'ok');
    assert.equal(geoCalls.length, 1);
    assert.equal(shop.state().pickup, undefined);
    assert.equal(shop.confirmCandidate(), true);
    assert.equal(shop.state().candidate, undefined);
    assert.equal(shop.state().pickup.accuracyMeters, 12.4);
    assert.match(shop.completeBlocker(), /chưa lưu/);
    shop.chooseArea(AREA_A);
    assert.equal((await shop.save()).kind, 'ok');
    assert.deepEqual([server.state.saves[1].body.pickup_lat, server.state.saves[1].body.pickup_lng, server.state.saves[1].body.service_area_id, server.state.saves[1].body.expected_version], [fix.lat, fix.lng, AREA_A, 1]);
    assert.equal(shop.completeBlocker(), undefined);

    const done = await shop.complete();
    assert.deepEqual(done, { kind: 'ok', identityRefreshed: true });
    assert.deepEqual(server.state.completes[0].body, { expected_version: 2 });
    assert.equal(shop.state().shop.status, 'ACTIVE');
    assert.equal(shop.editable(), false);
    assert.deepEqual(auth.session.identity().availableRoles, ['CUSTOMER', 'SHOP_OWNER']);
    assert.equal(auth.session.identity().activeRole, 'CUSTOMER', 'completion selects no context');

    assert.equal((await shop.selectContext('SHOP_OWNER')).kind, 'ok');
    assert.equal(auth.session.identity().activeRole, 'SHOP_OWNER');
    assert.equal((await shop.selectContext('CUSTOMER')).kind, 'ok');
    assert.equal(auth.session.identity().activeRole, 'CUSTOMER');
    assert.deepEqual(server.state.contexts, ['SHOP_OWNER', 'CUSTOMER']);
  });

  it('keeps what was typed from F21 to F22 and back; a real exit drops it', async () => {
    const server = fakeServer();
    const { shop } = await make(server.handler);
    await shop.load();
    fill(shop);
    shop.chooseArea(AREA_B);
    // F21 -> F22 -> F21: the screens are redrawn, the controller keeps the data.
    shop.keepForFlow();
    assert.equal(shop.flowing(), true);
    shop.discardEdits();
    assert.equal(shop.state().form.name, 'Quán A', 'in-flow: the guard wipe keeps the draft');
    shop.arrive();
    assert.equal(shop.flowing(), false);
    assert.equal((await shop.load()).kind, 'ok');
    assert.deepEqual([shop.state().form.name, shop.state().form.phone, shop.state().form.address, shop.state().serviceAreaId], ['Quán A', '0912345678', '1 Đường A', AREA_B]);
    // A real exit: the unsaved edits go and the next visit reads the server again.
    shop.discardEdits();
    assert.equal(shop.state().form.name, '');
    assert.equal(shop.state().loaded, false);
  });

  it('a refused, unavailable or timed-out position produces NO position and never a sample one', async () => {
    const server = fakeServer();
    const { shop, geoCalls } = await make(server.handler, [{ kind: 'failure', reason: 'DENIED' }, { kind: 'failure', reason: 'TIMEOUT' }, { kind: 'failure', reason: 'UNSUPPORTED' }]);
    await shop.load();
    for (const reason of ['DENIED', 'TIMEOUT', 'UNSUPPORTED']) {
      assert.deepEqual(await shop.locate(), { kind: 'failure', reason });
      assert.equal(shop.state().candidate, undefined);
      assert.equal(shop.state().pickup, undefined);
      assert.equal(shop.confirmCandidate(), false);
    }
    assert.equal(geoCalls.length, 3);
    fill(shop);
    assert.equal((await shop.save()).kind, 'ok');
    assert.equal(server.state.saves[0].body.pickup_lat, null);
  });

  it('completion needs a saved draft with a position and an area that is still in the server list; an empty list says so', async () => {
    const server = fakeServer({ shop: shopRow({ pickup_lat: 10.5, pickup_lng: 106.5, service_area_id: AREA_A }), areas: { data: [] } });
    const { shop } = await make(server.handler);
    await shop.load();
    assert.match(shop.completeBlocker(), /không còn hoạt động/);
    server.state.shop = shopRow({ pickup_lat: 10.5, pickup_lng: 106.5, service_area_id: null });
    await shop.load({ force: true });
    assert.match(shop.completeBlocker(), /Chưa có khu vực hoạt động/);
    assert.equal(shop.state().areas.length, 0);
    // The draft can still be saved with an empty list.
    shop.setField('address', '2 Đường B');
    assert.equal((await shop.save()).kind, 'ok');
    // A complete() that is blocked sends nothing.
    const before = server.state.completes.length;
    assert.equal((await shop.complete()).code, 'SHOP_INCOMPLETE');
    assert.equal(server.state.completes.length, before);
  });

  it('VERSION_CONFLICT overwrites nothing: loading shows what the server holds', async () => {
    const server = fakeServer({ shop: shopRow({ version: 1 }), areas: areasBody });
    const { shop } = await make(server.handler);
    await shop.load();
    server.state.shop = shopRow({ name: 'Đã đổi nơi khác', version: 2 });
    shop.setField('name', 'Tôi sửa');
    const step = await shop.save();
    assert.deepEqual([step.kind, step.code, step.unresolved], ['failure', 'VERSION_CONFLICT', false]);
    assert.equal(server.state.shop.name, 'Đã đổi nơi khác', 'the server row was not overwritten');
    assert.equal(shop.state().form.name, 'Tôi sửa', 'the typed text is still there until the person decides');
    await shop.load({ force: true });
    assert.equal(shop.state().form.name, 'Đã đổi nơi khác');
    assert.equal(shop.state().shop.version, 2);
  });

  it('an ACTIVE or DISABLED shop is read-only here: no save request is made', async () => {
    for (const status of ['ACTIVE', 'DISABLED']) {
      const server = fakeServer({ shop: shopRow({ status }), areas: areasBody });
      const { shop, calls } = await make(server.handler);
      await shop.load();
      assert.equal(shop.editable(), false);
      shop.setField('name', 'x');
      assert.equal(shop.state().form.name, 'Quán A', 'a read-only form takes no edit');
      assert.equal((await shop.save()).code, 'SHOP_EXISTS');
      assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
    }
  });

  it('an unknown outcome of complete is retried with the same key and body', async () => {
    const server = fakeServer({ shop: shopRow({ pickup_lat: 10.5, pickup_lng: 106.5, service_area_id: AREA_A }), areas: areasBody });
    let first = true;
    const { shop } = await make((call, index) => {
      if (call.path.endsWith('/complete') && first) {
        first = false;
        return new Error('connection dropped');
      }
      return server.handler(call, index);
    });
    await shop.load();
    const lost = await shop.complete();
    assert.deepEqual([lost.kind, lost.code, lost.unresolved], ['failure', 'OFFLINE', true]);
    assert.equal((await shop.complete()).kind, 'ok');
    assert.equal(server.state.completes.length, 1);
  });

  it('sign-out drops the draft, the areas and any answer still on its way', async () => {
    const server = fakeServer();
    const { shop, auth } = await make(server.handler);
    await shop.load();
    fill(shop);
    await auth.logout();
    assert.deepEqual([shop.state().loaded, shop.state().form.name, shop.state().areas.length], [false, '', 0]);
  });
});

describe('browser geolocation port', () => {
  it('answers the device position with its accuracy and time, and each refusal as its own reason', async () => {
    const { browserGeolocation } = await load('shop-flow.js');
    const fixOf = (coords, timestamp = 1_760_000_000_000) => ({ geolocation: { getCurrentPosition: (ok) => ok({ coords, timestamp }) } });
    assert.deepEqual(await browserGeolocation(fixOf({ latitude: 10.5, longitude: 106.5, accuracy: 20 })).locate(), { kind: 'ok', fix: { lat: 10.5, lng: 106.5, accuracyMeters: 20, measuredAtMs: 1_760_000_000_000 } });
    assert.equal((await browserGeolocation(fixOf({ latitude: 10.5, longitude: 106.5, accuracy: Number.NaN })).locate()).fix.accuracyMeters, null);
    assert.deepEqual(await browserGeolocation(fixOf({ latitude: 120, longitude: 106.5, accuracy: 1 })).locate(), { kind: 'failure', reason: 'UNAVAILABLE' });
    for (const [code, reason] of [[1, 'DENIED'], [2, 'UNAVAILABLE'], [3, 'TIMEOUT']]) {
      assert.deepEqual(await browserGeolocation({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ code }) } }).locate(), { kind: 'failure', reason });
    }
    assert.deepEqual(await browserGeolocation({}).locate(), { kind: 'failure', reason: 'UNSUPPORTED' });
    assert.deepEqual(await browserGeolocation({ geolocation: { getCurrentPosition: () => { throw new Error('x'); } } }).locate(), { kind: 'failure', reason: 'UNAVAILABLE' });
  });
});
