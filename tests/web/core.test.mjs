import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson } from '../../apps/web/src/core/canonical.js';
import { readConfig } from '../../apps/web/src/core/config.js';
import { createSession, SESSION_STATES } from '../../apps/web/src/core/session.js';
import { uuidv4 } from '../../apps/web/src/core/uuid.js';

test('config: defaults, origin allowlist, and no registration switch', () => {
  assert.deepEqual({ ...readConfig(undefined) }, {
    apiBaseUrl: '',
    requestTimeoutMs: 15000,
    environmentLabel: 'Môi trường thử nghiệm',
    registrationEnabled: false,
  });
  assert.equal(readConfig({ apiBaseUrl: 'https://api.example.test/' }).apiBaseUrl, 'https://api.example.test');
  for (const bad of ['https://user:pw@api.example.test', 'https://api.example.test/v1', '//evil.test', 'javascript:alert(1)', 'https://a.test?x=1', '*']) {
    assert.throws(() => readConfig({ apiBaseUrl: bad }), /CONFIG_INVALID:apiBaseUrl/, bad);
  }
  assert.throws(() => readConfig({ requestTimeoutMs: 10 }), /requestTimeoutMs/);
  assert.throws(() => readConfig({ registrationEnabled: true }), /registrationEnabled/);
  assert.ok(Object.isFrozen(readConfig({})));
});

test('uuid: v4 shape, and the getRandomValues fallback used outside secure contexts', () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(uuidv4(), shape);
  const insecure = { getRandomValues: (array) => globalThis.crypto.getRandomValues(array) };
  const a = uuidv4(insecure);
  assert.match(a, shape);
  assert.notEqual(a, uuidv4(insecure));
  assert.throws(() => uuidv4({}), /NO_SECURE_RANDOM/);
});

test('canonicalJson: key order and undefined do not change the text', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), canonicalJson({ a: [2, { c: undefined, d: 1 }], b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: '1' }));
  assert.equal(canonicalJson({ x: null }), '{"x":null}');
});

test('session: token only in memory, generation moves on every change, clear forgets the token', () => {
  const session = createSession();
  assert.equal(session.token, null);
  assert.equal(session.state, SESSION_STATES.SIGNED_OUT);
  const g0 = session.generation;
  session.setToken('t1');
  assert.equal(session.state, SESSION_STATES.RESOLVING);
  assert.ok(session.generation > g0);
  const g1 = session.generation;
  session.bumpGeneration();
  assert.ok(session.generation > g1);
  session.clear();
  assert.equal(session.token, null);
  assert.equal(session.state, SESSION_STATES.SIGNED_OUT);
  assert.throws(() => session.setToken(''), /SESSION_TOKEN_INVALID/);
  assert.throws(() => session.setState('NOPE'), /SESSION_STATE_INVALID/);
});
