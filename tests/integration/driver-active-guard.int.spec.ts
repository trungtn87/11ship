import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { DriverActiveGuard } from '../../apps/backend/src/driver/driver-active-guard';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { AuthApp, createDriverFor, registerUser, startAuthApp } from './support/auth-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M01-A2D F2 — the REAL DriverActiveGuard against REAL PostgreSQL rows, called inside a REAL M00 transaction
// (TransactionManager.withTransaction -> TransactionContext). Nothing is faked: no stubbed query result, and no
// HTTP endpoint exposes the guard. The Driver rows are written by the fixture exactly as A2D leaves them.
describe('M01-A2D — DriverActiveGuard on PostgreSQL (A03-30)', () => {
  let app: AuthApp;
  let manager: TransactionManager;
  const guard = new DriverActiveGuard();

  beforeAll(async () => {
    app = await startAuthApp();
    manager = managerFor(poolClientSource(app.pool));
  });

  afterAll(async () => {
    await app.close();
  });

  const guardFor = (userId: string): Promise<{ driverId: string }> =>
    manager.withTransaction((context) => guard.requireDriverActive(context, userId));

  async function codeOf(userId: string): Promise<string> {
    try {
      await guardFor(userId);
      return 'OK';
    } catch (error) {
      return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
    }
  }

  it('ACTIVE resolves with the id of THAT user\'s Driver row (not another user\'s)', async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    const driverId = await createDriverFor(app.pool, user.userId, { status: 'ACTIVE' });
    const otherId = await createDriverFor(app.pool, other.userId, { status: 'ACTIVE' });
    expect(driverId).not.toBe(otherId);

    expect(await guardFor(user.userId)).toEqual({ driverId });
    expect(await guardFor(other.userId)).toEqual({ driverId: otherId });
  });

  it('PENDING is DRIVER_PENDING_APPROVAL', async () => {
    const user = await registerUser(app);
    await createDriverFor(app.pool, user.userId, { status: 'PENDING' });
    expect(await codeOf(user.userId)).toBe('DRIVER_PENDING_APPROVAL');
  });

  for (const status of ['SUSPENDED', 'CLOSING', 'CLOSED']) {
    it(`${status} is ROLE_NOT_AVAILABLE`, async () => {
      const user = await registerUser(app);
      await createDriverFor(app.pool, user.userId, { status });
      expect(await codeOf(user.userId)).toBe('ROLE_NOT_AVAILABLE');
    });
  }

  it('a user without a Driver profile is ROLE_NOT_AVAILABLE', async () => {
    const user = await registerUser(app);
    expect(await codeOf(user.userId)).toBe('ROLE_NOT_AVAILABLE');
  });

  it('decides from the row at call time: the same user moves PENDING -> ACTIVE -> SUSPENDED and the answer follows', async () => {
    const user = await registerUser(app);
    const driverId = await createDriverFor(app.pool, user.userId, { status: 'PENDING' });
    expect(await codeOf(user.userId)).toBe('DRIVER_PENDING_APPROVAL');

    await app.pool.query("UPDATE app.drivers SET status = 'ACTIVE', updated_at = clock_timestamp() WHERE driver_id = $1::uuid", [driverId]);
    expect(await guardFor(user.userId)).toEqual({ driverId });

    await app.pool.query(
      "UPDATE app.drivers SET status = 'SUSPENDED', accepting_deliveries = false, updated_at = clock_timestamp() WHERE driver_id = $1::uuid",
      [driverId],
    );
    expect(await codeOf(user.userId)).toBe('ROLE_NOT_AVAILABLE');
  });

  it('is a pure read: the Driver row is byte-for-byte unchanged afterwards', async () => {
    const user = await registerUser(app);
    const driverId = await createDriverFor(app.pool, user.userId, { status: 'ACTIVE' });
    const before = await app.pool.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [driverId]);

    await guardFor(user.userId);

    const after = await app.pool.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [driverId]);
    expect(after.rows).toEqual(before.rows);
  });
});
