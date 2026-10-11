import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  dataOf,
  errorCode,
  grantRole,
  grantStrayRole,
  loginUser,
  registerUser,
  Registered,
  startAuthApp,
} from './support/auth-fixtures';

// M01.02 — legacy regression. The CUSTOMER storage role, the customer profile and a consent row are new data next to
// the legacy accounts. None of them may change what the legacy /auth routes say: register and login keep their exact
// keys, /auth/me never lists CUSTOMER, and role selection still knows only SHOP and DRIVER.

describe('M01.02 — legacy /auth API with a CUSTOMER row present', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/auth/me', { bearer: token });
  const select = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });

  /** The three rows M01.02 adds for an ordinary customer, written directly (the participant has no HTTP route). */
  async function addCustomerRows(userId: string): Promise<void> {
    await grantStrayRole(app.pool, userId, 'CUSTOMER');
    await app.pool.query('INSERT INTO app.customer_profiles (user_id) VALUES ($1::uuid)', [userId]);
    await app.pool.query(
      `INSERT INTO app.user_consents (id, user_id, terms_version, privacy_version, accepted_at, client_app)
       VALUES (gen_random_uuid(), $1::uuid, 'terms-1', 'privacy-1', clock_timestamp(), 'FOOD')`,
      [userId],
    );
  }

  async function customerRowCounts(userId: string): Promise<[number, number, number]> {
    const result = await app.pool.query<{ r: string; p: string; c: string }>(
      `SELECT (SELECT count(*) FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER') AS r,
              (SELECT count(*) FROM app.customer_profiles WHERE user_id = $1::uuid) AS p,
              (SELECT count(*) FROM app.user_consents WHERE user_id = $1::uuid) AS c`,
      [userId],
    );
    const row = result.rows[0] as { r: string; p: string; c: string };
    return [Number(row.r), Number(row.p), Number(row.c)];
  }

  async function customerUser(): Promise<Registered> {
    const user = await registerUser(app);
    await addCustomerRows(user.userId);
    return user;
  }

  it('register keeps its exact response and creates no customer row by itself', async () => {
    const user = await registerUser(app);
    const data = dataOf(user.response);
    expect(user.response.status).toBe(201);
    expect(Object.keys(data).sort()).toEqual([
      'access_token',
      'active_role',
      'available_roles',
      'onboarding_required',
      'phone_normalized',
      'user_id',
    ]);
    expect(data.available_roles).toEqual([]);
    expect(data.active_role).toBeNull();
    expect(data.onboarding_required).toBe(true);
    expect(await customerRowCounts(user.userId)).toEqual([0, 0, 0]);
  });

  it('login keeps its exact keys and values for an account that holds CUSTOMER', async () => {
    const user = await customerUser();
    const response = await loginUser(app, user);
    expect(response.status).toBe(200);
    const data = dataOf(response);
    expect(Object.keys(data).sort()).toEqual([
      'access_token',
      'active_role',
      'available_roles',
      'onboarding_required',
      'role_selection_required',
      'user_id',
    ]);
    expect(data.user_id).toBe(user.userId);
    expect(data.available_roles).toEqual([]);
    expect(data.active_role).toBeNull();
    expect(data.onboarding_required).toBe(true);
    expect(data.role_selection_required).toBe(false);
  });

  it('/auth/me never lists CUSTOMER and keeps its documented shape', async () => {
    const user = await customerUser();
    const response = await me(user.accessToken);
    expect(response.status).toBe(200);
    expect(dataOf(response)).toEqual({
      user_id: user.userId,
      phone_normalized: user.phone.normalized,
      available_roles: [],
      active_role: null,
      onboarding_required: true,
      role_selection_required: false,
      onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
    });
  });

  it('role selection still refuses CUSTOMER and the SHOP_OWNER alias with ROLE_NOT_AVAILABLE', async () => {
    const user = await customerUser();
    for (const role of ['CUSTOMER', 'customer', 'SHOP_OWNER']) {
      const response = await select(user.accessToken, role);
      expect([role, response.status, errorCode(response)]).toEqual([role, 403, 'ROLE_NOT_AVAILABLE']);
    }
    expect(dataOf(await me(user.accessToken)).active_role).toBeNull();
    expect(await customerRowCounts(user.userId)).toEqual([1, 1, 1]);
  });

  it('SHOP next to CUSTOMER: available_roles is [SHOP] and selecting SHOP works', async () => {
    const user = await customerUser();
    await grantRole(app.pool, user.userId, 'SHOP');
    const data = dataOf(await me(user.accessToken));
    expect(data.available_roles).toEqual(['SHOP']);
    expect(data.role_selection_required).toBe(true);
    expect(data.onboarding_required).toBe(false);

    const selected = await select(user.accessToken, 'SHOP');
    expect(selected.status).toBe(200);
    expect(dataOf(await me(user.accessToken)).active_role).toBe('SHOP');
    expect(await customerRowCounts(user.userId)).toEqual([1, 1, 1]);
  });

  it('DRIVER next to CUSTOMER: available_roles is [DRIVER] and selecting DRIVER works', async () => {
    const user = await customerUser();
    await grantRole(app.pool, user.userId, 'DRIVER');
    expect(dataOf(await me(user.accessToken)).available_roles).toEqual(['DRIVER']);

    const selected = await select(user.accessToken, 'DRIVER');
    expect(selected.status).toBe(200);
    expect(dataOf(await me(user.accessToken)).active_role).toBe('DRIVER');
  });

  it('SHOP and DRIVER next to CUSTOMER: available_roles is exactly [DRIVER, SHOP]', async () => {
    const user = await customerUser();
    await grantRole(app.pool, user.userId, 'SHOP');
    await grantRole(app.pool, user.userId, 'DRIVER');
    const login = dataOf(await loginUser(app, user));
    expect(login.available_roles).toEqual(['DRIVER', 'SHOP']);
    expect(login.role_selection_required).toBe(true);
    expect(login.onboarding_required).toBe(false);
  });
});
