import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMutationCoordinator } from '../../apps/web/src/core/mutation.js';
import { errorEnvelope, jsonResponse, makeClient } from './helpers.mjs';

function setup(handler) {
  const { api, session, calls } = makeClient(handler, { token: 't', timeoutMs: 30 });
  let n = 0;
  const mutations = createMutationCoordinator({ api, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  return { mutations, calls, session };
}
const spec = (body, userId = 'user-1') => ({ method: 'PUT', path: '/onboarding/shop/profile', body, userId });
const keyOf = (call) => call.init.headers['Idempotency-Key'];

test('double submit of the same body while in flight sends ONE request and returns the same promise', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { mutations, calls } = setup(async () => {
    await gate;
    return jsonResponse(201, { data: { shop_id: 's', status: 'INCOMPLETE', version: 1, role_granted: false } });
  });
  const first = mutations.submit('shop.save', spec({ name: 'A' }));
  const second = mutations.submit('shop.save', spec({ name: 'A' }));
  assert.equal(first, second);
  assert.equal(mutations.status('shop.save'), 'IN_FLIGHT');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.equal(a.ok && b.ok, true);
  assert.equal(mutations.status('shop.save'), 'NONE');
});

test('a different body while another is in flight is refused locally (editor is disabled anyway)', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { mutations, calls } = setup(async () => {
    await gate;
    return jsonResponse(200, { data: {} });
  });
  const first = mutations.submit('op', spec({ name: 'A' }));
  const refused = await mutations.submit('op', spec({ name: 'B' }));
  assert.deepEqual({ ok: refused.ok, code: refused.code }, { ok: false, code: 'BUSY' });
  release();
  await first;
  assert.equal(calls.length, 1);
});

test('lost response (network): retry reuses the SAME key and the SAME body', async () => {
  let attempt = 0;
  const { mutations, calls } = setup(async () => {
    attempt += 1;
    if (attempt === 1) throw new TypeError('connection reset'); // the server may have committed already
    return jsonResponse(200, { data: { replayed: true } });
  });
  const body = Object.freeze({ name: 'A', expected_version: 1 });
  const first = await mutations.submit('op', spec(body));
  assert.equal(first.kind, 'network');
  assert.equal(mutations.hasUnknown('op'), true);
  const second = await mutations.submit('op', spec({ expected_version: 1, name: 'A' })); // same logical body, other key order
  assert.equal(second.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(keyOf(calls[0]), keyOf(calls[1]));
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(mutations.status('op'), 'NONE');
});

test('outcome unknown for timeout, 5xx, TRANSACTION_OUTCOME_UNKNOWN, IDEMPOTENCY_BUSY and an unreadable 2xx', async () => {
  const responders = {
    timeout: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); // the client timeout fires
      }),
    http500: async () => errorEnvelope(500, 'INTERNAL_ERROR'),
    http503: async () => errorEnvelope(503, 'TRANSACTION_OUTCOME_UNKNOWN'),
    busy: async () => errorEnvelope(409, 'IDEMPOTENCY_BUSY'),
    htmlOn200: async () => jsonResponse(200, '<html>gateway</html>'),
  };
  for (const [name, responder] of Object.entries(responders)) {
    const { mutations } = setup(responder);
    await mutations.submit('op', spec({ a: 1 }));
    assert.equal(mutations.hasUnknown('op'), true, name);
  }
});

test('while UNKNOWN, a different body is refused until the caller reconciles and discards', async () => {
  const { mutations, calls } = setup(async () => {
    throw new TypeError('offline');
  });
  await mutations.submit('op', spec({ name: 'A' }));
  const refused = await mutations.submit('op', spec({ name: 'B' }));
  assert.equal(refused.code, 'UNKNOWN_BODY_CHANGED');
  assert.equal(calls.length, 1); // nothing was sent for the edited body
  mutations.discard('op');
  const fresh = await mutations.submit('op', spec({ name: 'B' }));
  assert.equal(fresh.kind, 'network');
  assert.notEqual(keyOf(calls[0]), keyOf(calls[1])); // a new logical attempt has a new key
});

test('a definitive answer ends the attempt: the next submit uses a NEW key (typed refusals are not stored by the server)', async () => {
  const { mutations, calls } = setup(async (url, init, n) => (n === 1 ? errorEnvelope(409, 'VERSION_CONFLICT') : jsonResponse(200, { data: {} })));
  const refused = await mutations.submit('op', spec({ a: 1 }));
  assert.equal(refused.code, 'VERSION_CONFLICT');
  assert.equal(mutations.hasUnknown('op'), false);
  await mutations.submit('op', spec({ a: 1 }));
  assert.notEqual(keyOf(calls[0]), keyOf(calls[1]));
});

test('an attempt of another user is dropped, never replayed under the new user', async () => {
  const { mutations, calls } = setup(async () => {
    throw new TypeError('offline');
  });
  await mutations.submit('op', spec({ a: 1 }, 'user-1'));
  await mutations.submit('op', spec({ a: 1 }, 'user-2'));
  assert.notEqual(keyOf(calls[0]), keyOf(calls[1]));
});

test('4xx with an unreadable body (a gateway page) is a refusal, not an unknown outcome', async () => {
  const { mutations } = setup(async () => jsonResponse(404, '<html>not found</html>'));
  await mutations.submit('op', spec({ a: 1 }));
  assert.equal(mutations.hasUnknown('op'), false);
});

test('clearAll forgets every attempt (sign-out, new login)', async () => {
  const { mutations } = setup(async () => {
    throw new TypeError('offline');
  });
  await mutations.submit('op', spec({ a: 1 }));
  mutations.clearAll();
  assert.equal(mutations.status('op'), 'NONE');
});
