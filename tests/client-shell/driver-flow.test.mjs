import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01 (11Ship driver profile) — the shared client side: the driver wire of the auth adapter and the in-memory driver controller, with a
// CONTROLLED fetch. The same wire against the real backend and PostgreSQL, through a real Chrome, is
// tests/integration/ship-driver-profile-browser.int.spec.ts (CI).

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'driver-flow-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

const USER = '11111111-1111-4111-8111-111111111111';
const DRIVER = '77777777-7777-4777-8777-777777777777';
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
  ...over,
});
const signInBody = { data: { ...identity(), access_token: TOKEN, session: { expires_at: expiresIn(86_400_000) } } };
const meBody = (over = {}) => ({ data: { ...identity(over), session: { expires_at: expiresIn(86_400_000) } } });
const errorBody = (code) => ({ error: { code, message: 'RAW_SERVER_MESSAGE_MARKER', request_id: 'r-1', details: {} } });
const driverRow = (over = {}) => ({ driver_id: DRIVER, user_id: USER, full_name: 'Nguyễn Văn An', plate_number: null, status: 'PENDING', accepting_deliveries: false, version: 1, ...over });
const submitBody = { data: { driver_id: DRIVER, status: 'PENDING', accepting_deliveries: false, role_granted: true, version: 1 } };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function stub(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { path: new URL(String(url)).pathname, method: init.method, headers, body: init.body };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { fetch: fn, calls };
}

async function make(routes) {
  const { createAuthClient } = await load('auth/client.js');
  const { createDriverController } = await load('driver-flow.js');
  let counter = 0;
  const http = stub((call, index) => (call.path === '/v1/client-auth/login' ? reply(200, signInBody) : routes(call, index)));
  const auth = createAuthClient({ fetch: http.fetch, app: 'SHIP', baseUrl: 'https://app.test', newKey: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, deviceId: 'web-test-device-0001' });
  const driver = createDriverController({ auth });
  assert.equal((await auth.login({ phone: '0987654321', password: 'Correct-Horse-9' })).kind, 'ok');
  return { auth, driver, calls: http.calls };
}

/** A tiny in-memory server for one driver: what the real backend does, as far as the client can tell. */
function fakeServer(initial = null) {
  const state = { driver: initial, submits: [] };
  const handler = (call) => {
    assert.equal(call.headers.authorization, `Bearer ${TOKEN}`, `${call.method} ${call.path} carries the bearer`);
    switch (`${call.method} ${call.path}`) {
      case 'GET /v1/driver/me':
        return reply(200, { data: state.driver });
      case 'POST /v1/onboarding/driver': {
        const body = JSON.parse(call.body);
        state.submits.push({ body, key: call.headers['idempotency-key'] });
        if (state.driver !== null) {
          return reply(409, errorBody('DRIVER_PROFILE_EXISTS'));
        }
        state.driver = driverRow({ full_name: body.full_name, plate_number: body.plate_number });
        return reply(201, submitBody);
      }
      case 'GET /v1/client-auth/me':
        return reply(200, meBody(state.driver === null ? {} : { available_roles: ['CUSTOMER', 'DRIVER'], onboarding: { shop: 'NOT_STARTED', driver: 'PENDING_APPROVAL' }, capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: true } }));
      default:
        throw new Error(`unexpected ${call.method} ${call.path}`);
    }
  };
  return { state, handler };
}

