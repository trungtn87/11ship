import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { CommissionPolicyRepository } from '../../apps/backend/src/wallet/commission-policy-repository';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { AuthApp, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, Customer, newCustomer, PRIVACY, TERMS } from './support/m10-fixtures';
import { asRuntimeRole, rolledBack } from './support/runtime-role';

// M04-C: the SYSTEM commission change (admin-finance-read-service.changeCommission) runs under the RUNTIME privileges of ship11_app:
// app.wallet_commission_policies has SELECT, INSERT only (ops/selfhosted/02-runtime-grants.sql). Before the fix, lockCurrent took FOR UPDATE
// and the guard trigger took LOCK TABLE ... SHARE ROW EXCLUSIVE; both need UPDATE, so the change failed with "permission denied" on the VPS.
// The CI test role OWNS the table and would hide that, so each runtime case below replaces the owner's privileges with the runtime matrix.
// Limit (support/runtime-role.ts): the transaction is rolled back and changeCommission opens its own transaction, so the HTTP route itself
// is not wrapped; this suite runs the same repository SQL that changeCommission calls, in the same order, under the runtime matrix.

const TABLE = 'app.wallet_commission_policies';
const RUNTIME_GRANTS = 'SELECT, INSERT';
const COMMISSION_AMOUNT = 2_000;

describe('M04-C commission policy under the runtime privileges (advisory lock, no UPDATE grant)', () => {
  let app: AuthApp;
  let actor: Customer;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    actor = await newCustomer(app, 'SYSTEM admin commission');
  });

  afterAll(async () => {
    try {
      // The table is append-only: remove only the versions this suite added, with the guard trigger disabled as the m07 suite does.
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`ALTER TABLE ${TABLE} DISABLE TRIGGER wallet_commission_policies_append_only`);
        await client.query(`DELETE FROM ${TABLE} WHERE policy_version > 1`);
        await client.query(`ALTER TABLE ${TABLE} ENABLE TRIGGER wallet_commission_policies_append_only`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await cleanupOrders(app, { shopIds: [], customerIds: [actor.userId], drivers: [], userIds: [actor.userId] });
    } finally {
      await app.close();
    }
  });

  const policies = (): CommissionPolicyRepository => app.running.app.get(CommissionPolicyRepository);
  const transactions = (): TransactionManager => app.running.app.get(TransactionManager);

  /** The changeCommission write path, minus the admin checks and audit/outbox (none of them touches this table). */
  async function changeLikeCommission(context: Parameters<Parameters<TransactionManager['withTransaction']>[0]>[0], expectedVersion: number, amount: number): Promise<number> {
    const current = await policies().lockCurrent(context);
    if (current.version !== expectedVersion) {
      throw new AppError('COMMISSION_POLICY_VERSION_CONFLICT');
    }
    const next = await policies().insertNext(context, current.version + 1, amount, actor.userId);
    return next.version;
  }

  it('(a) the current policy is locked and the next version appended with the runtime privileges (SELECT, INSERT only)', async () => {
    const outcome = await asRuntimeRole(app, TABLE, RUNTIME_GRANTS, async (context) => {
      const before = await policies().lockCurrent(context);
      const version = await changeLikeCommission(context, before.version, COMMISSION_AMOUNT);
      return { before: before.version, version };
    });
    expect(outcome).toEqual({ before: 1, version: 2 });
  });

  it('(b) a direct insert of the next version passes the guard trigger with the runtime privileges (the trigger takes no table lock)', async () => {
    const version = await asRuntimeRole(app, TABLE, RUNTIME_GRANTS, async (context) => {
      const inserted = await policies().insertNext(context, 2, COMMISSION_AMOUNT, actor.userId);
      return inserted.version;
    });
    expect(version).toBe(2);
  });

  it('(c) a version that is not last + 1 is refused by the guard itself, under the owner and under the runtime privileges', async () => {
    const refusedByOwner = rolledBack(app, (context) => policies().insertNext(context, 5, COMMISSION_AMOUNT, actor.userId)).then(
      () => undefined,
      (caught: unknown) => (caught as Error).message,
    );
    expect(await refusedByOwner).toMatch(/WALLET_COMMISSION_POLICY_VERSION_CONFLICT/);

    const refusedByRuntime = asRuntimeRole(app, TABLE, RUNTIME_GRANTS, (context) => policies().insertNext(context, 5, COMMISSION_AMOUNT, actor.userId)).then(
      () => undefined,
      (caught: unknown) => (caught as Error).message,
    );
    expect(await refusedByRuntime).toMatch(/WALLET_COMMISSION_POLICY_VERSION_CONFLICT/);
  });

  it('(d) UPDATE and DELETE of a policy row are refused under the owner (append-only) and under the runtime privileges (no UPDATE/DELETE grant)', async () => {
    await expect(rolledBack(app, (context) => context.query(`UPDATE ${TABLE} SET commission_vnd = 5 WHERE policy_version = 1`))).rejects.toThrow(/append-only/);
    await expect(rolledBack(app, (context) => context.query(`DELETE FROM ${TABLE} WHERE policy_version = 1`))).rejects.toThrow(/append-only/);
    await expect(asRuntimeRole(app, TABLE, RUNTIME_GRANTS, (context) => context.query(`UPDATE ${TABLE} SET commission_vnd = 5 WHERE policy_version = 1`))).rejects.toThrow(/permission denied/);
    await expect(asRuntimeRole(app, TABLE, RUNTIME_GRANTS, (context) => context.query(`DELETE FROM ${TABLE} WHERE policy_version = 1`))).rejects.toThrow(/permission denied/);
  });

  it('(e) two concurrent changes made from the same version: exactly one appends version N+1, the other is refused, and no version is skipped or duplicated', async () => {
    const [before] = await rolledBack(app, async (context) => [await policies().lockCurrent(context)]);
    const expected = before?.version ?? 0;
    const tm = transactions();
    const results = await Promise.allSettled([
      tm.withTransaction((context) => changeLikeCommission(context, expected, COMMISSION_AMOUNT + 1)),
      tm.withTransaction((context) => changeLikeCommission(context, expected, COMMISSION_AMOUNT + 2)),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]?.reason as AppError).code).toBe('COMMISSION_POLICY_VERSION_CONFLICT');

    const versions = await app.pool.query<{ policy_version: number }>(`SELECT policy_version FROM ${TABLE} ORDER BY policy_version`);
    const numbers = versions.rows.map((row) => Number(row.policy_version));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
    expect(numbers[numbers.length - 1]).toBe(expected + 1);
  });

  it('(f) two concurrent raw inserts of the same version: the guard serialises them, so the loser gets the guard refusal (not a duplicate-key error)', async () => {
    const target = (await app.pool.query<{ n: number }>(`SELECT MAX(policy_version)::int + 1 AS n FROM ${TABLE}`)).rows[0]?.n ?? 0;
    const tm = transactions();
    const results = await Promise.allSettled([
      tm.withTransaction((context) => policies().insertNext(context, target, COMMISSION_AMOUNT + 3, actor.userId)),
      tm.withTransaction((context) => policies().insertNext(context, target, COMMISSION_AMOUNT + 4, actor.userId)),
    ]);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0]?.reason as Error).message)).toMatch(/WALLET_COMMISSION_POLICY_VERSION_CONFLICT/);
  });
});
