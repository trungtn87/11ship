import { randomInt, randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { PoolClient } from 'pg';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { readSepayConfig } from '../../apps/backend/src/sepay/sepay-config';
import { parseSepayEvent, SepayTransferEvent } from '../../apps/backend/src/sepay/sepay-event';
import { SepaySettlementRepository } from '../../apps/backend/src/sepay/sepay-settlement-repository';
import { SepaySettlementService } from '../../apps/backend/src/sepay/sepay-settlement-service';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { loadIntegrationConfig } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// M04 SePay, two REAL connections (Codex 2026-11-22, finding 5). The settlement runs on two database connections at once and the second waits on
// the first one's unique key, exactly as two real deliveries (webhook, reconciliation read) would. The fixture is evidence only: the switch is OFF,
// so nothing is credited, no money row is written, and no other suite can see a count change. Every transaction ends with COMMIT or ROLLBACK
// of its own; the inbox rows that the first connection commits stay (the inbox never deletes rows, by design) and carry random ids.
// NOT covered here (and why): the race of a credit on two connections (webhook + reconciliation + Administrator). A committed credit would leave
// ledger and topup rows that other suites count globally, so that race is not proven by this file; it stays open and is reported in the PR.

const SECRET = 'two-connections-not-a-real-secret';

function eventFrom(raw: Record<string, unknown>): SepayTransferEvent {
  const event = parseSepayEvent(raw);
  if (event === undefined) throw new Error('fixture is not a valid SePay payload');
  return event;
}

function contextOf(connection: PoolClient): TransactionContext {
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params as unknown[]) } as unknown as TransactionContext;
}

describe('M04 SePay evidence on two real connections (switch off: evidence only, no money)', () => {
  it('two concurrent deliveries of one event record exactly one inbox row; the second waits, then changes nothing', async () => {
    const pool = testPool(loadIntegrationConfig().database, { poolMax: 4 });
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const id = randomInt(4_000_000_000, 4_900_000_000);
      const reference = `FTRACE${randomUUID().slice(0, 8).toUpperCase()}`;
      const event = eventFrom({
        id, gateway: 'MBBank', transactionDate: '2026-11-22 09:00:00', accountNumber: '5555555555', subAccount: '', code: 'NAPABCDEF0123', content: 'NAPABCDEF0123 race evidence',
        transferType: 'in', description: '', transferAmount: 77000, accumulated: 0, referenceCode: reference,
      });
      const config = readSepayConfig({ SEPAY_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv);
      const settlement = new SepaySettlementService(new SepaySettlementRepository(), {} as never, {} as never, {} as never, {} as never, new AuditWriter(), new OutboxWriter());

      await first.query('BEGIN');
      await second.query('BEGIN');
      // Connection 1 records the event and keeps its transaction open: its row is not visible to others yet.
      expect(await settlement.settle(contextOf(first), event, config)).toBe(true);
      // Connection 2 delivers the same event while connection 1 is still open: its insert waits on the unique key.
      const waiting = settlement.settle(contextOf(second), event, config);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.query('COMMIT');
      expect(await waiting).toBe(false);
      await second.query('COMMIT');

      const rows = await pool.query<{ n: number; state: string; reason_code: string | null }>(
        'SELECT count(*)::int AS n, min(state) AS state, min(reason_code) AS reason_code FROM app.sepay_transfer_inbox WHERE webhook_event_id = $1::bigint',
        [id],
      );
      expect(rows.rows[0]).toEqual({ n: 1, state: 'RECEIVED', reason_code: 'AUTO_TOPUP_DISABLED' });
    } finally {
      first.release();
      second.release();
      await pool.end();
    }
  });

  it('the same bank transfer reported under a different webhook id on the other connection is one bank identity: the second is a duplicate', async () => {
    const pool = testPool(loadIntegrationConfig().database, { poolMax: 4 });
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const reference = `FTIDENT${randomUUID().slice(0, 8).toUpperCase()}`;
      const base = { gateway: 'MBBank', transactionDate: '2026-11-22 09:30:00', accountNumber: '6666666666', subAccount: '', code: 'NAPABCDEF0123', content: 'NAPABCDEF0123 same bank line', transferType: 'in', description: '', transferAmount: 88000, accumulated: 0, referenceCode: reference };
      const one = eventFrom({ id: randomInt(4_900_000_001, 4_999_000_000), ...base });
      const other = eventFrom({ id: randomInt(4_999_000_001, 5_100_000_000), ...base });
      const config = readSepayConfig({ SEPAY_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv);
      const settlement = new SepaySettlementService(new SepaySettlementRepository(), {} as never, {} as never, {} as never, {} as never, new AuditWriter(), new OutboxWriter());

      await first.query('BEGIN');
      await second.query('BEGIN');
      expect(await settlement.settle(contextOf(first), one, config)).toBe(true);
      const waiting = settlement.settle(contextOf(second), other, config);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.query('COMMIT');
      expect(await waiting).toBe(false);
      await second.query('COMMIT');

      const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.sepay_transfer_inbox WHERE reference_code = $1 AND account_number = $2', [reference, base.accountNumber]);
      expect(rows.rows[0]).toEqual({ n: 1 });
    } finally {
      first.release();
      second.release();
      await pool.end();
    }
  });
});