describe('driver wire contract', () => {
  it('reads exactly {data:null} or the 8 fields, and refuses anything else as BAD_RESPONSE', async () => {
    const { parseDriverProfileResponse, parseDriverSubmitResponse } = await load('auth/contract.js');
    assert.equal(parseDriverProfileResponse({ data: null }), null);
    assert.deepEqual(parseDriverProfileResponse({ data: driverRow({ plate_number: '59A-123.45' }) }), { driverId: DRIVER, userId: USER, fullName: 'Nguyễn Văn An', plateNumber: '59A-123.45', status: 'PENDING', acceptingDeliveries: false, version: 1 });
    for (const status of ['ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']) {
      assert.equal(parseDriverProfileResponse({ data: driverRow({ status }) }).status, status, 'the stored enum passes through');
    }
    for (const bad of [{ data: { ...driverRow(), status: 'APPROVED' } }, { data: driverRow({ driver_id: 'x' }) }, { data: driverRow({ full_name: '' }) }, { data: driverRow({ version: 0 }) }, { data: [] }, {}]) {
      assert.equal(parseDriverProfileResponse(bad), undefined);
    }
    assert.deepEqual(parseDriverSubmitResponse(submitBody), { driverId: DRIVER });
    for (const bad of [{ data: { ...submitBody.data, status: 'ACTIVE' } }, { data: { ...submitBody.data, accepting_deliveries: true } }, { data: { ...submitBody.data, role_granted: false } }, { data: { ...submitBody.data, version: 2 } }, { data: { ...submitBody.data, driver_type: 'PLATFORM' } }, { data: { ...submitBody.data, extra: 1 } }]) {
      assert.equal(parseDriverSubmitResponse(bad), undefined);
    }
  });

  it('maps DRIVER_PROFILE_EXISTS to its own failure and keeps an unknown outcome unresolved', async () => {
    const { mapHttpFailure } = await load('auth/contract.js');
    assert.deepEqual(mapHttpFailure('driverSubmit', 409, 'DRIVER_PROFILE_EXISTS'), { code: 'DRIVER_EXISTS', unresolved: false, sessionInvalid: false });
    assert.equal(mapHttpFailure('driverSubmit', 500, 'INTERNAL_ERROR').unresolved, true);
    assert.equal(mapHttpFailure('driverSubmit', 503, undefined).unresolved, true);
    assert.equal(mapHttpFailure('driverSubmit', 401, 'SESSION_REVOKED').sessionInvalid, true);
    assert.equal(mapHttpFailure('driverRead', 401, 'SESSION_EXPIRED').sessionInvalid, true);
    assert.equal(mapHttpFailure('driverRead', 500, 'INTERNAL_ERROR').unresolved, false, 'a read is never keyed');
  });
});

