import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decideRoute,
  describeDriver,
  describeShop,
  maskPhone,
  parseLogin,
  parseMe,
  selectableRoles,
  shopMissingConditions,
} from '../../apps/web/src/core/projection.js';

function meData(overrides = {}) {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    phone_normalized: '+84912345678',
    available_roles: [],
    active_role: null,
    onboarding_required: true,
    role_selection_required: false,
    onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
    phone_verification_status: 'UNVERIFIED_TEST',
    ...overrides,
  };
}
const me = (overrides) => parseMe(meData(overrides));

test('parseMe: accepts the contract and fails closed on any deviation', () => {
  const ok = me();
  assert.equal(ok.userId, '00000000-0000-4000-8000-000000000001');
  assert.equal(ok.phoneStatus, 'UNVERIFIED_TEST');
  assert.ok(Object.isFrozen(ok));
  const bad = [
    null,
    [],
    meData({ user_id: 1 }),
    meData({ available_roles: 'SHOP' }),
    meData({ active_role: 5 }),
    meData({ onboarding: null }),
    meData({ onboarding: { shop: 'NEW', driver: 'NOT_STARTED' } }),
    meData({ onboarding: { shop: 'NOT_STARTED', driver: 'WAITING' } }),
    meData({ phone_verification_status: 'MAYBE' }),
    meData({ onboarding_required: 'yes' }),
  ];
  for (const data of bad) {
    assert.equal(parseMe(data), null, JSON.stringify(data));
  }
});

test('parseLogin: needs a token, a user id and a known phone status', () => {
  assert.deepEqual(
    { ...parseLogin({ access_token: 'a'.repeat(43), user_id: 'u', phone_verification_status: 'VERIFIED', available_roles: [] }) },
    { accessToken: 'a'.repeat(43), userId: 'u', phoneStatus: 'VERIFIED' },
  );
  assert.equal(parseLogin({ access_token: '', user_id: 'u', phone_verification_status: 'VERIFIED' }), null);
  assert.equal(parseLogin({ access_token: 't', user_id: 'u', phone_verification_status: 'X' }), null);
  assert.equal(parseLogin(null), null);
});

test('router: roleless user goes to the onboarding hub, never to a guessed role', () => {
  assert.deepEqual(decideRoute(me()), { view: 'onboarding-hub' });
  assert.deepEqual(decideRoute(me({ onboarding: { shop: 'INCOMPLETE', driver: 'NOT_STARTED' } })), { view: 'onboarding-hub' });
});

test('router: selectable roles without an effective role go to role selection', () => {
  assert.deepEqual(decideRoute(me({ available_roles: ['DRIVER', 'SHOP'], role_selection_required: true, onboarding_required: false })), { view: 'role-select' });
  assert.deepEqual(decideRoute(me({ available_roles: ['DRIVER'], onboarding: { shop: 'NOT_STARTED', driver: 'PENDING_APPROVAL' } })), { view: 'role-select' });
});

test('router: an effective active role goes to its home', () => {
  const both = { available_roles: ['DRIVER', 'SHOP'], onboarding: { shop: 'COMPLETED', driver: 'ACTIVE' } };
  assert.deepEqual(decideRoute(me({ ...both, active_role: 'SHOP' })), { view: 'shop-home' });
  assert.deepEqual(decideRoute(me({ ...both, active_role: 'DRIVER' })), { view: 'driver-home' });
});

test('router: inconsistent or unsupported projections fail closed (stale role, PLATFORM/EXTERNAL, ADMIN)', () => {
  // The server reports only an EFFECTIVE role, but if it ever disagrees with itself the client must not route into it.
  assert.equal(decideRoute(me({ available_roles: ['DRIVER'], active_role: 'SHOP' })).view, 'unsupported');
  assert.equal(decideRoute(me({ available_roles: ['ADMIN'], active_role: 'ADMIN' })).view, 'unsupported');
  assert.equal(decideRoute(me({ available_roles: ['PLATFORM'], active_role: 'PLATFORM' })).view, 'unsupported');
  // Roles that are not SHOP/DRIVER are never offered for selection.
  assert.deepEqual(selectableRoles(me({ available_roles: ['EXTERNAL', 'SHOP', 'ADMIN'] })), ['SHOP']);
  assert.deepEqual(decideRoute(me({ available_roles: ['EXTERNAL', 'ADMIN'] })), { view: 'onboarding-hub' });
});

test('profile status text: PENDING driver and disabled/closed profiles are explicit, with no action', () => {
  assert.deepEqual(describeDriver(me({ onboarding: { shop: 'NOT_STARTED', driver: 'PENDING_APPROVAL' } })), { tone: 'warning', label: 'Chờ vận hành duyệt', action: null });
  assert.equal(describeDriver(me({ onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' } })).action, 'start');
  assert.equal(describeDriver(me({ onboarding: { shop: 'NOT_STARTED', driver: 'CLOSED' } })).action, null);
  assert.equal(describeDriver(me({ onboarding: { shop: 'NOT_STARTED', driver: 'SUSPENDED' } })).tone, 'danger');
  assert.equal(describeShop(me({ onboarding: { shop: 'INCOMPLETE', driver: 'NOT_STARTED' } })).action, 'continue');
  assert.equal(describeShop(me({ onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' } })).action, 'start');
  // COMPLETED but SHOP not selectable == disabled shop: no way back into onboarding.
  assert.deepEqual(describeShop(me({ onboarding: { shop: 'COMPLETED', driver: 'NOT_STARTED' }, available_roles: [] })), { tone: 'danger', label: 'Quán đang tạm khóa hoặc chưa dùng được', action: null });
  assert.equal(describeShop(me({ onboarding: { shop: 'COMPLETED', driver: 'NOT_STARTED' }, available_roles: ['SHOP'] })).tone, 'success');
});

test('shop missing conditions follow the saved profile (GPS and service area are what complete needs)', () => {
  const draft = { name: 'Quán A', contact_phone: '+84912345678', address_text: '1 Phố X', pickup_lat: null, pickup_lng: null, service_area_id: null };
  const missing = shopMissingConditions(draft);
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.items.filter((item) => !item.done).map((item) => item.key), ['gps', 'service_area']);
  const ready = shopMissingConditions({ ...draft, pickup_lat: 22.6, pickup_lng: 106.2, service_area_id: '00000000-0000-4000-8000-0000000000aa' });
  assert.equal(ready.complete, true);
  assert.equal(shopMissingConditions({ ...draft, pickup_lat: 0, pickup_lng: 0 }).items.find((item) => item.key === 'gps').done, true); // 0,0 is a value, not "missing"
});

test('maskPhone keeps only the first six and last three characters', () => {
  assert.equal(maskPhone('+84912345678'), '+84912 ••• 678');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone(undefined), '');
});
