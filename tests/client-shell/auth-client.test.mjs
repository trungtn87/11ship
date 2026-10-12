import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01.06 — the shared client-auth adapter (apps/client-shared/src/auth) with a CONTROLLED fetch: only a stand-in can answer
// slowly, wrongly, twice or never on demand, which is what the race and lost-response cases need. The same adapter against
// the real backend and PostgreSQL is tests/integration/client-auth-adapter.int.spec.ts (CI).

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'client-auth-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

// ---- helpers --------------------------------------------------------------------------------------------------------

const USER = '11111111-1111-4111-8111-111111111111';
const VERIFICATION = '22222222-2222-4222-8222-222222222222';
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const SECRET_MESSAGE = 'RAW_SERVER_MESSAGE_MARKER postgres://user:pw@db/x';

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
const expiresIn = (ms) => new Date(Date.now() + ms).toISOString();
const signInBody = (token = TOKEN_A, over = {}) => ({ data: { ...identity(over), access_token: token, session: { expires_at: expiresIn(7 * 86_400_000) } } });
const meBody = (over = {}) => ({ data: { ...identity(over), session: { expires_at: expiresIn(7 * 86_400_000) } } });
const errorBody = (code, message = SECRET_MESSAGE) => ({ error: { code, message, request_id: 'r-1', details: {} } });

const reply = (status, body, headers = {}) =>
  status === 204
    ? new Response(null, { status, headers })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/** A fetch whose answers come from `handler(call, index)`; an Error thrown/returned there is a dropped connection. */
function stub(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { url: String(url), method: init.method, headers, body: init.body, signal: init.signal, options: init };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { fetch: fn, calls };
}

function fakeTimers() {
  const state = { t: Date.now(), next: 1, pending: new Map() };
  const timers = {
    set(callback, ms) {
      const id = state.next++;
      state.pending.set(id, { at: state.t + ms, callback });
      return id;
    },
    clear(id) {
      state.pending.delete(id);
    },
    now: () => state.t,
  };
  return {
    timers,
    advance(ms) {
      state.t += ms;
      for (const [id, entry] of [...state.pending]) {
        if (entry.at <= state.t) {
          state.pending.delete(id);
          entry.callback();
        }
      }
    },
  };
}