describe('driver controller', () => {
  it('submit -> me -> driver/me: the profile S13 shows is what the server holds, CUSTOMER stays, no context is selected', async () => {
    const server = fakeServer();
    const { auth, driver, calls } = await make(server.handler);
    assert.equal((await driver.load()).kind, 'ok');
    assert.deepEqual(driver.state(), { loaded: true, profile: null });
    const step = await driver.submit({ fullName: '  Nguyễn  Văn An ', plateNumber: '' });
    assert.deepEqual(step, { kind: 'ok', identityRefreshed: true, profileRead: true });
    assert.deepEqual(calls.slice(1).map((c) => `${c.method} ${c.path}`), ['GET /v1/driver/me', 'POST /v1/onboarding/driver', 'GET /v1/client-auth/me', 'GET /v1/driver/me']);
    assert.deepEqual(server.state.submits[0].body, { full_name: 'Nguyễn Văn An', plate_number: null }, 'trimmed, empty plate = null, nothing else is sent');
    assert.match(server.state.submits[0].key, /^[0-9a-f-]{36}$/);
    assert.equal(driver.state().profile.status, 'PENDING');
    assert.equal(driver.state().profile.driverType, undefined, 'the internal classification is never read');
    assert.equal(driver.state().profile.acceptingDeliveries, false);
    const me = auth.session.identity();
    assert.deepEqual(me.availableRoles, ['CUSTOMER', 'DRIVER']);
    assert.equal(me.activeRole, 'CUSTOMER', 'the active context did not move');
    assert.equal(calls.some((c) => c.path === '/v1/client-auth/context'), false);
  });

  it('an unknown outcome keeps the key and the body: the next press re-sends the SAME request, nothing retries on its own', async () => {
    const server = fakeServer();
    let first = true;
    const { driver, calls } = await make((call) => {
      if (call.method === 'POST' && call.path === '/v1/onboarding/driver' && first) {
        first = false;
        server.state.driver = driverRow(); // the server did it, the answer was lost
        server.state.submits.push({ body: JSON.parse(call.body), key: call.headers['idempotency-key'] });
        return new Error('connection dropped');
      }
      return server.handler(call);
    });
    const a = await driver.submit({ fullName: 'Nguyễn Văn An', plateNumber: null });
    assert.equal(a.kind, 'failure');
    assert.equal(a.unresolved, true);
    assert.equal(a.code, 'OFFLINE');
    assert.equal(calls.filter((c) => c.path === '/v1/onboarding/driver').length, 1, 'no automatic retry');
    // The retry reaches the server with the same key and body (the real backend replays the stored 201).
    server.state.driver = null;
    const b = await driver.submit({ fullName: 'Nguyễn Văn An', plateNumber: null });
    assert.equal(b.kind, 'ok');
    const posts = calls.filter((c) => c.path === '/v1/onboarding/driver');
    assert.equal(posts.length, 2);
    assert.equal(posts[1].headers['idempotency-key'], posts[0].headers['idempotency-key']);
    assert.equal(posts[1].body, posts[0].body);
  });

  it('DRIVER_PROFILE_EXISTS reads the own profile instead of creating again; a loaded profile is never submitted over', async () => {
    const server = fakeServer(driverRow({ status: 'ACTIVE', plate_number: '59A-123.45' }));
    const { driver, calls } = await make(server.handler);
    const step = await driver.submit({ fullName: 'Người Khác', plateNumber: null });
    assert.equal(step.kind, 'failure');
    assert.equal(step.code, 'DRIVER_EXISTS');
    assert.equal(driver.state().profile.status, 'ACTIVE', 'the existing profile was read');
    assert.equal(driver.state().profile.fullName, 'Nguyễn Văn An', 'the existing profile is untouched');
    const postsBefore = calls.filter((c) => c.path === '/v1/onboarding/driver').length;
    const again = await driver.submit({ fullName: 'Lại Nữa', plateNumber: null });
    assert.equal(again.code, 'DRIVER_EXISTS');
    assert.equal(calls.filter((c) => c.path === '/v1/onboarding/driver').length, postsBefore, 'a known profile is not sent over again');
  });

  it('refuses an invalid name or plate without a request, and never shows the server message', async () => {
    const server = fakeServer();
    const { driver, calls } = await make((call) => (call.method === 'GET' && call.path === '/v1/driver/me' ? reply(500, errorBody('INTERNAL_ERROR')) : server.handler(call)));
    for (const input of [{ fullName: '   ', plateNumber: null }, { fullName: 'x'.repeat(121), plateNumber: null }, { fullName: 'An', plateNumber: 'y'.repeat(33) }, { fullName: 'A​n', plateNumber: null }]) {
      const step = await driver.submit(input);
      assert.deepEqual([step.kind, step.code], ['failure', 'BAD_REQUEST']);
    }
    assert.equal(calls.filter((c) => c.path === '/v1/onboarding/driver').length, 0);
    const read = await driver.load();
    assert.equal(read.kind, 'failure');
    assert.equal(read.code, 'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(read), /RAW_SERVER_MESSAGE_MARKER/);
  });

  it('a session the server calls invalid ends the session; another person or a reset drops the profile and late answers', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const server = fakeServer();
    const { auth, driver } = await make(async (call) => {
      if (call.method === 'POST' && call.path === '/v1/onboarding/driver') {
        await gate;
      }
      return server.handler(call);
    });
    await driver.load();
    const pending = driver.submit({ fullName: 'Nguyễn Văn An', plateNumber: null });
    driver.discard(); // the person left the screens
    release();
    assert.deepEqual(await pending, { kind: 'stale' }, 'the late answer is dropped');
    assert.deepEqual(driver.state(), { loaded: false, profile: null });
    // Signing out drops everything.
    await driver.load({ force: true });
    assert.equal(driver.state().loaded, true);
    await auth.logout();
    assert.deepEqual(driver.state(), { loaded: false, profile: null });
  });

  it('a revoked session on the read ends the session: the answer is dropped (app.ts shows the login screen)', async () => {
    const { auth, driver } = await make((call) => (call.path === '/v1/driver/me' ? reply(401, errorBody('SESSION_REVOKED')) : reply(500, errorBody('INTERNAL_ERROR'))));
    const step = await driver.load();
    assert.deepEqual(step, { kind: 'stale' });
    assert.equal(auth.session.state().kind, 'anonymous');
    assert.deepEqual(driver.state(), { loaded: false, profile: null });
  });
});

describe('account view of the driver state', () => {
  it('shows the stored state one to one and invents none', async () => {
    const { accountOf } = await load('app.js');
    const view = (driver) => accountOf({ userId: USER, phoneNormalized: '+84987654321', availableRoles: ['CUSTOMER'], activeRole: 'CUSTOMER', profile: { fullName: 'An', version: 1 }, capabilities: {}, onboarding: { shop: 'NOT_STARTED', driver } }).driver.status;
    assert.deepEqual(['NOT_STARTED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'].map(view), ['NONE', 'PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']);
  });
});
