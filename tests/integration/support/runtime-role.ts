import { TransactionContext } from '../../../apps/backend/src/transaction/transaction-context';
import { TransactionManager } from '../../../apps/backend/src/transaction/transaction-manager';
import { ALLOWED_TEST_USER } from './assert-test-target';
import { AuthApp } from './auth-fixtures';

// Runtime-privilege simulation for integration tests.
// The CI test role OWNS the tables, so it bypasses every GRANT and a lock or write that the runtime role may not perform would pass here.
// asRuntimeRole() replaces the owner's own privileges on one table with the runtime matrix from ops/selfhosted/02-runtime-grants.sql for the
// duration of a transaction that is then ROLLED BACK. Limits: the owner stands in for the runtime role (no separate login), and foreign-key
// checks run with the referenced table owner's privileges, so a work that needs an FK check on the restricted table is not representative.

class RollbackOnly extends Error {}

/** Runs `work` in a transaction that is always rolled back. Errors from `work` propagate. */
export async function rolledBack<T>(app: AuthApp, work: (context: TransactionContext) => Promise<T>): Promise<T> {
  const transactions = app.running.app.get(TransactionManager);
  let result: T | undefined;
  try {
    await transactions.withTransaction(async (context) => {
      result = await work(context);
      throw new RollbackOnly('rolled back');
    });
  } catch (error) {
    if (!(error instanceof RollbackOnly)) throw error;
  }
  return result as T;
}

/** `grants` is the exact runtime privilege list for `table` (e.g. 'SELECT, INSERT'), taken from 02-runtime-grants.sql. */
export function asRuntimeRole<T>(app: AuthApp, table: string, grants: string, work: (context: TransactionContext) => Promise<T>): Promise<T> {
  return rolledBack(app, async (context) => {
    await context.query(`REVOKE ALL ON ${table} FROM ${ALLOWED_TEST_USER}`);
    await context.query(`GRANT ${grants} ON ${table} TO ${ALLOWED_TEST_USER}`);
    return work(context);
  });
}