async function make(handler, options = {}) {
  const { createAuthClient } = await load('auth/client.js');
  const clock = fakeTimers();
  const http = stub(handler);
  let counter = 0;
  const client = createAuthClient({
    fetch: http.fetch,
    app: options.app ?? 'FOOD',
    baseUrl: options.baseUrl ?? 'https://app.test',
    timers: clock.timers,
    newKey: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    deviceId: 'web-test-device-0001',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { client, calls: http.calls, clock };
}

const LOGIN = { phone: '0987654321', password: 'Mật-khẩu 😀' };
const REGISTER = {
  phone: '0987654321',
  password: 'Correct-Horse-9',
  verificationToken: 'proof-token-value',
  fullName: 'Nguyễn Văn An',
  consent: { termsVersion: 'test-terms-v1', privacyVersion: 'test-privacy-v1' },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

// ---- request / response mapping --------------------------------------------------------------------------------------

describe('mapping to the backend contract', () => {
  it('REGISTER OTP request and verify: path, body, deadlines counted from the request start', async () => {
    const { client, calls, clock } = await make((call) =>
      call.url.endsWith('/verify')
        ? reply(200, { data: { verification_token: 'proof-token-value', purpose: 'REGISTER', expires_in_seconds: 600 } })
        : reply(201, { data: { verification_id: VERIFICATION, expires_in_seconds: 300, resend_after_seconds: 60 } }),
    );
    const start = clock.timers.now();
    const issued = await client.requestRegisterOtp({ phone: ' 0987654321 ' });
    assert.equal(issued.kind, 'ok');
    assert.deepEqual(issued.value, { verificationId: VERIFICATION, expiresAtMs: start + 300_000, resendAtMs: start + 60_000 });
    assert.equal(calls[0].url, 'https://app.test/v1/auth/phone-verifications');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), { phone: '0987654321', purpose: 'REGISTER' });
    assert.equal(calls[0].headers['idempotency-key'], undefined);

    const verified = await client.verifyRegisterOtp({ verificationId: VERIFICATION, code: '012345' });
    assert.equal(verified.kind, 'ok');
    assert.equal(verified.value.verificationToken, 'proof-token-value');
    assert.equal(calls[1].url, `https://app.test/v1/auth/phone-verifications/${VERIFICATION}/verify`);
    assert.equal(calls[1].body, '{"otp":"012345"}', 'the leading zero survives');
  });

  it('register sends exactly the six backend fields with device, consent and the Idempotency-Key header; login the three', async () => {
    const { client, calls } = await make((call) => (call.url.endsWith('/register') ? reply(201, signInBody()) : reply(200, signInBody(TOKEN_B))));
    const registered = await client.register(REGISTER);
    assert.equal(registered.kind, 'ok');
    assert.equal(registered.value.identity.userId, USER);
    assert.equal('accessToken' in registered.value, false, 'the token never reaches the screen');
    assert.ok(!JSON.stringify(registered).includes(TOKEN_A));
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(Object.keys(body), ['phone', 'password', 'verification_token', 'device', 'full_name', 'consent']);
    assert.deepEqual(body.device, { device_id: 'web-test-device-0001', platform: 'WEB', app: 'FOOD' });
    assert.deepEqual(body.consent, { terms_version: 'test-terms-v1', privacy_version: 'test-privacy-v1' });
    assert.match(calls[0].headers['idempotency-key'], /^[0-9a-f-]{36}$/);
    assert.equal(calls[0].url, 'https://app.test/v1/client-auth/register');

    await client.login(LOGIN);
    assert.deepEqual(Object.keys(JSON.parse(calls[1].body)), ['phone', 'password', 'device']);
    assert.equal(calls[1].url, 'https://app.test/v1/client-auth/login');
    assert.notEqual(calls[1].headers['idempotency-key'], calls[0].headers['idempotency-key']);
  });

  it('me, context and logout use the bearer in the header only; me sends no body, logout sends {}', async () => {
    const { client, calls } = await make((call) => {
      if (call.url.endsWith('/login')) return reply(200, signInBody());
      if (call.url.endsWith('/me')) return reply(200, meBody());
      if (call.url.endsWith('/context')) return reply(200, meBody({ active_role: 'CUSTOMER' }));
      return reply(204);
    });
    await client.login(LOGIN);
    assert.equal((await client.me()).kind, 'ok');
    assert.equal((await client.selectContext('CUSTOMER')).kind, 'ok');
    const [, me, context] = calls;
    assert.equal(me.method, 'GET');
    assert.equal(me.body, undefined);
    assert.equal(me.headers.authorization, `Bearer ${TOKEN_A}`);
    assert.equal(context.body, '{"context":"CUSTOMER"}');
    assert.ok(context.headers['idempotency-key']);
    const out = await client.logout();
    assert.deepEqual(out, { kind: 'ok', value: { hadSession: true, serverRevoked: true } });
    assert.equal(calls[3].body, '{}');
    assert.equal(calls[3].headers.authorization, `Bearer ${TOKEN_A}`);
    for (const call of calls) {
      assert.ok(!call.url.includes(TOKEN_A) && !call.url.includes('?'), call.url);
      assert.equal(call.options.credentials, 'omit');
      assert.equal(call.options.cache, 'no-store');
    }
  });

  it('no password, OTP, proof or token is ever put in a URL, and the adapter never touches browser storage', async () => {
    const stored = [];
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'document']) {
      Object.defineProperty(globalThis, name, { configurable: true, get: () => (stored.push(name), undefined) });
    }
    try {
      const { client, calls } = await make((call) =>
        call.url.endsWith('/verify')
          ? reply(200, { data: { verification_token: 'proof-token-value', purpose: 'REGISTER', expires_in_seconds: 600 } })
          : call.url.endsWith('/phone-verifications')
            ? reply(201, { data: { verification_id: VERIFICATION, expires_in_seconds: 300, resend_after_seconds: 60 } })
            : reply(200, signInBody()),
      );
      await client.requestRegisterOtp({ phone: '0987654321' });
      await client.verifyRegisterOtp({ verificationId: VERIFICATION, code: '654321' });
      await client.register(REGISTER);
      await client.login(LOGIN);
      for (const call of calls) {
        for (const secret of [REGISTER.password, LOGIN.password, '654321', 'proof-token-value', TOKEN_A, encodeURIComponent(LOGIN.password)]) {
          assert.ok(!call.url.includes(secret), `${secret} in ${call.url}`);
        }
      }
      assert.deepEqual(stored, [], 'browser storage was read or written');
    } finally {
      for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'document']) delete globalThis[name];
    }
  });

  it('a verification id that is not a UUID never reaches the URL; local input errors send nothing', async () => {
    const { client, calls } = await make(() => reply(200, {}));
    assert.equal((await client.verifyRegisterOtp({ verificationId: '../../client-auth/me', code: '123456' })).code, 'OTP_INVALID');
    assert.equal((await client.verifyRegisterOtp({ verificationId: VERIFICATION, code: '12345' })).code, 'OTP_INVALID');
    assert.equal((await client.requestRegisterOtp({ phone: '12345' })).code, 'INVALID_PHONE');
    assert.equal((await client.register({ ...REGISTER, password: 'short' })).code, 'BAD_REQUEST');
    assert.equal((await client.register({ ...REGISTER, fullName: 'a​b' })).code, 'BAD_REQUEST');
    assert.equal((await client.register({ ...REGISTER, consent: { termsVersion: 'bad version', privacyVersion: 'v' } })).code, 'BAD_REQUEST');
    assert.equal((await client.selectContext('ADMIN')).code, 'BAD_REQUEST');
    assert.equal(calls.length, 0);
  });

  it('password is sent byte for byte: Unicode, spaces at both ends, combining marks and ZWJ are not trimmed or normalized', async () => {
    const { client, calls } = await make((call) => (call.url.endsWith('/register') ? reply(201, signInBody()) : reply(200, signInBody())));
    const password = '  Pásswörd 👨‍👩‍👧  ';
    assert.notEqual(password.normalize('NFC'), password);
    await client.register({ ...REGISTER, password });
    await client.login({ phone: '0987654321', password });
    assert.equal(JSON.parse(calls[0].body).password, password);
    assert.equal(JSON.parse(calls[1].body).password, password);
    // The full name is the one field the contract normalizes (NFC, collapsed spaces).
    await client.register({ ...REGISTER, fullName: '  Nguyễn   Văn  An ' });
    assert.equal(JSON.parse(calls[2].body).full_name, 'Nguyễn Văn An');
  });

  it('the identity is parsed strictly: an extra field, a wrong type or a missing token is BAD_RESPONSE, never a half result', async () => {
    const bads = [
      { data: { ...identity(), access_token: TOKEN_A, session: { expires_at: expiresIn(1e6) }, extra: true } },
      { data: { ...identity({ available_roles: ['SHOP_OWNER', 'CUSTOMER'] }), access_token: TOKEN_A, session: { expires_at: expiresIn(1e6) } } },
      { data: { ...identity({ active_role: 'DRIVER' }), access_token: TOKEN_A, session: { expires_at: expiresIn(1e6) } } },
      { data: { ...identity(), session: { expires_at: expiresIn(1e6) } } },
      { data: { ...identity(), access_token: 'short', session: { expires_at: expiresIn(1e6) } } },
      { data: { ...identity(), access_token: TOKEN_A, session: { expires_at: 'not a date' } } },
      { ...signInBody(), extra: 1 },
      'not json object',
    ];
    for (const body of bads) {
      const { client } = await make(() => reply(200, body));
      const result = await client.login(LOGIN);
      assert.deepEqual([result.kind, result.code, result.unresolved], ['failure', 'BAD_RESPONSE', true], JSON.stringify(body).slice(0, 80));
      assert.equal(client.session.identity(), undefined);
    }
    // 200 where 201 is the contract, a non-JSON body and an oversized body are wrong answers too.
    for (const response of [reply(200, signInBody()), new Response('<html>', { status: 201, headers: { 'content-type': 'text/html' } }), new Response('x'.repeat(70_000), { status: 201, headers: { 'content-type': 'application/json' } })]) {
      const { client } = await make(() => response);
      assert.equal((await client.register(REGISTER)).code, 'BAD_RESPONSE');
    }
  });

  it('every server code maps to fixed copy: an unknown code and the raw message are never shown', async () => {
    const table = [
      ['otpRequest', 'PHONE_ALREADY_REGISTERED', 409, 'PHONE_ALREADY_REGISTERED'],
      ['otpRequest', 'AUTH_REGISTRATION_UNAVAILABLE', 503, 'REGISTRATION_UNAVAILABLE'],
      ['otpRequest', 'SERVICE_UNAVAILABLE', 503, 'PROVIDER_UNAVAILABLE'],
      ['otpVerify', 'OTP_INVALID', 400, 'OTP_INVALID'],
      ['otpVerify', 'OTP_EXPIRED', 400, 'OTP_EXPIRED'],
      ['otpVerify', 'OTP_ALREADY_USED', 409, 'OTP_ALREADY_USED'],
      ['otpVerify', 'OTP_RATE_LIMITED', 429, 'OTP_LOCKED'],
      ['register', 'VERIFICATION_PROOF_INVALID', 400, 'PROOF_INVALID'],
      ['register', 'VERIFICATION_PURPOSE_MISMATCH', 400, 'PROOF_INVALID'],
      ['register', 'VERIFICATION_PROOF_USED', 409, 'PROOF_USED'],
      ['register', 'CONSENT_VERSION_UNSUPPORTED', 409, 'CONSENT_UNSUPPORTED'],
      ['register', 'DEVICE_PROOF_REQUIRED', 403, 'DEVICE_PROOF_REQUIRED'],
      ['register', 'AUTH_RESULT_NOT_REPLAYABLE', 409, 'RESULT_NOT_REPLAYABLE'],
      ['register', 'IDEMPOTENCY_REPLAY_EXPIRED', 409, 'RESULT_NOT_REPLAYABLE'],
      ['login', 'INVALID_CREDENTIALS', 401, 'INVALID_CREDENTIALS'],
      ['login', 'ACCOUNT_DISABLED', 403, 'ACCOUNT_DISABLED'],
      ['login', 'TRANSACTION_OUTCOME_UNKNOWN', 503, 'OUTCOME_UNKNOWN'],
      ['login', 'THIS_CODE_DOES_NOT_EXIST', 400, 'UNKNOWN'],
      ['login', 'SESSION_EXPIRED', 401, 'UNKNOWN'],
      ['register', 'SESSION_INVALID', 401, 'UNKNOWN'],
      ['otpRequest', 'INVALID_CREDENTIALS', 401, 'UNKNOWN'],
    ];
    const { failureMessage } = await load('states.js');
    for (const [operation, code, status, expected] of table) {
      const { client } = await make(() => reply(status, errorBody(code)));
      await client.login(LOGIN).then(() => undefined);
      const run = {
        otpRequest: () => client.requestRegisterOtp({ phone: '0987654321' }),
        otpVerify: () => client.verifyRegisterOtp({ verificationId: VERIFICATION, code: '123456' }),
        register: () => client.register(REGISTER),
        login: () => client.login(LOGIN),
      }[operation];
      const result = await run();
      assert.equal(result.kind, 'failure', `${operation} ${code}`);
      assert.equal(result.code, expected, `${operation} ${code}`);
      const message = failureMessage(result.code, result.retryAfterSeconds);
      assert.ok(message.title.length > 0 && message.text.length > 0);
      assert.ok(!JSON.stringify([result, message]).includes('RAW_SERVER_MESSAGE_MARKER'), `${operation} ${code} leaked the server message`);
    }
  });

  it('429 carries Retry-After only when the server sent a usable one; otherwise there is no cooldown at all', async () => {
    const answers = [
      [{ 'retry-after': '37' }, 37],
      [{ 'retry-after': '0' }, undefined],
      [{ 'retry-after': '-5' }, undefined],
      [{ 'retry-after': 'soon' }, undefined],
      [{ 'retry-after': '99999999' }, undefined],
      [{}, undefined],
    ];
    for (const [headers, expected] of answers) {
      const { client } = await make(() => reply(429, errorBody('OTP_RATE_LIMITED'), headers));
      const result = await client.requestRegisterOtp({ phone: '0987654321' });
      assert.equal(result.code, 'RATE_LIMITED');
      assert.equal(result.retryAfterSeconds, expected, JSON.stringify(headers));
      assert.equal('retryAfterSeconds' in result, expected !== undefined);
    }
    const { parseRetryAfter } = await load('auth/contract.js');
    const now = Date.parse('2026-10-12T00:00:00Z');
    assert.equal(parseRetryAfter('Mon, 12 Oct 2026 00:01:30 GMT', now), 90);
    assert.equal(parseRetryAfter('Mon, 12 Oct 2026 00:00:00 GMT', now), undefined);
  });
});

