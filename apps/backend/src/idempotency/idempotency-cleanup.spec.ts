import { describe, expect, it } from '@jest/globals';
import { QueryRows, TransactionContext } from '../transaction/transaction-context';
import {
  DEFAULT_CLEANUP_BATCH_SIZE,
  IdempotencyCleanup,
  MAX_CLEANUP_BATCH_SIZE,
} from './idempotency-cleanup';
import { TransactionRunner } from './idempotency-executor';

interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

function scripted(claimed: string[], affected: number | null) {
  const statements: Statement[] = [];
  let transactions = 0;
  const runner: TransactionRunner = {
    withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => {
      transactions += 1;
      const context: TransactionContext = {
        isActive: true,
        query: async <R extends object = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ): Promise<QueryRows<R>> => {
          statements.push({ text, values });
          if (text.trimStart().startsWith('SELECT')) {
            return { rows: claimed.map((id) => ({ record_id: id })) as unknown as R[], rowCount: claimed.length };
          }
          return { rows: [], rowCount: affected };
        },
      };
      return work(context);
    },
  };
  return { runner, statements, transactions: () => transactions };
}

const ID = '0b8f4c2e-1d7a-4c35-9a52-6c1c9a7f2a11';

describe('IdempotencyCleanup', () => {
  it('has the documented batch bounds', () => {
    expect(DEFAULT_CLEANUP_BATCH_SIZE).toBe(100);
    expect(MAX_CLEANUP_BATCH_SIZE).toBe(1000);
  });

  for (const bad of [0, -1, 1.5, 1001, Number.NaN]) {
    it(`refuses batch size ${bad} before any transaction`, async () => {
      const db = scripted([], 0);
      const cleanup = new IdempotencyCleanup(db.runner);
      await expect(cleanup.clearExpiredReplay(bad)).rejects.toBeInstanceOf(RangeError);
      await expect(cleanup.deleteExpiredRecords(bad)).rejects.toBeInstanceOf(RangeError);
      await expect(cleanup.runOnce(bad)).rejects.toBeInstanceOf(RangeError);
      expect(db.transactions()).toBe(0);
    });
  }

  it('clear phase: claims with SKIP LOCKED, rechecks the eligibility on the locked rows and keeps the row', async () => {
    const db = scripted([ID], 1);
    const cleared = await new IdempotencyCleanup(db.runner).clearExpiredReplay(5);
    expect(cleared).toBe(1);
    expect(db.statements).toHaveLength(2);
    const [claim, update] = db.statements as [Statement, Statement];
    expect(claim.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim.text).toContain('LIMIT $1');
    expect(claim.text).toContain('replay_expires_at <= clock_timestamp()');
    expect(claim.values).toEqual([5]);
    expect(update.text).toContain('UPDATE app.idempotency_records');
    expect(update.text).toContain('replay_ciphertext = NULL');
    expect(update.text).toContain('replay_expires_at <= clock_timestamp()');
    expect(update.text).not.toContain('DELETE');
    expect(update.values).toEqual([[ID]]);
  });

  it('delete phase: claims with SKIP LOCKED and rechecks the dedupe expiry before deleting', async () => {
    const db = scripted([ID], 1);
    const deleted = await new IdempotencyCleanup(db.runner).deleteExpiredRecords(7);
    expect(deleted).toBe(1);
    const [claim, del] = db.statements as [Statement, Statement];
    expect(claim.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim.text).toContain('dedupe_expires_at <= clock_timestamp()');
    expect(del.text).toContain('DELETE FROM app.idempotency_records');
    expect(del.text).toContain('dedupe_expires_at <= clock_timestamp()');
    expect(del.values).toEqual([[ID]]);
  });

  it('does nothing further when nothing is claimed', async () => {
    const db = scripted([], 0);
    const cleanup = new IdempotencyCleanup(db.runner);
    expect(await cleanup.clearExpiredReplay()).toBe(0);
    expect(await cleanup.deleteExpiredRecords()).toBe(0);
    expect(db.statements).toHaveLength(2);
  });

  it('never takes an advisory lock and never touches a non-idempotency table', async () => {
    const db = scripted([ID], 1);
    await new IdempotencyCleanup(db.runner).runOnce();
    for (const statement of db.statements) {
      expect(statement.text).not.toContain('advisory');
      expect(statement.text).toContain('app.idempotency_records');
    }
  });

  it('runOnce runs the clear phase and then the delete phase, each in its own transaction', async () => {
    const db = scripted([ID], 1);
    const result = await new IdempotencyCleanup(db.runner).runOnce(10);
    expect(result).toEqual({ replayCleared: 1, recordsDeleted: 1 });
    expect(db.transactions()).toBe(2);
    expect(db.statements[1]?.text).toContain('UPDATE');
    expect(db.statements[3]?.text).toContain('DELETE');
  });

  it('counts only rows the recheck still matched', async () => {
    const db = scripted([ID], 0);
    expect(await new IdempotencyCleanup(db.runner).clearExpiredReplay()).toBe(0);
  });
});
