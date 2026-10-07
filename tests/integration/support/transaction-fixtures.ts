import { Pool } from 'pg';
import { DatabaseConfig } from '../../../apps/backend/src/config/app-config';
import { createPool } from '../../../apps/backend/src/database/create-pool';
import { JsonLogger } from '../../../apps/backend/src/logging/json-logger';
import { poolClientSource } from '../../../apps/backend/src/transaction/pg-client-source';
import { QueryRows } from '../../../apps/backend/src/transaction/transaction-context';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
} from '../../../apps/backend/src/transaction/transaction-manager';
import { eventually } from './async-helpers';

export function testPool(base: DatabaseConfig, overrides: Partial<DatabaseConfig> = {}): Pool {
  return createPool(
    {
      ...base,
      poolMax: 4,
      connectTimeoutMs: 1000,
      queryTimeoutMs: 6000,
      statementTimeoutMs: 5000,
      ...overrides,
    },
    new JsonLogger(() => undefined),
  );
}

export function managerFor(
  source: TransactionClientSource,
  overrides: { timeoutMs?: number; idleInTransactionTimeoutMs?: number } = {},
): TransactionManager {
  return new TransactionManager(source, {
    timeoutMs: 10_000,
    idleInTransactionTimeoutMs: 5_000,
    ...overrides,
  });
}

export type Fault = (text: string, real: TransactionClient) => Promise<QueryRows> | undefined;

export interface FaultySource extends TransactionClientSource {
  /** One entry per released connection: true when it was destroyed instead of returned. */
  readonly released: boolean[];
  readonly acquired: () => number;
}

/**
 * Wraps the REAL pool. Only the statement named by `fault` is intercepted (to model an
 * acknowledgement lost on the network, a refused BEGIN or a failing ROLLBACK, which a healthy server
 * does not produce on demand). Everything else still goes to PostgreSQL.
 */
export function faultySource(pool: Pool, fault: Fault): FaultySource {
  const inner = poolClientSource(pool);
  const released: boolean[] = [];
  let acquiredCount = 0;
  return {
    released,
    acquired: () => acquiredCount,
    async acquire(): Promise<TransactionClient> {
      const real = await inner.acquire();
      acquiredCount += 1;
      return {
        query: (text, values) => fault(text, real) ?? real.query(text, values),
        release: (destroy) => {
          released.push(destroy === true);
          real.release(destroy);
        },
        onError: (listener) => real.onError(listener),
      };
    },
  };
}

export async function backendIsGone(pool: Pool, pid: number): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid]);
  return result.rowCount === 0;
}

/** Nothing checked out, nobody waiting, and the pool still answers queries. */
export async function expectPoolRecovered(pool: Pool): Promise<void> {
  await eventually(
    () => Promise.resolve(pool.totalCount - pool.idleCount === 0 && pool.waitingCount === 0),
    'pool has no checked-out clients',
  );
  const probe = await pool.query<{ ok: number }>('SELECT 1 AS ok');
  if (probe.rows[0]?.ok !== 1) {
    throw new Error('pool does not answer queries after the fault');
  }
}