// ---- double submit, lost response, idempotency -----------------------------------------------------------------------

describe('double submit and lost response', () => {
  it('a second identical call while one runs shares it (one request); another input answers IN_PROGRESS', async () => {
    const gate = deferred();
    const { client, calls } = await make(async () => (await gate.promise, reply(200, signInBody())));
    const first = client.login(LOGIN);
    const second = client.login(LOGIN);
    const other = await client.login({ ...LOGIN, password: 'another-password' });
    assert.equal(other.code, 'IN_PROGRESS');
    await tick();
    assert.equal(calls.length, 1);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.kind, 'ok');
    assert.equal(b, a);
    assert.equal(calls.length, 1);
  });

  it('a lost response keeps key AND bytes: the next call with the same input re-sends exactly the same request; nothing is retried by itself', async () => {
    for (const lost of [new TypeError('fetch failed'), 'timeout', reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')), reply(500, errorBody('INTERNAL_ERROR')), reply(409, errorBody('IDEMPOTENCY_BUSY'))]) {
      const { client, calls, clock } = await make((call, n) => (n === 1 ? (lost === 'timeout' ? new Promise(() => undefined) : lost) : reply(200, signInBody())), { timeoutMs: 15_000 });
      const first = client.login(LOGIN);
      if (lost === 'timeout') {
        await tick();
        clock.advance(15_000);
      }
      const unresolved = await first;
      assert.equal(unresolved.kind, 'failure');
      assert.equal(unresolved.unresolved, true, String(lost));
      clock.advance(10 * 60_000);
      await tick();
      assert.equal(calls.length, 1, 'no automatic retry');
      const second = await client.login(LOGIN);
      assert.equal(second.kind, 'ok');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].headers['idempotency-key'], calls[0].headers['idempotency-key'], 'same key');
      assert.equal(calls[1].body, calls[0].body, 'same bytes');
      // The attempt was answered: the next login is a new intent with a new key.
      await client.login(LOGIN);
      assert.notEqual(calls[2].headers['idempotency-key'], calls[0].headers['idempotency-key']);
    }
  });

  it('a different input after a lost response is a new intent; a definite answer ends the intent', async () => {
    const { client, calls } = await make((call, n) => (n === 1 ? new TypeError('fetch failed') : n === 2 ? reply(401, errorBody('INVALID_CREDENTIALS')) : reply(200, signInBody())));
    await client.login(LOGIN);
    const wrong = await client.login({ ...LOGIN, password: 'edited-password' });
    assert.deepEqual([wrong.code, wrong.unresolved], ['INVALID_CREDENTIALS', false]);
    assert.notEqual(calls[1].headers['idempotency-key'], calls[0].headers['idempotency-key']);
    await client.login({ ...LOGIN, password: 'edited-password' });
    assert.notEqual(calls[2].headers['idempotency-key'], calls[1].headers['idempotency-key'], 'after a definite failure the same input is a new intent');
  });

  it('register keeps key and body across a lost response (the proof is consumed server-side exactly once)', async () => {
    const { client, calls } = await make((call, n) => (n === 1 ? new TypeError('fetch failed') : reply(201, signInBody())));
    const first = await client.register(REGISTER);
    assert.deepEqual([first.code, first.unresolved], ['OFFLINE', true]);
    const second = await client.register(REGISTER);
    assert.equal(second.kind, 'ok');
    assert.equal(calls[1].headers['idempotency-key'], calls[0].headers['idempotency-key']);
    assert.equal(calls[1].body, calls[0].body);
  });

  it('wrong credentials with a session in place are not "session expired" and do not touch the session', async () => {
    const { client } = await make((call, n) => (n === 1 ? reply(200, signInBody()) : reply(401, errorBody('INVALID_CREDENTIALS'))));
    await client.login(LOGIN);
    const before = client.session.identity();
    const wrong = await client.login({ ...LOGIN, password: 'wrong-password' });
    assert.equal(wrong.code, 'INVALID_CREDENTIALS');
    assert.equal(client.session.identity(), before);
    // Even a 401 with a session code, answered to a LOGIN, is not an expired session.
    const { client: second } = await make((call, n) => (n === 1 ? reply(200, signInBody()) : reply(401, errorBody('SESSION_EXPIRED'))));
    await second.login(LOGIN);
    assert.equal((await second.login({ ...LOGIN, password: 'x-password' })).code, 'UNKNOWN');
    assert.notEqual(second.session.identity(), undefined);
  });

  it('REGISTER OTP flow: restarting the flow makes the answer on its way stale', async () => {
    const gate = deferred();
    const { client } = await make(async () => (await gate.promise, reply(201, { data: { verification_id: VERIFICATION, expires_in_seconds: 300, resend_after_seconds: 60 } })));
    const pending = client.requestRegisterOtp({ phone: '0987654321' });
    client.resetRegisterFlow();
    gate.resolve();
    assert.deepEqual(await pending, { kind: 'stale' });
  });
});

