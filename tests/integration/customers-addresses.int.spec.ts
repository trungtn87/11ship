import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  errorCode,
  installFault,
  obtainProof,
  PASSWORD,
  Phone,
  randomPhone,
  registerUser,
  removeFault,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';

// M05 — GET /v1/customers/me and the delivery address book under /v1/customers/me/addresses on the REAL Nest pipeline and a REAL
// PostgreSQL (TEST database only): the customer record created once, add / edit / soft delete / default of addresses, the
// ownership of every row, idempotent retries, concurrent default changes, and all-or-nothing commits.
// Contract: docs/current/11Ship-M05-design-approved-v1.0.md. Cases M05-01 .. M05-12 are proven here by the id in the test name.
// M05-13 and M05-14 (checkout with an inline address) need M10 and are PENDING_M10: nothing here pretends to cover them.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const NAME_AN = 'Nguyễn Văn An';
const CUSTOMER_KEYS = ['customer_id', 'user_id', 'full_name', 'phone', 'created_at'];
const ADDRESS_KEYS = [
  'id',
  'label',
  'recipient_name',
  'contact_phone',
  'address_description',
  'latitude',
  'longitude',
  'delivery_note',
  'is_default',
  'version',
  'created_at',
  'updated_at',
];
const CREATE_ACTION = 'customer.address.create.v1';
const UPDATE_ACTION = 'customer.address.update.v1';
const DELETE_ACTION = 'customer.address.delete.v1';
const DEFAULT_ACTION = 'customer.address.set_default.v1';

interface Account {
  readonly phone: Phone;
  readonly password: string;
  readonly userId: string;
}

type Address = Record<string, unknown>;

