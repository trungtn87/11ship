import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  AuthApp,
  ApiResponse,
  createServiceArea,
  dataOf,
  errorCode,
  PASSWORD,
  Phone,
  randomPhone,
  sessionIdOfToken,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';
import { createCategory, jpegBase64 } from './support/menu-fixtures';
import { FixtureTrust, NativePhone } from './support/native-device-fixtures';

// M01-ANDROID remaining flows (shop profile + context, driver profile, test password reset) over the DEVICE-BOUND native session,
// on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only). The attestation is a FIXTURE (server logic only, not a phone).
// The business rules themselves are covered by the shop/driver/reset suites; this file proves that the same routes work with the
// native proof, refuse a missing/foreign proof, recheck the binding inside the transaction, and that the PUBLIC reset takes no proof.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const NEW_PASSWORD = 'Brand-New-Passw0rd-7';
const GPS = { pickup_lat: 10.0123, pickup_lng: 106.0456 };

function device(app: 'FOOD' | 'SHIP'): Record<string, string> {
  return { device_id: `android-${app.toLowerCase()}-0002`, platform: 'ANDROID', app };
}

describe('native remaining flows (fixture attestation)', () => {
  let trust: FixtureTrust;
  let app: AuthApp;
  let closed: AuthApp;

  beforeAll(async () => {
    trust = new FixtureTrust();
    const base = { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, clientPhoneVerificationMode: 'DISABLED_TEST' as const };
    app = await startAuthApp({}, { relaxTimeouts: true, deviceTrust: trust, configOverride: { ...base, accountRecoveryMode: 'DISABLED_TEST' } });
    closed = await startAuthApp({}, { configOverride: base });
  });

  afterAll(async () => {
    await closed.close();
    await app.close();
  });

  async function registerFood(): Promise<{ phone: Phone; native: NativePhone; token: string; userId: string; bindingId: string; registration: { token: string; keyId: string } }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const native = new NativePhone(app, trust);
    const enrolled = await native.enroll('FOOD');
    expect(enrolled.response.status).toBe(201);
    const registration = { token: enrolled.token, keyId: enrolled.keyId };
    const result = await native.authCall(
      'FOOD',
      '/client-auth/register',
      { phone: phone.local, password: PASSWORD, device: device('FOOD'), full_name: 'Nguyễn Văn An', consent: { terms_version: TERMS, privacy_version: PRIVACY } },
      registration,
    );
    expect(result.response.status).toBe(201);
    const data = dataOf(result.response);
    const bindingId = String(result.response.headers.get('x-device-binding-id'));
    native.bindingId = bindingId;
    return { phone, native, token: String(data.access_token), userId: String(data.user_id), bindingId, registration };
  }

  const me = (native: NativePhone, which: 'FOOD' | 'SHIP', token: string): Promise<ApiResponse> => native.signedCall(which, 'GET', '/client-auth/me', { bearer: token }).then((r) => r.response);

  describe('Food shop management and menu (M02) with the device proof', () => {
    it('the owner reads and writes the shop, schedule, pictures and dishes only with the signed request (raw body is what is signed)', async () => {
      const food = await registerFood();
      const { native, token } = food;
      const areaId = await createServiceArea(app.pool);
      const saved = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', { bearer: token, body: shopProfileBody({ ...GPS, service_area_id: areaId }), idempotencyKey: randomUUID() });
      const done = await native.signedCall('FOOD', 'POST', '/onboarding/shop/complete', { bearer: token, body: { expected_version: Number(dataOf(saved.response).version) }, idempotencyKey: randomUUID() });
      expect(done.response.status).toBe(200);
      expect((await native.signedCall('FOOD', 'POST', '/client-auth/context', { bearer: token, body: { context: 'SHOP_OWNER' }, idempotencyKey: randomUUID() })).response.status).toBe(200);
      const category = await createCategory(app.pool, 'Món chính', 'ACTIVE', 1);

      const read = await native.signedCall('FOOD', 'GET', '/shop/me', { bearer: token });
      expect(read.response.status).toBe(200);
      expect(read.response.headers.get('cache-control')).toBe('no-store');
      const version = Number(dataOf(read.response).version);

      const noProof = await native.signedCall('FOOD', 'PUT', '/shop/me/business-hours', { bearer: token, body: { expected_version: version, intervals: [] }, idempotencyKey: randomUUID(), omitProof: true });
      expect([noProof.response.status, errorCode(noProof.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);

      const hours = await native.signedCall('FOOD', 'PUT', '/shop/me/business-hours', {
        bearer: token,
        body: { expected_version: version, intervals: [{ weekday: 1, start_minute: 1020, end_minute: 1380, end_day_offset: 0 }] },
        idempotencyKey: randomUUID(),
      });
      expect(hours.response.status).toBe(200);
      const profile = await native.signedCall('FOOD', 'PUT', '/shop/me/profile', {
        bearer: token,
        body: { expected_version: Number(dataOf(hours.response).version), name: 'Quán đã sửa', contact_phone: '0912345678', address_text: '1 Phố Mới', pickup_lat: 10.0123, pickup_lng: 106.0456, service_area_id: areaId },
        idempotencyKey: randomUUID(),
      });
      expect(profile.response.status).toBe(200);

      const image = await native.signedCall('FOOD', 'POST', '/shop/me/menu/images', { bearer: token, body: { content_type: 'image/jpeg', data_base64: jpegBase64(300_000) }, });
      expect(image.response.status).toBe(201);
      const created = await native.signedCall('FOOD', 'POST', '/shop/me/menu/items', {
        bearer: token,
        body: { name: 'Ốc hương hấp', price_vnd: 120000, category_id: category, image_id: String(dataOf(image.response).image_id) },
        idempotencyKey: randomUUID(),
      });
      expect(created.response.status).toBe(201);
      const itemId = String((dataOf(created.response).item as Record<string, unknown>).item_id);
      const hidden = await native.signedCall('FOOD', 'POST', `/shop/me/menu/items/${itemId}/hide`, { bearer: token, body: { expected_version: 1 }, idempotencyKey: randomUUID() });
      expect(hidden.response.status).toBe(200);
      const menu = await native.signedCall('FOOD', 'GET', '/shop/me/menu', { bearer: token });
      expect((dataOf(menu.response).items as { status: string }[])[0]?.status).toBe('HIDDEN');
    });
  });

  describe('Food shop profile and context', () => {
    it('needs the device proof; saves a draft without GPS, completes with a stored point and area, and keeps CUSTOMER', async () => {
      const food = await registerFood();
      const { native, token } = food;

      const bare = await native.signedCall('FOOD', 'GET', '/onboarding/shop/profile', { bearer: token, omitProof: true });
      expect([bare.response.status, errorCode(bare.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
      const bareWrite = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', { bearer: token, body: shopProfileBody(), idempotencyKey: randomUUID(), omitProof: true });
      expect([bareWrite.response.status, errorCode(bareWrite.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);

      const empty = await native.signedCall('FOOD', 'GET', '/onboarding/shop/profile', { bearer: token });
      expect(empty.response.status).toBe(200);
      expect(dataOf(empty.response)).toBeNull();

      const areaId = await createServiceArea(app.pool);
      const areas = await native.signedCall('FOOD', 'GET', '/onboarding/shop/service-areas', { bearer: token });
      expect(areas.response.status).toBe(200);
      expect((areas.response.body.data as unknown as Array<{ service_area_id: string }>).some((area) => area.service_area_id === areaId)).toBe(true);

      // The draft has no position: it is stored, and completion is refused by the server.
      const draft = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', { bearer: token, body: shopProfileBody(), idempotencyKey: randomUUID() });
      expect(draft.response.status).toBe(201);
      expect(dataOf(draft.response)).toMatchObject({ status: 'INCOMPLETE' });
      const stored = await native.signedCall('FOOD', 'GET', '/onboarding/shop/profile', { bearer: token });
      expect(dataOf(stored.response)).toMatchObject({ status: 'INCOMPLETE', pickup_lat: null, pickup_lng: null });
      const version = Number(dataOf(draft.response).version);
      const early = await native.signedCall('FOOD', 'POST', '/onboarding/shop/complete', { bearer: token, body: { expected_version: version }, idempotencyKey: randomUUID() });
      expect(early.response.status).toBeGreaterThanOrEqual(400);

      const withPoint = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', {
        bearer: token,
        body: shopProfileBody({ ...GPS, service_area_id: areaId, expected_version: version }),
        idempotencyKey: randomUUID(),
      });
      expect(withPoint.response.status).toBe(200);
      const key = randomUUID();
      const done = await native.signedCall('FOOD', 'POST', '/onboarding/shop/complete', { bearer: token, body: { expected_version: Number(dataOf(withPoint.response).version) }, idempotencyKey: key });
      expect(done.response.status).toBe(200);
      expect(dataOf(done.response)).toMatchObject({ status: 'ACTIVE', accepting_orders: false });

      // A lost answer: the same key and body replays the first answer with a fresh proof.
      const replay = await native.signedCall('FOOD', 'POST', '/onboarding/shop/complete', { bearer: token, body: { expected_version: Number(dataOf(withPoint.response).version) }, idempotencyKey: key });
      expect(replay.response.status).toBe(200);
      expect(dataOf(replay.response)).toEqual(dataOf(done.response));

      const identity = await me(native, 'FOOD', token);
      expect(dataOf(identity).active_role).toBe('CUSTOMER');
      expect(dataOf(identity).available_roles).toEqual(expect.arrayContaining(['CUSTOMER', 'SHOP_OWNER']));
    });

    it('switches context only on the signed request; a missing proof or a foreign key changes nothing', async () => {
      const food = await registerFood();
      const { native, token } = food;
      const areaId = await createServiceArea(app.pool);
      const saved = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', { bearer: token, body: shopProfileBody({ ...GPS, service_area_id: areaId }), idempotencyKey: randomUUID() });
      expect(saved.response.status).toBe(201);
      const done = await native.signedCall('FOOD', 'POST', '/onboarding/shop/complete', { bearer: token, body: { expected_version: Number(dataOf(saved.response).version) }, idempotencyKey: randomUUID() });
      expect(done.response.status).toBe(200);

      const bare = await native.signedCall('FOOD', 'POST', '/client-auth/context', { bearer: token, body: { context: 'SHOP_OWNER' }, idempotencyKey: randomUUID(), omitProof: true });
      expect([bare.response.status, errorCode(bare.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
      expect(dataOf(await me(native, 'FOOD', token)).active_role).toBe('CUSTOMER');

      const switched = await native.signedCall('FOOD', 'POST', '/client-auth/context', { bearer: token, body: { context: 'SHOP_OWNER' }, idempotencyKey: randomUUID() });
      expect(switched.response.status).toBe(200);
      expect(dataOf(switched.response).active_role).toBe('SHOP_OWNER');
      const back = await native.signedCall('FOOD', 'POST', '/client-auth/context', { bearer: token, body: { context: 'CUSTOMER' }, idempotencyKey: randomUUID() });
      expect(back.response.status).toBe(200);
      expect(dataOf(back.response).active_role).toBe('CUSTOMER');
    });

    it('a shop write by a session whose binding moved on is refused inside the transaction (SESSION_REVOKED), writing nothing', async () => {
      const food = await registerFood();
      const { native, token } = food;
      // The head of the binding moves on while the session row itself is untouched (a replacement committed in between).
      await app.pool.query('UPDATE app.client_device_key_links SET detached_at = clock_timestamp() WHERE binding_id = $1::uuid', [food.bindingId]);
      await app.pool.query('UPDATE app.client_device_bindings SET deactivated_at = clock_timestamp() WHERE binding_id = $1::uuid', [food.bindingId]);
      const denied = await native.signedCall('FOOD', 'PUT', '/onboarding/shop/profile', { bearer: token, body: shopProfileBody(), idempotencyKey: randomUUID() });
      expect([denied.response.status, errorCode(denied.response)]).toEqual([401, 'SESSION_REVOKED']);
      const rows = await app.pool.query('SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [food.userId]);
      expect(rows.rowCount).toBe(0);
    });
  });

  describe('Ship driver profile', () => {
    it('Ship joins the binding, submits once with the proof, reads PENDING, and the context never changes', async () => {
      const food = await registerFood();
      const { native, phone } = food;
      const authorizer = native.keys.FOOD;
      if (authorizer === undefined) {
        throw new Error('no food key');
      }
      const joined = await native.join('SHIP', food.bindingId, authorizer);
      expect(joined.response.status).toBe(201);
      const login = await native.authCall('SHIP', '/client-auth/login', { phone: phone.local, password: PASSWORD, device: device('SHIP') }, { token: joined.token, keyId: joined.keyId });
      expect(login.response.status).toBe(200);
      const token = String(dataOf(login.response).access_token);

      const before = await native.signedCall('SHIP', 'GET', '/driver/me', { bearer: token });
      expect(before.response.status).toBe(200);
      expect(dataOf(before.response)).toBeNull();
      const bare = await native.signedCall('SHIP', 'POST', '/onboarding/driver', { bearer: token, body: { full_name: 'Trần Văn Shipper' }, idempotencyKey: randomUUID(), omitProof: true });
      expect([bare.response.status, errorCode(bare.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);

      const key = randomUUID();
      const created = await native.signedCall('SHIP', 'POST', '/onboarding/driver', { bearer: token, body: { full_name: 'Trần Văn Shipper' }, idempotencyKey: key });
      expect(created.response.status).toBe(201);
      expect(dataOf(created.response)).toMatchObject({ status: 'PENDING', accepting_deliveries: false, driver_type: 'EXTERNAL' });
      const replay = await native.signedCall('SHIP', 'POST', '/onboarding/driver', { bearer: token, body: { full_name: 'Trần Văn Shipper' }, idempotencyKey: key });
      expect(dataOf(replay.response)).toEqual(dataOf(created.response));
      const rows = await app.pool.query('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [food.userId]);
      expect(rows.rowCount).toBe(1);

      const after = await native.signedCall('SHIP', 'GET', '/driver/me', { bearer: token });
      expect(dataOf(after.response)).toMatchObject({ status: 'PENDING', full_name: 'Trần Văn Shipper' });
      const identity = await me(native, 'SHIP', token);
      expect(dataOf(identity).active_role).toBe('CUSTOMER');
    });
  });

  describe('Ship own password change', () => {
    it('requires a native proof, replays with fresh proof, keeps Ship and revokes Food', async () => {
      const food = await registerFood();
      const { native, phone } = food;
      const authorizer = native.keys.FOOD;
      if (authorizer === undefined) throw new Error('no food key');
      const joined = await native.join('SHIP', food.bindingId, authorizer);
      expect(joined.response.status).toBe(201);
      const login = await native.authCall('SHIP', '/client-auth/login', { phone: phone.local, password: PASSWORD, device: device('SHIP') }, { token: joined.token, keyId: joined.keyId });
      expect(login.response.status).toBe(200);
      const token = String(dataOf(login.response).access_token);
      const body = { current_password: PASSWORD, new_password: NEW_PASSWORD };
      const bare = await native.signedCall('SHIP', 'POST', '/client-auth/change-password', { bearer: token, body, idempotencyKey: randomUUID(), omitProof: true });
      expect([bare.response.status, errorCode(bare.response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
      const wrong = await native.signedCall('SHIP', 'POST', '/client-auth/change-password', { bearer: token, body: { ...body, current_password: 'wrong' }, idempotencyKey: randomUUID() });
      expect([wrong.response.status, errorCode(wrong.response)]).toEqual([400, 'CURRENT_PASSWORD_INVALID']);
      const key = randomUUID();
      const changed = await native.signedCall('SHIP', 'POST', '/client-auth/change-password', { bearer: token, body, idempotencyKey: key });
      expect(changed.response.status).toBe(200);
      expect(dataOf(changed.response)).toEqual({ changed: true });
      const replay = await native.signedCall('SHIP', 'POST', '/client-auth/change-password', { bearer: token, body, idempotencyKey: key });
      expect(replay.response.status).toBe(200);
      expect(dataOf(replay.response)).toEqual({ changed: true });
      expect((await me(native, 'SHIP', token)).status).toBe(200);
      expect((await me(native, 'FOOD', food.token)).status).toBe(401);
    });
  });

  describe('test password reset', () => {
    it('is public (no token, no proof), answers one generic ack, revokes the native session and its login replay, and the new password logs in', async () => {
      const food = await registerFood();
      const { native, phone } = food;

      const config = await app.call('GET', '/account-recovery/config', {});
      expect(dataOf(config)).toEqual({ mode: 'DISABLED_TEST' });
      const closedConfig = await closed.call('GET', '/account-recovery/config', {});
      expect(dataOf(closedConfig)).toEqual({ mode: 'UNAVAILABLE' });

      const key = randomUUID();
      const reset = await app.call('POST', '/account-recovery/reset-test', { headers: { 'idempotency-key': key }, body: { phone: phone.local, password: NEW_PASSWORD } });
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual({ data: { next: 'LOGIN' } });
      const retry = await app.call('POST', '/account-recovery/reset-test', { headers: { 'idempotency-key': key }, body: { phone: phone.local, password: NEW_PASSWORD } });
      expect(retry.body).toEqual({ data: { next: 'LOGIN' } });
      const unknown = await app.call('POST', '/account-recovery/reset-test', { headers: { 'idempotency-key': randomUUID() }, body: { phone: randomPhone().local, password: NEW_PASSWORD } });
      expect(unknown.body).toEqual({ data: { next: 'LOGIN' } });

      // The old native session is dead; a lost-answer replay of the old login can no longer return its token.
      const dead = await me(native, 'FOOD', food.token);
      expect([dead.status, errorCode(dead)]).toEqual([401, 'SESSION_REVOKED']);

      const again = await native.reauth('FOOD');
      const registration = { token: again.token, keyId: native.keys.FOOD?.keyId ?? '' };
      const old = await native.authCall('FOOD', '/client-auth/login', { phone: phone.local, password: PASSWORD, device: device('FOOD') }, registration);
      expect([old.response.status, errorCode(old.response)]).toEqual([401, 'INVALID_CREDENTIALS']);
      const fresh = await native.authCall('FOOD', '/client-auth/login', { phone: phone.local, password: NEW_PASSWORD, device: device('FOOD') }, { token: (await native.reauth('FOOD')).token, keyId: registration.keyId });
      expect(fresh.response.status).toBe(200);
      expect((await me(native, 'FOOD', String(dataOf(fresh.response).access_token))).status).toBe(200);
      expect(await sessionIdOfToken(app.pool, String(dataOf(fresh.response).access_token))).not.toBe(await sessionIdOfToken(app.pool, food.token));
    });

    it('is closed (503) where the mode is not DISABLED_TEST, before the body is read', async () => {
      const result = await closed.call('POST', '/account-recovery/reset-test', { headers: { 'idempotency-key': randomUUID() }, body: { phone: randomPhone().local, password: NEW_PASSWORD } });
      expect(result.status).toBe(503);
    });
  });
});
