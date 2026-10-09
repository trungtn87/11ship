import { Pool } from 'pg';
import { eventually } from './async-helpers';

// Fixtures that let a TEST hold a PostgreSQL row lock on its own connection, so a request under test is forced to wait
// for it. The order of events is decided by the test (hold -> send -> wait until the request is really blocked ->
// let the time pass -> release), never by sleeping and hoping. The holder only locks; it never modifies the row, which
// is exactly the case where PostgreSQL does not re-evaluate anything for the waiter once the lock is granted.

export interface HeldLock {
  /** Ends the holding transaction with COMMIT. The locked row is unchanged. Safe to call more than once. */
  release(): Promise<void>;
}

/** Starts a transaction on a dedicated connection and runs a `SELECT ... FOR UPDATE|SHARE` that must match one row. */
export async function holdRowLock(pool: Pool, lockSql: string, values: unknown[]): Promise<HeldLock> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(lockSql, values);
    if (locked.rowCount !== 1) {
      throw new Error(`the lock statement matched ${String(locked.rowCount)} rows, expected exactly 1`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw error;
  }
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    },
  };
}

/** Waits until at least `minimum` backends of this database are blocked on a lock (the request under test is waiting). */
export async function waitForBlockedBackends(pool: Pool, minimum = 1): Promise<void> {
  await eventually(
    async () => {
      const result = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      return Number(result.rows[0]?.n ?? '0') >= minimum;
    },
    `${String(minimum)} backend(s) waiting for a lock`,
    6000,
  );
}

/**
 * Waits until the DATABASE clock is past the instant returned by `instantSql` (a scalar timestamptz query). The
 * database clock is the one the application decides expiry with, so the test uses no clock of its own.
 */
export async function waitUntilDbClockPast(pool: Pool, instantSql: string, values: unknown[]): Promise<void> {
  await eventually(
    async () => {
      const result = await pool.query<{ past: boolean }>(`SELECT clock_timestamp() > (${instantSql}) AS past`, values);
      return result.rows[0]?.past === true;
    },
    'the database clock to pass the credential expiry',
    10_000,
  );
}