describe('M05 — customer record and address book', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------------- helpers

  /** A real CUSTOMER account created through the client registration. */
  async function newCustomer(): Promise<Account> {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const response = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        phone: phone.local,
        password: PASSWORD,
        verification_token: proof.proofToken,
        device: { ...WEB_FOOD },
        full_name: NAME_AN,
        consent: { terms_version: TERMS, privacy_version: PRIVACY },
      },
    });
    expect(response.status).toBe(201);
    return { phone, password: PASSWORD, userId: String(dataOf(response).user_id) };
  }

  /** A legacy account: ordinary and verified, with no CUSTOMER role. */
  async function legacyAccount(): Promise<Account> {
    const legacy = await registerUser(app);
    return { phone: legacy.phone, password: legacy.password, userId: legacy.userId };
  }

  async function clientLogin(user: Account, device: Record<string, unknown> = { ...WEB_FOOD }): Promise<string> {
    const response = await app.call('POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: user.phone.local, password: user.password, device },
    });
    expect(response.status).toBe(200);
    return String(dataOf(response).access_token);
  }

  const logout = (token: string) => app.call('POST', '/client-auth/logout', { bearer: token, body: {} });

  const me = (token: string, query = '') => app.call('GET', `/customers/me${query}`, { bearer: token });
  const listRaw = (token: string, query = '') => app.call('GET', `/customers/me/addresses${query}`, { bearer: token });
  const create = (token: string, body: unknown, key: string | null = randomUUID()) =>
    app.call('POST', '/customers/me/addresses', { bearer: token, ...(key === null ? {} : { headers: { 'idempotency-key': key } }), body });
  const patch = (token: string, id: string, body: unknown, key: string | null = randomUUID()) =>
    app.call('PATCH', `/customers/me/addresses/${id}`, { bearer: token, ...(key === null ? {} : { headers: { 'idempotency-key': key } }), body });
  const remove = (token: string, id: string, key: string | null = randomUUID()) =>
    app.call('DELETE', `/customers/me/addresses/${id}`, { bearer: token, ...(key === null ? {} : { headers: { 'idempotency-key': key } }) });
  const makeDefault = (token: string, id: string, key: string | null = randomUUID()) =>
    app.call('PUT', `/customers/me/addresses/${id}/default`, { bearer: token, ...(key === null ? {} : { headers: { 'idempotency-key': key } }) });

  async function list(token: string): Promise<Address[]> {
    const response = await listRaw(token);
    expect(response.status).toBe(200);
    return dataOf(response).addresses as Address[];
  }

  const body = (over: Record<string, unknown> = {}) => ({
    label: 'HOME',
    recipient_name: 'Nguyễn Văn A',
    contact_phone: '0901234567',
    address_description: 'Tổ 5, phường Thục Phán, Cao Bằng',
    delivery_note: 'Gọi trước khi đến',
    ...over,
  });

  /** Creates one address and returns its view; the call must succeed. */
  async function add(token: string, over: Record<string, unknown> = {}): Promise<Address> {
    const response = await create(token, body(over));
    expect(response.status).toBe(201);
    return dataOf(response);
  }

  const defaults = (userId: string) =>
    countRows(
      app.pool,
      `SELECT 1 FROM app.customer_addresses a JOIN app.customers c ON c.id = a.customer_id
        WHERE c.user_id = $1::uuid AND a.is_default AND a.is_active`,
      [userId],
    );
  const addressRows = (userId: string) =>
    countRows(app.pool, 'SELECT 1 FROM app.customer_addresses a JOIN app.customers c ON c.id = a.customer_id WHERE c.user_id = $1::uuid', [userId]);
  const customerRows = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.customers WHERE user_id = $1::uuid', [userId]);
  const auditCount = (userId: string, action: string) =>
    countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = $2', [userId, action]);
  const recordCount = (userId: string) =>
    countRows(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'customer_address_book' AND scope_id = $1", [userId]);

  async function storedAddress(id: string) {
    const result = await app.pool.query<{ is_active: boolean; is_default: boolean; version: string; address_description: string }>(
      'SELECT is_active, is_default, version::text AS version, address_description FROM app.customer_addresses WHERE id = $1::uuid',
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('address row not found');
    }
    return { isActive: row.is_active, isDefault: row.is_default, version: Number(row.version), description: row.address_description };
  }

  // ------------------------------------------------------------------------------------------ A — GET /customers/me

  describe('A — GET /customers/me', () => {
    it('creates the customer once for the account, in the exact shape, no-store, with the M01 name and phone', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      expect(await customerRows(user.userId)).toBe(0);

      const first = await me(token);
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      expect(Object.keys(first.body)).toEqual(['data']);
      expect(Object.keys(dataOf(first))).toEqual(CUSTOMER_KEYS);
      expect(dataOf(first)).toMatchObject({ user_id: user.userId, full_name: NAME_AN, phone: user.phone.normalized });
      expect(String(dataOf(first).created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const second = await me(token);
      expect(dataOf(second)).toEqual(dataOf(first));
      expect(await customerRows(user.userId)).toBe(1);
      expect(await auditCount(user.userId, 'customer.create.v1')).toBe(1);

      // A second session of the same account sees the same single customer.
      const other = await me(await clientLogin(user));
      expect(dataOf(other).customer_id).toBe(dataOf(first).customer_id);
      expect(await customerRows(user.userId)).toBe(1);
    });

    it('an account without the CUSTOMER role is ROLE_NOT_AVAILABLE and nothing is created', async () => {
      const user = await legacyAccount();
      const response = await me(await clientLogin(user));
      expect([response.status, errorCode(response)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await customerRows(user.userId)).toBe(0);
    });

    it('refuses a missing session and any query selector', async () => {
      const mine = await newCustomer();
      const other = await newCustomer();
      const token = await clientLogin(mine);
      const anonymous = await app.call('GET', '/customers/me');
      expect([anonymous.status, errorCode(anonymous)]).toEqual([401, 'SESSION_INVALID']);
      for (const query of [`?user_id=${other.userId}`, `?customer_id=${randomUUID()}`, '?x=1']) {
        const response = await me(token, query);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
        expect(response.text).not.toContain(other.userId);
      }
    });
  });

  // -------------------------------------------------------------------------------------- B — list and create

  describe('B — GET and POST /customers/me/addresses', () => {
    it('M05-01: a customer with no address reads an empty book and nothing is created', async () => {
      const user = await newCustomer();
      const response = await listRaw(await clientLogin(user));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.body).toEqual({ data: { addresses: [] } });
      expect(await customerRows(user.userId)).toBe(0);
      expect(await addressRows(user.userId)).toBe(0);
    });

    it('M05-02 and M05-07: the first address is the default whatever the request says, and it is saved without a GPS position', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const response = await create(token, body({ is_default: false }));
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const created = dataOf(response);
      // The result of a write comes back from the idempotency executor with canonically sorted keys (the same for a replay).
      expect(Object.keys(created).sort()).toEqual([...ADDRESS_KEYS].sort());
      expect(created).toMatchObject({
        label: 'HOME',
        recipient_name: 'Nguyễn Văn A',
        contact_phone: '+84901234567',
        address_description: 'Tổ 5, phường Thục Phán, Cao Bằng',
        latitude: null,
        longitude: null,
        delivery_note: 'Gọi trước khi đến',
        is_default: true,
        version: 1,
      });
      expect(await customerRows(user.userId)).toBe(1);
      expect(await defaults(user.userId)).toBe(1);
      expect(await list(token)).toEqual([created]);
      expect(await auditCount(user.userId, CREATE_ACTION)).toBe(1);
    });

    it('M05-03: a second address without the default flag leaves the old default alone; the book lists the default first', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { label: 'OFFICE', address_description: 'Đường Hoàng Đình Giong, Cao Bằng' });
      expect(second.is_default).toBe(false);
      const book = await list(token);
      expect(book.map((a) => a.id)).toEqual([first.id, second.id]);
      expect(book.map((a) => a.is_default)).toEqual([true, false]);
      expect(await defaults(user.userId)).toBe(1);
    });

    it('a later address created with is_default true takes the default over atomically', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { label: 'OTHER', address_description: 'Xóm Nà Cạn, xã Hòa An', is_default: true });
      expect(second.is_default).toBe(true);
      const book = await list(token);
      expect(book.map((a) => a.id)).toEqual([second.id, first.id]);
      expect(await defaults(user.userId)).toBe(1);
    });

    it('stores a position only when both coordinates come, a different receiver phone is kept, and the number of addresses is not limited', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const pinned = await add(token, { latitude: 22.6657, longitude: 106.2522, contact_phone: '+84988777666', recipient_name: null });
      expect(pinned).toMatchObject({ latitude: 22.6657, longitude: 106.2522, contact_phone: '+84988777666', recipient_name: null });
      expect(pinned.contact_phone).not.toBe(user.phone.normalized);
      for (let index = 0; index < 24; index += 1) {
        await add(token, { address_description: `Địa chỉ số ${index}` });
      }
      expect(await addressRows(user.userId)).toBe(25);
      expect(await defaults(user.userId)).toBe(1);
    });

    it('M05-08: a missing or invalid phone or address, a half position or an identity field is refused and nothing is written', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      await add(token);
      const before = { addresses: await addressRows(user.userId), records: await recordCount(user.userId) };
      const without = (key: string) => Object.fromEntries(Object.entries(body()).filter(([name]) => name !== key));
      const withoutPhone = without('contact_phone');
      const withoutAddress = without('address_description');
      const cases: Array<[string, unknown, number, string]> = [
        ['no phone', withoutPhone, 400, 'BAD_REQUEST'],
        ['no address', withoutAddress, 400, 'BAD_REQUEST'],
        ['blank address', body({ address_description: '   ' }), 400, 'BAD_REQUEST'],
        ['bad phone', body({ contact_phone: '12345' }), 400, 'INVALID_PHONE'],
        ['bad label', body({ label: 'WORK' }), 400, 'BAD_REQUEST'],
        ['half position', body({ latitude: 22.5 }), 400, 'BAD_REQUEST'],
        ['position out of range', body({ latitude: 95, longitude: 106 }), 400, 'BAD_REQUEST'],
        ['customer_id', body({ customer_id: randomUUID() }), 400, 'BAD_REQUEST'],
        ['is_active', body({ is_active: false }), 400, 'BAD_REQUEST'],
      ];
      for (const [name, payload, status, code] of cases) {
        const response = await create(token, payload);
        expect([name, response.status, errorCode(response)]).toEqual([name, status, code]);
      }
      expect(await addressRows(user.userId)).toBe(before.addresses);
      expect(await recordCount(user.userId)).toBe(before.records);
    });
  });

  // ------------------------------------------------------------------------------------------ C — PATCH

  describe('C — PATCH /customers/me/addresses/:id', () => {
    it('changes only the fields sent, raises the version by exactly 1 and leaves one audit row without the address text', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const created = await add(token);
      const response = await patch(token, String(created.id), { expected_version: 1, delivery_note: 'Nhà màu xanh, cổng sắt', latitude: 22.5, longitude: 106.1 });
      expect(response.status).toBe(200);
      expect(Object.keys(dataOf(response)).sort()).toEqual([...ADDRESS_KEYS].sort());
      expect(dataOf(response)).toMatchObject({
        id: created.id,
        label: 'HOME',
        recipient_name: 'Nguyễn Văn A',
        address_description: 'Tổ 5, phường Thục Phán, Cao Bằng',
        delivery_note: 'Nhà màu xanh, cổng sắt',
        latitude: 22.5,
        longitude: 106.1,
        is_default: true,
        version: 2,
      });
      expect(await auditCount(user.userId, UPDATE_ACTION)).toBe(1);
      const audit = await app.pool.query<{ metadata: Record<string, unknown>; resource_type: string; resource_version: string }>(
        'SELECT metadata, resource_type, resource_version::text AS resource_version FROM app.audit_logs WHERE actor_id = $1 AND action = $2',
        [user.userId, UPDATE_ACTION],
      );
      expect(audit.rows[0]?.resource_type).toBe('customer_address');
      expect(audit.rows[0]?.resource_version).toBe('2');
      expect(Object.keys(audit.rows[0]?.metadata ?? {}).sort()).toEqual(['customer_id', 'from_version', 'is_default', 'to_version']);
      expect(JSON.stringify(audit.rows[0])).not.toContain('Thục Phán');
      expect(JSON.stringify(audit.rows[0])).not.toContain(token);
    });

    it('null clears the note, the receiver and the position; the phone and the address stay required', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const created = await add(token, { latitude: 22.5, longitude: 106.1 });
      const cleared = await patch(token, String(created.id), { expected_version: 1, delivery_note: null, recipient_name: null, latitude: null, longitude: null });
      expect(dataOf(cleared)).toMatchObject({ delivery_note: null, recipient_name: null, latitude: null, longitude: null, version: 2 });
      for (const payload of [{ address_description: null }, { address_description: '  ' }, { contact_phone: null }]) {
        const response = await patch(token, String(created.id), { expected_version: 2, ...payload });
        expect(response.status).toBe(400);
      }
      expect((await storedAddress(String(created.id))).version).toBe(2);
    });

    it('a stale version is VERSION_CONFLICT and changes nothing; an empty change, a half position and is_default false are refused', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const created = await add(token);
      expect((await patch(token, String(created.id), { expected_version: 1, label: 'OFFICE' })).status).toBe(200);
      const stale = await patch(token, String(created.id), { expected_version: 1, label: 'OTHER' });
      expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      for (const payload of [{ expected_version: 2 }, { expected_version: 2, latitude: 22 }, { expected_version: 2, is_default: false, label: 'HOME' }, { label: 'HOME' }]) {
        expect((await patch(token, String(created.id), payload)).status).toBe(400);
      }
      expect(dataOf((await listRaw(token))).addresses).toEqual([expect.objectContaining({ label: 'OFFICE', version: 2 })]);
    });

    it('M05-04: is_default true moves the default in the same commit and leaves exactly one', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Cơ quan' });
      const response = await patch(token, String(second.id), { expected_version: 1, is_default: true });
      expect(response.status).toBe(200);
      expect(dataOf(response)).toMatchObject({ id: second.id, is_default: true, version: 1 });
      expect((await storedAddress(String(first.id))).isDefault).toBe(false);
      expect(await defaults(user.userId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------ D — default

  describe('D — PUT /customers/me/addresses/:id/default', () => {
    it('M05-04: makes the address the only default, keeps the contents, and is a no-op on the current default', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Cơ quan' });
      const response = await makeDefault(token, String(second.id));
      expect(response.status).toBe(200);
      expect(Object.keys(dataOf(response)).sort()).toEqual([...ADDRESS_KEYS].sort());
      expect(dataOf(response)).toMatchObject({ id: second.id, is_default: true, version: 1, address_description: 'Cơ quan' });
      expect(await defaults(user.userId)).toBe(1);
      expect((await list(token)).map((a) => a.id)).toEqual([second.id, first.id]);
      const again = await makeDefault(token, String(second.id));
      expect(again.status).toBe(200);
      expect(await defaults(user.userId)).toBe(1);
      expect(await auditCount(user.userId, DEFAULT_ACTION)).toBe(2);
    });
  });

  // ------------------------------------------------------------------------------------------ E — delete

  describe('E — DELETE /customers/me/addresses/:id', () => {
    it('is a soft delete: the row stays inactive and never default, the book no longer lists it, a second delete is not found', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Cơ quan' });
      const response = await remove(token, String(second.id));
      expect(response.status).toBe(200);
      expect(dataOf(response)).toEqual({ id: second.id, deleted: true, default_address_id: null });
      expect(await storedAddress(String(second.id))).toEqual({ isActive: false, isDefault: false, version: 2, description: 'Cơ quan' });
      expect((await list(token)).map((a) => a.id)).toEqual([first.id]);
      const gone = await remove(token, String(second.id));
      expect([gone.status, errorCode(gone)]).toEqual([404, 'CUSTOMER_ADDRESS_NOT_FOUND']);
      expect((await patch(token, String(second.id), { expected_version: 2, label: 'OTHER' })).status).toBe(404);
      expect((await makeDefault(token, String(second.id))).status).toBe(404);
      expect(await auditCount(user.userId, DELETE_ACTION)).toBe(1);
    });

    it('M05-06: deleting the default makes the most recently updated active address the default; with none left there is no default', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token, { address_description: 'Một' });
      const second = await add(token, { address_description: 'Hai' });
      const third = await add(token, { address_description: 'Ba' });
      // The second address is edited last, so it is the most recently updated of the remaining ones.
      expect((await patch(token, String(second.id), { expected_version: 1, delivery_note: 'mới nhất' })).status).toBe(200);
      const response = await remove(token, String(first.id));
      expect(dataOf(response)).toEqual({ id: first.id, deleted: true, default_address_id: second.id });
      expect((await storedAddress(String(second.id))).isDefault).toBe(true);
      expect(await defaults(user.userId)).toBe(1);

      expect(dataOf(await remove(token, String(second.id))).default_address_id).toBe(third.id);
      expect(dataOf(await remove(token, String(third.id))).default_address_id).toBeNull();
      expect(await defaults(user.userId)).toBe(0);
      expect(await list(token)).toEqual([]);
      // The rows are kept: nothing was physically removed.
      expect(await addressRows(user.userId)).toBe(3);

      // A new address after an empty book is the default again.
      expect((await add(token)).is_default).toBe(true);
    });

    it('deleting a non-default address leaves the default alone', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Cơ quan' });
      expect(dataOf(await remove(token, String(second.id))).default_address_id).toBeNull();
      expect((await storedAddress(String(first.id))).isDefault).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------ F — ownership

  describe('F — M05-10: the address book of another account', () => {
    it('is never readable, changeable, deletable or selectable, and the answer reveals nothing', async () => {
      const mine = await newCustomer();
      const other = await newCustomer();
      const myToken = await clientLogin(mine);
      const otherToken = await clientLogin(other);
      const secret = await add(myToken, { address_description: 'Số 9 đường bí mật' });
      await add(otherToken, { address_description: 'Của người khác' });
      const id = String(secret.id);
      const before = await storedAddress(id);

      const attempts: Array<[string, ApiResponse]> = [
        ['patch', await patch(otherToken, id, { expected_version: 1, address_description: 'đã bị sửa' })],
        ['delete', await remove(otherToken, id)],
        ['default', await makeDefault(otherToken, id)],
      ];
      for (const [name, response] of attempts) {
        expect([name, response.status, errorCode(response)]).toEqual([name, 404, 'CUSTOMER_ADDRESS_NOT_FOUND']);
        expect(response.text).not.toContain('bí mật');
        expect(response.text).not.toContain(mine.userId);
      }
      expect(await storedAddress(id)).toEqual(before);
      expect((await list(otherToken)).map((a) => a.address_description)).toEqual(['Của người khác']);
      expect((await list(myToken)).map((a) => a.address_description)).toEqual(['Số 9 đường bí mật']);
      expect((await defaults(other.userId)) + (await defaults(mine.userId))).toBe(2);
    });

    it('an account that is not a customer, a malformed id and an unknown id all get the same refusal of the address', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      await add(token);
      for (const id of ['not-a-uuid', '../me', randomUUID(), '00000000-0000-0000-0000-000000000000']) {
        const [patched, deleted, defaulted] = [
          await patch(token, id, { expected_version: 1, label: 'OTHER' }),
          await remove(token, id),
          await makeDefault(token, id),
        ];
        for (const response of [patched, deleted, defaulted]) {
          expect([id, response.status, errorCode(response)]).toEqual([id, 404, 'CUSTOMER_ADDRESS_NOT_FOUND']);
        }
      }
      const stranger = await legacyAccount();
      const created = await create(await clientLogin(stranger), body());
      expect([created.status, errorCode(created)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(await customerRows(stranger.userId)).toBe(0);
    });

    it('takes no selector: a query string or a body on a GET, DELETE or default is refused', async () => {
      const user = await newCustomer();
      const other = await newCustomer();
      const token = await clientLogin(user);
      const created = await add(token);
      expect((await listRaw(token, `?customer_id=${randomUUID()}`)).status).toBe(400);
      expect((await listRaw(token, `?user_id=${other.userId}`)).status).toBe(400);
      expect((await app.call('DELETE', `/customers/me/addresses/${created.id}?customer_id=${randomUUID()}`, { bearer: token, headers: { 'idempotency-key': randomUUID() } })).status).toBe(400);
      expect((await app.call('PUT', `/customers/me/addresses/${created.id}/default`, { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { customer_id: randomUUID() } })).status).toBe(400);
      expect(await addressRows(user.userId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------ G — retries

  describe('G — M05-11: idempotency and retry', () => {
    it('a retry of the same create (same key, same body) answers the stored result and creates one address, one audit row, one record', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const key = randomUUID();
      const first = await create(token, body(), key);
      const retry = await create(token, body(), key);
      expect([first.status, retry.status]).toEqual([201, 201]);
      expect(dataOf(retry)).toEqual(dataOf(first));
      expect(await addressRows(user.userId)).toBe(1);
      expect(await auditCount(user.userId, CREATE_ACTION)).toBe(1);
      expect(await recordCount(user.userId)).toBe(1);
      // Another session of the same account may replay it as well.
      const replay = await create(await clientLogin(user), body(), key);
      expect(dataOf(replay)).toEqual(dataOf(first));
      expect(await addressRows(user.userId)).toBe(1);
    });

    it('the same key with a different body is IDEMPOTENCY_KEY_REUSED; a missing or malformed key is refused; nothing is written', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const key = randomUUID();
      expect((await create(token, body(), key)).status).toBe(201);
      const reused = await create(token, body({ address_description: 'Khác' }), key);
      expect([reused.status, errorCode(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      const missing = await create(token, body(), null);
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const malformed = await create(token, body(), 'x');
      expect([malformed.status, errorCode(malformed)]).toEqual([400, 'INVALID_IDEMPOTENCY_KEY']);
      expect(await addressRows(user.userId)).toBe(1);
    });

    it('every write needs the key, and a retry of an edit, a delete or a default switch applies once', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Cơ quan' });
      const id = String(first.id);

      expect(errorCode(await patch(token, id, { expected_version: 1, label: 'OFFICE' }, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(errorCode(await remove(token, id, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(errorCode(await makeDefault(token, String(second.id), null))).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const editKey = randomUUID();
      const edit = await patch(token, id, { expected_version: 1, label: 'OFFICE' }, editKey);
      const editAgain = await patch(token, id, { expected_version: 1, label: 'OFFICE' }, editKey);
      expect([edit.status, editAgain.status]).toEqual([200, 200]);
      expect(dataOf(editAgain)).toEqual(dataOf(edit));
      expect((await storedAddress(id)).version).toBe(2);

      const defaultKey = randomUUID();
      expect((await makeDefault(token, String(second.id), defaultKey)).status).toBe(200);
      expect((await makeDefault(token, String(second.id), defaultKey)).status).toBe(200);
      expect(await defaults(user.userId)).toBe(1);

      const deleteKey = randomUUID();
      const deleted = await remove(token, id, deleteKey);
      const deletedAgain = await remove(token, id, deleteKey);
      expect([deleted.status, deletedAgain.status]).toEqual([200, 200]);
      expect(dataOf(deletedAgain)).toEqual(dataOf(deleted));
      expect((await storedAddress(id)).version).toBe(3);
      expect(await auditCount(user.userId, DELETE_ACTION)).toBe(1);
    });

    it('a replay under a disabled account or a revoked session is refused, not served', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const key = randomUUID();
      expect((await create(token, body(), key)).status).toBe(201);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const disabled = await create(token, body(), key);
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');
      expect((await logout(token)).status).toBe(204);
      const revoked = await create(token, body(), key);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
      expect(await addressRows(user.userId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------ H — concurrency

  describe('H — M05-12: two devices at once', () => {
    it('two default switches at the same time leave exactly one default', async () => {
      const user = await newCustomer();
      const phoneToken = await clientLogin(user);
      const tabletToken = await clientLogin(user, { device_id: 'web-food-0002', platform: 'WEB', app: 'FOOD' });
      await add(phoneToken);
      const second = await add(phoneToken, { address_description: 'Hai' });
      const third = await add(phoneToken, { address_description: 'Ba' });
      const results = await Promise.all([makeDefault(phoneToken, String(second.id)), makeDefault(tabletToken, String(third.id))]);
      expect(results.map((response) => response.status)).toEqual([200, 200]);
      expect(await defaults(user.userId)).toBe(1);
      const book = await list(phoneToken);
      expect(book.filter((address) => address.is_default === true)).toHaveLength(1);
      expect(book[0]?.is_default).toBe(true);
    });

    it('many creates with is_default true at once, from a customer who has no address yet, give one customer and one default', async () => {
      const user = await newCustomer();
      const tokens = [await clientLogin(user), await clientLogin(user, { device_id: 'web-food-0002', platform: 'WEB', app: 'FOOD' })];
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) => create(tokens[index % 2] as string, body({ address_description: `Cùng lúc ${index}`, is_default: true }))),
      );
      expect(results.map((response) => response.status)).toEqual(Array(6).fill(201));
      expect(await customerRows(user.userId)).toBe(1);
      expect(await addressRows(user.userId)).toBe(6);
      expect(await defaults(user.userId)).toBe(1);
    });

    it('a delete of the default and a default switch at the same time never leave two defaults', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Hai' });
      await add(token, { address_description: 'Ba' });
      await Promise.all([remove(token, String(first.id)), makeDefault(token, String(second.id))]);
      expect(await defaults(user.userId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------ I — account state

  describe('I — a revoked, disabled or logged-out account keeps no access', () => {
    it('shows and changes nothing private after logout or when the account is disabled', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const created = await add(token);
      const before = await addressRows(user.userId);

      await setUserStatus(app.pool, user.userId, 'DISABLED');
      for (const response of [await me(token), await listRaw(token), await create(token, body()), await patch(token, String(created.id), { expected_version: 1, label: 'OTHER' }), await remove(token, String(created.id)), await makeDefault(token, String(created.id))]) {
        expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
        expect(response.text).not.toContain('Thục Phán');
      }
      await setUserStatus(app.pool, user.userId, 'ACTIVE');
      expect(await addressRows(user.userId)).toBe(before);
      expect((await storedAddress(String(created.id))).version).toBe(1);

      expect((await logout(token)).status).toBe(204);
      for (const response of [await me(token), await listRaw(token), await create(token, body())]) {
        expect([response.status, errorCode(response)]).toEqual([401, 'SESSION_REVOKED']);
        expect(response.text).not.toContain('Thục Phán');
      }
      // The data is still there for the next sign-in (what the phone shows after a restart comes from the server).
      expect((await list(await clientLogin(user))).map((a) => a.id)).toEqual([created.id]);
    });
  });

  // ------------------------------------------------------------------------------------------ J — rollback

  describe('J — all-or-nothing commit', () => {
    const faults = [
      { name: 'test_fault_cust_address', table: 'app.customer_addresses', condition: `NEW.address_description = 'FAULT M05'` },
      { name: 'test_fault_cust_customer', table: 'app.customers', condition: 'true' },
    ];

    for (const fault of faults) {
      it(`a failure of ${fault.table} rolls back the customer, the address, the audit rows and the record together; the same key then commits once`, async () => {
        const user = await newCustomer();
        const token = await clientLogin(user);
        const key = randomUUID();
        const payload = body({ address_description: 'FAULT M05' });

        await installFault(app.pool, fault.name, fault.table, 'INSERT', fault.condition);
        try {
          const response = await create(token, payload, key);
          expect(response.status).toBeGreaterThanOrEqual(500);
          expect(await customerRows(user.userId)).toBe(0);
          expect(await addressRows(user.userId)).toBe(0);
          expect(await auditCount(user.userId, CREATE_ACTION)).toBe(0);
          expect(await auditCount(user.userId, 'customer.create.v1')).toBe(0);
          expect(await recordCount(user.userId)).toBe(0);
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }

        const retry = await create(token, payload, key);
        expect(retry.status).toBe(201);
        expect(await addressRows(user.userId)).toBe(1);
        expect(await auditCount(user.userId, CREATE_ACTION)).toBe(1);
      });
    }

    it('a failed audit write rolls back an edit and a default switch', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const first = await add(token);
      const second = await add(token, { address_description: 'Hai' });
      await installFault(app.pool, 'test_fault_cust_audit', 'app.audit_logs', 'INSERT', `NEW.actor_id = '${user.userId}' AND NEW.action IN ('${UPDATE_ACTION}', '${DEFAULT_ACTION}')`);
      try {
        expect((await patch(token, String(first.id), { expected_version: 1, label: 'OFFICE' })).status).toBeGreaterThanOrEqual(500);
        expect((await makeDefault(token, String(second.id))).status).toBeGreaterThanOrEqual(500);
      } finally {
        await removeFault(app.pool, 'test_fault_cust_audit', 'app.audit_logs');
      }
      expect(await storedAddress(String(first.id))).toMatchObject({ version: 1, isDefault: true });
      expect(await storedAddress(String(second.id))).toMatchObject({ version: 1, isDefault: false });
      expect(await defaults(user.userId)).toBe(1);
    });
  });
});
