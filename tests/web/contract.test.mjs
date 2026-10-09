// Drift guards between the client and the backend SOURCE: when the backend adds an error code, a role-context field or
// an onboarding state, these fail until the client knows about it. They read files of the repository (no network).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ERROR_COPY, describeFailure, isSessionFailure } from '../../apps/web/src/api/errors.js';
import { DRIVER_STATES, SHOP_STATES, PHONE_STATUSES } from '../../apps/web/src/core/projection.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function backendErrorCodes() {
  const source = read('apps/backend/src/common/app-errors.ts');
  const block = source.slice(source.indexOf('APP_ERROR_DEFINITIONS = {'), source.indexOf('} as const satisfies'));
  return [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]);
}

test('every backend error code has Vietnamese copy', () => {
  const codes = backendErrorCodes();
  assert.ok(codes.length >= 30, `parsed ${codes.length} codes`);
  for (const code of codes) {
    assert.ok(Object.hasOwn(ERROR_COPY, code), `missing copy for ${code}`);
    assert.match(ERROR_COPY[code], /\p{L}/u);
  }
});

test('every generic HTTP envelope code has copy', () => {
  const source = read('apps/backend/src/http/error-envelope.ts');
  const codes = [...source.matchAll(/code: '([A-Z_]+)'/g)].map((match) => match[1]);
  assert.ok(codes.includes('INTERNAL_ERROR') && codes.includes('BAD_REQUEST'));
  for (const code of [...codes, 'CLIENT_ERROR']) {
    assert.ok(Object.hasOwn(ERROR_COPY, code), `missing copy for ${code}`);
  }
});

test('copy is Vietnamese text, never the English server message', () => {
  const source = read('apps/backend/src/common/app-errors.ts');
  for (const [, message] of source.matchAll(/message: '([^']+)'/g)) {
    for (const copy of Object.values(ERROR_COPY)) {
      assert.notEqual(copy, message);
    }
  }
});

test('session error codes of the client are the backend session codes', () => {
  const codes = backendErrorCodes().filter((code) => code.startsWith('SESSION_'));
  assert.deepEqual([...codes].sort(), ['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REVOKED']);
  for (const code of codes) {
    assert.equal(isSessionFailure({ kind: 'http', code }), true);
  }
  assert.equal(isSessionFailure({ kind: 'http', code: 'ACCOUNT_DISABLED' }), false);
  assert.equal(isSessionFailure({ kind: 'network' }), false);
});

test('onboarding states and phone statuses match the backend vocabulary', () => {
  const driver = read('apps/backend/src/driver/driver-types.ts');
  const states = [...driver.slice(driver.indexOf('DRIVER_ONBOARDING_STATES = [')).split(']')[0].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(states, [...DRIVER_STATES]);
  const shop = read('apps/backend/src/shop/shop-types.ts');
  const shopStates = [...shop.match(/type ShopOnboardingState = ([^;]+);/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(shopStates, [...SHOP_STATES]);
  const origin = read('apps/backend/src/auth/account-origin.ts');
  const phone = [...origin.match(/type PhoneVerificationStatus = ([^;]+);/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(phone, [...PHONE_STATUSES]);
});

test('the /me projection fields the client reads are exactly what the backend returns', () => {
  const source = read('apps/backend/src/auth/role-context-service.ts');
  const keys = (name) => [...source.slice(source.indexOf(`interface ${name}`)).split('}')[0].matchAll(/readonly (\w+):/g)].map((m) => m[1]);
  const backend = [...keys('MeResult'), ...keys('OnboardingProjection'), 'phone_verification_status'];
  const client = read('apps/web/src/core/projection.js');
  for (const key of backend) {
    assert.ok(client.includes(key), `client does not read /me field ${key}`);
  }
});

test('request bodies use the backend strict key sets (extra keys are refused server side)', () => {
  const shop = read('apps/backend/src/onboarding/shop-onboarding-validation.ts');
  const optional = ['zalo', 'facebook', 'pickup_lat', 'pickup_lng', 'service_area_id', 'expected_version'];
  const required = ['name', 'contact_phone', 'address_text'];
  for (const key of [...required, ...optional]) assert.ok(shop.includes(`'${key}'`), key);
  const driver = read('apps/backend/src/onboarding/driver-onboarding-validation.ts');
  assert.ok(driver.includes("['full_name'], ['plate_number']"));
  const auth = read('apps/backend/src/auth/auth-validation.ts');
  assert.ok(auth.includes("['phone', 'password', 'device']"));
  assert.ok(auth.includes("['device_id', 'platform', 'app']"));
});

test('describeFailure never shows a body and always keeps the request id for support', () => {
  const described = describeFailure({ kind: 'http', status: 409, code: 'VERSION_CONFLICT', requestId: 'r-1' });
  assert.match(described.message, /Hồ sơ vừa được thay đổi/);
  assert.deepEqual(described.detail, { status: 409, code: 'VERSION_CONFLICT', requestId: 'r-1' });
  const unknown = describeFailure({ kind: 'http', status: 418, code: 'TEAPOT', requestId: null });
  assert.match(unknown.message, /Có lỗi không xác định/);
  assert.match(describeFailure({ kind: 'network' }).message, /Không kết nối được máy chủ/);
  assert.match(describeFailure({ kind: 'timeout' }).message, /quá lâu/);
});
