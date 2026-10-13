import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01-RESET — the no-OTP test password reset controller (apps/client-shared/src/recovery-flow.ts) on top of the REAL adapter
// (createAuthClient) with a controlled fetch: the server's mode decides, the request is exactly {phone, password}, one intent keeps
// one key and one body across a lost answer, leaving drops it and makes a late answer stale, and nothing signs in.

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);
before(() => {
  out = mkdtempSync(join(tmpdir(), 'recovery-flow-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

const PASSWORD = '  Mật khẩu mới có dấu cách 123 ';
const PHONE = '0987654321';
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const errorBody = (code) => ({ error: { code, message: 'RAW_SERVER_TEXT_MARKER', request_id: 'r', details: {} } });
const ACK = { data: { next: 'LOGIN' } };
const isConfig = (call) => call.url.endsWith('/v1/account-recovery/config');
const isReset = (call) => call.url.endsWith('/v1/account-recovery/reset-test');
const KEYS = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

async function setup(handler) {
  const { createAuthClient } = await load('auth/client.js');
  const { createRecoveryController } = await load('recovery-flow.js');
  const calls = [];
  const fetchStub = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { url: String(url), method: init.method, headers, body: init.body, options: init };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  const auth = createAuthClient({ fetch: fetchStub, app: 'FOOD', newKey: KEYS(), deviceId: 'web-test-device' });
  return { auth, controller: createRecoveryController({ auth }), calls };
}

const on = (call) => (isConfig(call) ? reply(200, { data: { mode: 'DISABLED_TEST' } }) : reply(200, ACK));

describe('recovery flow: the server decides', () => {
  it('sends nothing until a valid DISABLED_TEST answer; UNAVAILABLE, a bad shape and a failed read keep it closed', async () => {
    for (const answer of [() => reply(200, { data: { mode: 'UNAVAILABLE' } }), () => reply(200, { data: { mode: 'ON' } }), () => reply(200, { data: { mode: 'DISABLED_TEST', extra: 1 } }), () => reply(503, errorBody('SERVICE_UNAVAILABLE')), () => new Error('offline')]) {
      const { controller, calls } = await setup((call) => (isConfig(call) ? answer() : reply(200, ACK)));
      assert.equal(controller.mode(), undefined);
      const direct = await controller.reset({ phone: PHONE, password: PASSWORD });
      assert.equal(direct.kind, 'failure');
      await controller.loadMode();
      assert.notEqual(controller.mode(), 'DISABLED_TEST');
      const again = await controller.reset({ phone: PHONE, password: PASSWORD });
      assert.equal(again.kind, 'failure');
      assert.equal(calls.filter(isReset).length, 0, 'no reset request was sent');
    }
  });

  it('GET /v1/account-recovery/config is a plain same-origin GET without credentials, key or body', async () => {
    const { controller, calls } = await setup(on);
    const result = await controller.loadMode();
    assert.deepEqual(result, { kind: 'ok', value: 'DISABLED_TEST' });
    assert.equal(controller.mode(), 'DISABLED_TEST');
    const [call] = calls;
    assert.equal(call.method, 'GET');
    assert.equal(call.body, undefined);
    assert.equal(call.headers['idempotency-key'], undefined);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
  });
});

describe('recovery flow: the request', () => {
  it('is POST /v1/account-recovery/reset-test with exactly {phone, password}, a key, the password as typed, and signs nobody in', async () => {
    const { controller, auth, calls } = await setup(on);
    await controller.loadMode();
    const step = await controller.reset({ phone: ` ${PHONE} `, password: PASSWORD });
    assert.deepEqual(step, { kind: 'ok' });
    const call = calls.find(isReset);
    assert.equal(call.method, 'POST');
    assert.deepEqual(JSON.parse(call.body), { phone: PHONE, password: PASSWORD });
    assert.deepEqual(Object.keys(JSON.parse(call.body)), ['phone', 'password']);
    assert.match(call.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(auth.session.state().kind, 'anonymous', 'a reset never signs in');
  });

  it('refuses a bad phone or a short password locally without a request', async () => {
    const { controller, calls } = await setup(on);
    await controller.loadMode();
    assert.equal((await controller.reset({ phone: '09123', password: PASSWORD })).code, 'INVALID_PHONE');
    assert.equal((await controller.reset({ phone: PHONE, password: 'short' })).code, 'BAD_REQUEST');
    assert.equal(calls.filter(isReset).length, 0);
  });

  it('an answer that is not exactly {data:{next:"LOGIN"}} is BAD_RESPONSE, never success', async () => {
    for (const body of [{ data: { next: 'HOME' } }, { data: { next: 'LOGIN', user_id: 'x' } }, { data: {} }, {}]) {
      const { controller } = await setup((call) => (isConfig(call) ? reply(200, { data: { mode: 'DISABLED_TEST' } }) : reply(200, body)));
      await controller.loadMode();
      const step = await controller.reset({ phone: PHONE, password: PASSWORD });
      assert.equal(step.kind, 'failure');
    }
  });
});

describe('recovery flow: one intent, one key', () => {
  it('a lost answer keeps key and body: the same form again re-sends the SAME request; a changed password is a new intent', async () => {
    let attempt = 0;
    const { controller, calls } = await setup((call) => (isConfig(call) ? reply(200, { data: { mode: 'DISABLED_TEST' } }) : ++attempt === 1 ? new Error('connection reset') : reply(200, ACK)));
    await controller.loadMode();
    const first = await controller.reset({ phone: PHONE, password: PASSWORD });
    assert.equal(first.kind, 'failure');
    assert.equal(first.unresolved, true);
    const second = await controller.reset({ phone: PHONE, password: PASSWORD });
    assert.deepEqual(second, { kind: 'ok' });
    const sent = calls.filter(isReset);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].headers['idempotency-key'], sent[1].headers['idempotency-key']);
    assert.equal(sent[0].body, sent[1].body);
    // After a definite answer the intent ended: a new submit gets a new key.
    await controller.reset({ phone: PHONE, password: PASSWORD });
    const all = calls.filter(isReset);
    assert.notEqual(all[2].headers['idempotency-key'], all[1].headers['idempotency-key']);
  });

  it('a 503 closed mode is unresolved and shows the fixed copy, never the server text', async () => {
    const { controller } = await setup((call) => (isConfig(call) ? reply(200, { data: { mode: 'DISABLED_TEST' } }) : reply(503, errorBody('SERVICE_UNAVAILABLE'))));
    await controller.loadMode();
    const step = await controller.reset({ phone: PHONE, password: PASSWORD });
    assert.equal(step.kind, 'failure');
    assert.equal(step.code, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(step), /RAW_SERVER_TEXT_MARKER/);
  });

  it('leaving drops the kept intent and makes an answer on its way stale', async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const { controller, calls } = await setup(async (call) => {
      if (isConfig(call)) {
        return reply(200, { data: { mode: 'DISABLED_TEST' } });
      }
      await gate;
      return reply(200, ACK);
    });
    await controller.loadMode();
    const pending = controller.reset({ phone: PHONE, password: PASSWORD });
    controller.cancel();
    release();
    assert.deepEqual(await pending, { kind: 'stale' });
    // A later reset is a brand new intent with a new key.
    await controller.reset({ phone: PHONE, password: PASSWORD });
    const sent = calls.filter(isReset);
    assert.notEqual(sent[0].headers['idempotency-key'], sent[1].headers['idempotency-key']);
  });
});
