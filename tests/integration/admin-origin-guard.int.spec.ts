import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, errorCode, loginUser, registerUser, startAuthApp } from './support/auth-fixtures';

// M01-D-LOGIN - an administration-provisioned account is not an application account: it cannot use application
// login or an application session, while a phone-verified account keeps working exactly as before.
describe('M01-D-LOGIN - account origin guard in Auth Core', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps a phone-verified account working: login and /me answer as before', async () => {
    const user = await registerUser(app);
    const login = await loginUser(app, user);
    expect(login.status).toBe(200);
    const token = String((login.body.data as { access_token: string }).access_token);
    const me = await app.call('GET', '/auth/me', { bearer: token });
    expect(me.status).toBe(200);
  });

  it('an account that is switched to ADMIN_PROVISIONED fails application login like an unknown phone', async () => {
    const user = await registerUser(app);
    await app.pool.query(
      `UPDATE app.users SET account_origin = 'ADMIN_PROVISIONED', phone_verified_at = NULL WHERE user_id = $1::uuid`,
      [user.userId],
    );
    const login = await loginUser(app, user);
    expect(login.status).toBe(401);
    expect(errorCode(login)).toBe('INVALID_CREDENTIALS');
    const unknown = await loginUser(app, { phone: { ...user.phone, local: '0900000002' }, password: user.password });
    expect(unknown.status).toBe(401);
    expect(login.body.error?.message).toBe(unknown.body.error?.message);
  });

  it('an existing application session of an account that becomes ADMIN_PROVISIONED is invalid', async () => {
    const user = await registerUser(app);
    const before = await app.call('GET', '/auth/me', { bearer: user.accessToken });
    expect(before.status).toBe(200);
    await app.pool.query(
      `UPDATE app.users SET account_origin = 'ADMIN_PROVISIONED', phone_verified_at = NULL WHERE user_id = $1::uuid`,
      [user.userId],
    );
    const after = await app.call('GET', '/auth/me', { bearer: user.accessToken });
    expect(after.status).toBe(401);
    expect(errorCode(after)).toBe('SESSION_INVALID');
  });

  it('the database refuses an origin/verification pair that does not belong together', async () => {
    const user = await registerUser(app);
    await expect(
      app.pool.query(`UPDATE app.users SET account_origin = 'ADMIN_PROVISIONED' WHERE user_id = $1::uuid`, [user.userId]),
    ).rejects.toThrow();
    await expect(
      app.pool.query(`UPDATE app.users SET phone_verified_at = NULL WHERE user_id = $1::uuid`, [user.userId]),
    ).rejects.toThrow();
    await expect(
      app.pool.query(`UPDATE app.users SET account_origin = 'SOMETHING_ELSE' WHERE user_id = $1::uuid`, [user.userId]),
    ).rejects.toThrow();
  });
});
