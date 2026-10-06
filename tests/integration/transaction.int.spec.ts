import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { createPool } from '../../apps/backend/src/database/create-pool';
import { JsonLogger } from '../../apps/backend/src/logging/json-logger';
import { loadIntegrationConfig } from './support/test-helpers';

// F04 — commit/rollback on ONE PoolClient held for the whole transaction. Atomicity is never
// tested through separate pool.query calls, which may run on different connections.
describe('F04 — transactions on a single PoolClient', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(
      loadIntegrationConfig().database,
      new JsonLogger(() => undefined),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('F04a: BEGIN, INSERT into a temp table, COMMIT, SELECT on the same client finds the row', async () => {
    const table = `tx_commit_${randomBytes(4).toString('hex')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE TEMP TABLE ${table} (id integer PRIMARY KEY, note text NOT NULL)`);

      await client.query('BEGIN');
      await client.query(`INSERT INTO ${table} (id, note) VALUES ($1, $2)`, [1, 'committed']);
      await client.query('COMMIT');

      const result = await client.query<{ id: number; note: string }>(
        `SELECT id, note FROM ${table} WHERE id = $1`,
        [1],
      );
      expect(result.rows).toEqual([{ id: 1, note: 'committed' }]);

      await client.query(`DROP TABLE ${table}`);
    } finally {
      client.release();
    }
  });

  it('F04b: an error inside the transaction followed by ROLLBACK leaves no new row and releases the client', async () => {
    const table = `tx_rollback_${randomBytes(4).toString('hex')}`;
    const client = await pool.connect();
    let failureCode: string | undefined;
    let rowsAfterRollback: Array<{ id: number }> = [];

    try {
      await client.query(`CREATE TEMP TABLE ${table} (id integer PRIMARY KEY, note text NOT NULL)`);
      await client.query(`INSERT INTO ${table} (id, note) VALUES ($1, $2)`, [1, 'baseline']);

      await client.query('BEGIN');
      await client.query(`INSERT INTO ${table} (id, note) VALUES ($1, $2)`, [2, 'in-flight']);
      try {
        // Deliberate failure: duplicate primary key.
        await client.query(`INSERT INTO ${table} (id, note) VALUES ($1, $2)`, [1, 'duplicate']);
      } catch (error) {
        failureCode = (error as { code?: string }).code;
      }
      await client.query('ROLLBACK');

      const result = await client.query<{ id: number }>(`SELECT id FROM ${table} ORDER BY id`);
      rowsAfterRollback = result.rows;

      await client.query(`DROP TABLE ${table}`);
    } finally {
      client.release();
    }

    expect(failureCode).toBe('23505');
    // The in-flight row (id 2) is gone; only the baseline row from before BEGIN remains.
    expect(rowsAfterRollback).toEqual([{ id: 1 }]);

    // The client went back to the pool: nothing is checked out and nobody is waiting.
    expect(pool.totalCount - pool.idleCount).toBe(0);
    expect(pool.waitingCount).toBe(0);

    const probe = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(probe.rows[0]?.ok).toBe(1);
  });
});