// ---- generation: stale responses -------------------------------------------------------------------------------------

describe('stale responses', () => {
  it('a sign-in answered after a logout does not bring the session back', async () => {
    const gate = deferred();
    const { client, calls } = await make(async (call) => (call.url.endsWith('/login') ? (await gate.promise, reply(200, signInBody())) : reply(204)));
    const pendingLogin = client.login(LOGIN);
    await tick();
    const out = await client.logout();
    assert.deepEqual(out.value, { hadSession: false, serverRevoked: false });
    gate.resolve();
    assert.deepEqual(await pendingLogin, { kind: 'stale' });
    assert.deepEqual(client.session.state(), { kind: 'anonymous' });
    const me = await client.me();
    assert.equal(me.code, 'SESSION_EXPIRED');
    assert.equal(calls.filter((c) => c.url.endsWith('/me')).length, 0, 'the dropped token was never used');
  });

  it('an old answer cannot replace the identity of a newer session, and an old "expired" cannot sign the new session out', async () => {
    const oldMe = deferred();
    const { client } = await make(async (call, n) => {
      if (call.url.endsWith('/login')) return reply(200, signInBody(n === 1 ? TOKEN_A : TOKEN_B, { profile: { full_name: n === 1 ? 'Người Cũ' : 'Người Mới', version: n } }));
      await oldMe.promise;
      return call.headers.authorization === `Bearer ${TOKEN_A}` ? reply(401, errorBody('SESSION_EXPIRED')) : reply(200, meBody());
    });
    await client.login(LOGIN);
    const pending = client.me();
    await tick();
    await client.login({ ...LOGIN, password: 'second-login-password' });
    assert.equal(client.session.identity().profile.fullName, 'Người Mới');
    oldMe.resolve();
    assert.deepEqual(await pending, { kind: 'stale' });
    assert.equal(client.session.identity().profile.fullName, 'Người Mới', 'identity of the new session kept');
    assert.equal(client.session.state().kind, 'authenticated', 'the new session was not cleared');
  });

  it('logout drops token and personal data first, cancels running authenticated calls and keeps nothing to retry with', async () => {
    const gate = deferred();
    const { client, calls } = await make(async (call, n) => {
      if (call.url.endsWith('/login')) return reply(200, signInBody());
      if (call.url.endsWith('/me')) return gate.promise.then(() => reply(200, meBody({ profile: { full_name: 'Stale Name', version: 9 } })));
      return new TypeError('offline');
    });
    await client.login(LOGIN);
    const pendingMe = client.me();
    await tick();
    const seen = [];
    client.session.subscribe((state) => seen.push(state.kind));
    const logout = client.logout();
    assert.deepEqual(client.session.state(), { kind: 'anonymous' }, 'local state is gone before the server answered');
    assert.equal(calls.find((c) => c.url.endsWith('/me')).signal.aborted, true, 'the running call was cancelled');
    gate.resolve();
    assert.deepEqual(await pendingMe, { kind: 'stale' });
    const result = await logout;
    assert.deepEqual(result.value, { hadSession: true, serverRevoked: false, unconfirmedReason: 'OFFLINE' });
    assert.deepEqual(client.session.state(), { kind: 'anonymous' });
    assert.ok(!seen.includes('authenticated'));
  });

  it('logout confirms the server ONLY on 204: offline, timeout, 401 and 5xx leave serverRevoked false with the reason', async () => {
    const cases = [
      [new TypeError('offline'), 'OFFLINE'],
      ['timeout', 'TIMEOUT'],
      [reply(401, errorBody('SESSION_INVALID')), 'SESSION_EXPIRED'],
      [reply(503, errorBody('SERVICE_UNAVAILABLE')), 'SERVICE_UNAVAILABLE'],
      [reply(500, errorBody('INTERNAL_ERROR')), 'UNKNOWN'],
      [reply(200, { data: {} }), 'UNKNOWN'],
    ];
    for (const [answer, reason] of cases) {
      const { client, calls, clock } = await make((call) => (call.url.endsWith('/login') ? reply(200, signInBody()) : answer === 'timeout' ? new Promise(() => undefined) : answer));
      await client.login(LOGIN);
      const pending = client.logout();
      if (answer === 'timeout') {
        await tick();
        clock.advance(15_000);
      }
      const result = await pending;
      assert.deepEqual(result.value, { hadSession: true, serverRevoked: false, unconfirmedReason: reason }, String(reason));
      assert.deepEqual(client.session.state(), { kind: 'anonymous' });
      assert.equal(calls.filter((c) => c.url.endsWith('/logout')).length, 1, 'logout is not retried');
    }
  });

  it('a session the server calls invalid is cleared; an expiry the server reported ends the bearer without a request', async () => {
    const { client, calls, clock } = await make((call) => (call.url.endsWith('/login') ? reply(200, { data: { ...signInBody().data, session: { expires_at: new Date(Date.now() + 60_000).toISOString() } } }) : reply(401, errorBody('SESSION_REVOKED'))));
    await client.login(LOGIN);
    const me = await client.me();
    assert.deepEqual([me.code, client.session.state().kind], ['SESSION_EXPIRED', 'anonymous']);
    await client.login(LOGIN);
    clock.advance(61_000);
    assert.equal(client.session.identity(), undefined);
    assert.equal((await client.me()).code, 'SESSION_EXPIRED');
    assert.equal(calls.filter((c) => c.url.endsWith('/me')).length, 1);
  });

  it('a context request lost in one session is not re-sent in another', async () => {
    const { client, calls } = await make((call, n) => (call.url.endsWith('/login') ? reply(200, signInBody()) : n === 2 ? new TypeError('offline') : reply(200, meBody())));
    await client.login(LOGIN);
    assert.equal((await client.selectContext('CUSTOMER')).unresolved, true);
    await client.logout();
    await client.login(LOGIN);
    await client.selectContext('CUSTOMER');
    assert.notEqual(calls.at(-1).headers['idempotency-key'], calls[1].headers['idempotency-key']);
  });
});

describe('transport', () => {
  it('every call has a finite time limit even when fetch ignores the signal', async () => {
    const { client, clock } = await make(() => new Promise(() => undefined), { timeoutMs: 5_000 });
    const pending = client.requestRegisterOtp({ phone: '0987654321' });
    await tick();
    clock.advance(4_999);
    let settled = false;
    pending.then(() => (settled = true));
    await tick();
    assert.equal(settled, false);
    clock.advance(1);
    const result = await pending;
    assert.deepEqual([result.code, result.unresolved], ['TIMEOUT', false]);
  });

  it('safe request options: no redirects followed, no credentials, no referrer', async () => {
    const { client, calls } = await make(() => reply(201, { data: { verification_id: VERIFICATION, expires_in_seconds: 300, resend_after_seconds: 60 } }));
    await client.requestRegisterOtp({ phone: '0987654321' });
    assert.deepEqual([calls[0].options.redirect, calls[0].options.credentials, calls[0].options.referrerPolicy, calls[0].options.cache], ['error', 'omit', 'no-referrer', 'no-store']);
  });
});
