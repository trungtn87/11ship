import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorEnvelope, jsonResponse, makeClient, REQUEST_ID } from './helpers.mjs';

test('success envelope: data returned, bearer sent, no cookies, no cache, no referrer', async () => {
  const { api, calls } = makeClient(async () => jsonResponse(200, { data: { ok: 1 } }), { token: 'secret-token' });
  const result = await api.request({ method: 'GET', path: '/auth/me' });
  assert.deepEqual({ ok: result.ok, status: result.status, data: result.data, stale: result.stale }, { ok: true, status: 200, data: { ok: 1 }, stale: false });
  const { url, init } = calls[0];
  assert.equal(url, '/v1/auth/me');
  assert.equal(init.headers.Authorization, 'Bearer secret-token');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.equal(init.body, undefined);
  assert.equal(init.headers['Content-Type'], undefined);
});

test('body is JSON, Idempotency-Key is passed through, login sends no bearer', async () => {
  const { api, calls } = makeClient(async () => jsonResponse(201, { data: {} }), { token: 'tok' });
  await api.request({ method: 'PUT', path: '/onboarding/shop/profile', body: { a: 1 }, idempotencyKey: 'k-1' });
  assert.equal(calls[0].init.body, '{"a":1}');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'k-1');
  await api.request({ method: 'POST', path: '/auth/login', body: {}, auth: false });
  assert.equal(calls[1].init.headers.Authorization, undefined);
});

test('error envelope: code, status and request id are typed; the English message is dropped', async () => {
  const { api } = makeClient(async () => errorEnvelope(401, 'INVALID_CREDENTIALS'), { token: 't' });
  const result = await api.request({ method: 'POST', path: '/auth/login', auth: false, body: {} });
  assert.deepEqual(
    { ok: result.ok, kind: result.kind, status: result.status, code: result.code, requestId: result.requestId },
    { ok: false, kind: 'http', status: 401, code: 'INVALID_CREDENTIALS', requestId: REQUEST_ID },
  );
  assert.equal(JSON.stringify(result).includes('English'), false);
});

test('request id falls back to the X-Request-ID header when the body has none usable', async () => {
  const { api } = makeClient(async () => jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: 'not-a-uuid' } }, { 'x-request-id': REQUEST_ID }), { token: 't' });
  const result = await api.request({ method: 'GET', path: '/auth/me' });
  assert.equal(result.requestId, REQUEST_ID);
});

test('invalid responses are distinguished: HTML on 200, JSON without data, error without code', async () => {
  const cases = [
    [200, '<html>proxy page</html>'],
    [200, { nope: true }],
    [200, [1, 2]],
    [500, '<html>bad gateway</html>'],
    [500, { error: { message: 'no code' } }],
  ];
  for (const [status, body] of cases) {
    const { api } = makeClient(async () => jsonResponse(status, body), { token: 't' });
    const result = await api.request({ method: 'GET', path: '/auth/me' });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'invalid_response', JSON.stringify([status, body]));
    assert.equal(result.status, status);
  }
});

test('network failure and timeout are different results', async () => {
  const network = makeClient(async () => {
    throw new TypeError('fetch failed');
  }, { token: 't' });
  assert.equal((await network.api.request({ method: 'GET', path: '/auth/me' })).kind, 'network');

  const slow = makeClient(
    (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    { token: 't', timeoutMs: 20 },
  );
  assert.equal((await slow.api.request({ method: 'GET', path: '/auth/me' })).kind, 'timeout');
});

test('an external abort is reported as aborted, not as a timeout', async () => {
  const controller = new AbortController();
  const { api } = makeClient(
    (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    { token: 't', timeoutMs: 5000 },
  );
  const pending = api.request({ method: 'GET', path: '/auth/me', signal: controller.signal });
  controller.abort();
  assert.equal((await pending).kind, 'aborted');
  const already = await api.request({ method: 'GET', path: '/auth/me', signal: controller.signal });
  assert.equal(already.kind, 'aborted');
});

test('a result is stale when the session generation moved while the request was in flight', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { api, session } = makeClient(async () => {
    await gate;
    return errorEnvelope(401, 'SESSION_EXPIRED');
  }, { token: 'old' });
  const pending = api.request({ method: 'GET', path: '/auth/me' });
  session.setToken('new'); // a newer login happened meanwhile
  release();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(session.token, 'new'); // the client itself never clears the token
});

test('an authenticated call without a token answers SESSION_INVALID locally and never reaches the network', async () => {
  const { api, calls } = makeClient(async () => jsonResponse(200, { data: {} }));
  const result = await api.request({ method: 'GET', path: '/auth/me' });
  assert.equal(result.code, 'SESSION_INVALID');
  assert.equal(calls.length, 0);
});

test('paths are validated: no query, no traversal, no absolute URL', async () => {
  const { api } = makeClient(async () => jsonResponse(200, { data: {} }), { token: 't' });
  for (const path of ['auth/me', '/auth/me?x=1', '/../etc', '//evil.test/x', 'https://evil.test/x', '/auth/%2e%2e']) {
    await assert.rejects(() => api.request({ method: 'GET', path }), /API_PATH_INVALID/, path);
  }
});
