import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { DriverIncomeRepository, IncomeTotalsRow } from '../../apps/backend/src/driver-income/driver-income-repository';
import { parseIncomePeriod } from '../../apps/backend/src/driver-income/driver-income-validation';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';

// #395 Shipper income: the read-only SQL against the REAL schema (migrations applied by CI). Each scenario runs inside one transaction that is ROLLED BACK,
// so only the wallet (created as a normal wallet would be) is committed. The commission gate triggers are disabled inside that transaction only, the same
// way the wallet fixtures do it: the rows are shaped like real ones (completed assignments, COMMISSION_DEBIT rows with a chained sequence and balance).
// The commit-time invariants are deferred and never run here, because nothing is committed.

const repository = new DriverIncomeRepository();
const contextOf = (client: PoolClient): TransactionContext => ({ isActive: true, query: (text, values) => client.query(text, values as unknown[] | undefined) });

describe('#395 Shipper income - SQL on the real schema', () => {
  const phonesToPurge: string[] = [];
  let pool: Pool;
  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
  const walletService = new WalletService(new WalletRepository(), new DriverRepository());

  beforeAll(() => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 4 });
  });

  afterAll(async () => {
    try {
      for (const phone of phonesToPurge) {
        await purgePhone(pool, phone);
      }
    } finally {
      await pool.end();
    }
  });

  /** A Shipper with a committed wallet (created at zero), its own shop and nothing else. */
  async function makeShipper(): Promise<{ userId: string; driverId: string; shopId: string; walletId: string }> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    const driverId = await createDriverFor(pool, userId);
    const shopId = await createActiveShopFor(pool, userId);
    const { wallet } = await manager().withTransaction((context) => walletService.ensureZeroWallet(context, driverId));
    return { userId, driverId, shopId, walletId: wallet.walletId };
  }

  /** Runs [run] in a transaction that is always rolled back, with the commission/ledger source gates off for this transaction only. */
  async function inRolledBack(run: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_a_source_gate');
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await run(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** Last ledger sequence and balance of the wallet (0 / 0 for an empty one), to chain the next row. */
  async function chainOf(client: PoolClient, walletId: string): Promise<{ seq: number; balance: number }> {
    const result = await client.query<{ sequence_no: string; balance_after_vnd: string }>(
      'SELECT sequence_no, balance_after_vnd FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no DESC LIMIT 1',
      [walletId],
    );
    const row = result.rows[0];
    return row === undefined ? { seq: 0, balance: 0 } : { seq: Number(row.sequence_no), balance: Number(row.balance_after_vnd) };
  }

  async function fund(client: PoolClient, walletId: string, amount: number): Promise<void> {
    const last = await chainOf(client, walletId);
    await client.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
       VALUES ($1::uuid, $2::uuid, $3, 'ADJUSTMENT_CREDIT', $4, $5, now())`,
      [randomUUID(), walletId, last.seq + 1, amount, last.balance + amount],
    );
  }

  /**
   * One delivery and its assignment. COMPLETED: the goods were picked up and delivered at endedAt, with the final fee. CANCELLED_BY_SHIPPER: the Shipper gave
   * the delivery back at endedAt; it is not completed and must never count. Returns the assignment id.
   */
  async function assignment(
    client: PoolClient,
    shipper: { userId: string; driverId: string; shopId: string },
    input: { status: 'COMPLETED' | 'CANCELLED_BY_SHIPPER'; endedAt: string; feeVnd?: number; snapshotVnd: number },
  ): Promise<string> {
    const deliveryId = randomUUID();
    const assignmentId = randomUUID();
    const completed = input.status === 'COMPLETED';
    await client.query(
      `INSERT INTO app.deliveries (
         delivery_id, code, source, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng,
         recipient_name, recipient_phone, dropoff_address_text, dropoff_lat, dropoff_lng, goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer, fee_vnd,
         search_started_at, search_expires_at, picked_up_at, ended_at, version, created_at, updated_at)
       VALUES ($1::uuid, $2, 'DIRECT', $3::uuid, $4::uuid, $5, 'Fixture shop', '+84900000001', 'Fixture address', 21.0, 105.8,
         'Khách', '+84912345678', '12 Phố Huế', 21.0, 105.82, 'Hộp quà', 0, 0, 'STANDARD', 'CUSTOMER', $6,
         now(), now() + interval '30 minutes', $7, $8, 1, now(), now())`,
      [
        deliveryId,
        `F-${deliveryId.slice(0, 8)}`,
        shipper.shopId,
        shipper.userId,
        completed ? 'completed' : 'waiting_driver',
        completed ? input.feeVnd ?? 0 : null,
        completed ? input.endedAt : null,
        completed ? input.endedAt : null,
      ],
    );
    await client.query(
      `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, status, accepted_at, commission_vnd, commission_policy, ended_at, end_actor, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint, 'COMMISSION_V1', $5::timestamptz, 'SHIPPER', 1, now(), now())`,
      [assignmentId, deliveryId, shipper.driverId, input.status, input.endedAt, input.snapshotVnd],
    );
    return assignmentId;
  }

  async function debit(client: PoolClient, walletId: string, assignmentId: string, amount: number): Promise<void> {
    const last = await chainOf(client, walletId);
    await client.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, commission_assignment_id)
       VALUES ($1::uuid, $2::uuid, $3, 'COMMISSION_DEBIT', $4, $5, now(), $6::uuid)`,
      [randomUUID(), walletId, last.seq + 1, -amount, last.balance - amount, assignmentId],
    );
  }

  const period = (from: string, to: string) => parseIncomePeriod({ from, to });
  const sumOf = (rows: readonly IncomeTotalsRow[], key: keyof IncomeTotalsRow): bigint => rows.reduce((total, row) => total + (row[key] as bigint), 0n);

  it('totals and days agree; Vietnam day boundaries; cancelled, out-of-period and provisional rows are handled as specified', async () => {
    const shipper = await makeShipper();
    await inRolledBack(async (client) => {
      await fund(client, shipper.walletId, 1_000_000);
      // Vietnam is UTC+7: 16:59:59Z is 23:59:59 of 17/11; 17:00:00Z is 00:00 of 18/11.
      const a = await assignment(client, shipper, { status: 'COMPLETED', endedAt: '2026-11-17T16:59:59Z', feeVnd: 10000, snapshotVnd: 1000 });
      await debit(client, shipper.walletId, a, 1000);
      const b = await assignment(client, shipper, { status: 'COMPLETED', endedAt: '2026-11-17T17:00:00Z', feeVnd: 20000, snapshotVnd: 2000 });
      await debit(client, shipper.walletId, b, 2000);
      // Completed but no commission debit yet: the figure is provisional.
      await assignment(client, shipper, { status: 'COMPLETED', endedAt: '2026-11-18T03:00:00Z', feeVnd: 5000, snapshotVnd: 1000 });
      // Debit differs from the snapshot: provisional too.
      const d = await assignment(client, shipper, { status: 'COMPLETED', endedAt: '2026-11-18T05:00:00Z', feeVnd: 7000, snapshotVnd: 1000 });
      await debit(client, shipper.walletId, d, 1500);
      // Never counts: given back by the Shipper, and completed only after the period.
      await assignment(client, shipper, { status: 'CANCELLED_BY_SHIPPER', endedAt: '2026-11-18T05:00:00Z', snapshotVnd: 1000 });
      const late = await assignment(client, shipper, { status: 'COMPLETED', endedAt: '2026-11-18T17:00:00Z', feeVnd: 50000, snapshotVnd: 1000 });
      await debit(client, shipper.walletId, late, 1000);

      const out = await repository.summary(contextOf(client), shipper.driverId, period('2026-11-17', '2026-11-18'));
      expect(out.totals.completedCount).toBe(4n);
      expect(out.totals.feeVnd).toBe(42000n);
      expect(out.totals.commissionVnd).toBe(-4500n);
      expect(out.totals.provisionalCount).toBe(1n);
      expect(out.totals.mismatchCount).toBe(1n);

      expect(out.days.map((day) => day.day)).toEqual(['2026-11-17', '2026-11-18']);
      expect(out.days[0]).toMatchObject({ completedCount: 1n, feeVnd: 10000n, commissionVnd: -1000n });
      expect(out.days[1]).toMatchObject({ completedCount: 3n, feeVnd: 32000n, commissionVnd: -3500n });
      // One statement: the days add up to the totals exactly.
      expect(sumOf(out.days, 'completedCount')).toBe(out.totals.completedCount);
      expect(sumOf(out.days, 'feeVnd')).toBe(out.totals.feeVnd);
      expect(sumOf(out.days, 'commissionVnd')).toBe(out.totals.commissionVnd);
    });
  });

  it('a Shipper never sees another Shipper\'s income, and a period with no completed delivery reads as zeros for every day', async () => {
    const mine = await makeShipper();
    const other = await makeShipper();
    await inRolledBack(async (client) => {
      await fund(client, other.walletId, 100_000);
      const theirs = await assignment(client, other, { status: 'COMPLETED', endedAt: '2026-11-18T05:00:00Z', feeVnd: 66666, snapshotVnd: 1000 });
      await debit(client, other.walletId, theirs, 1000);

      const mineOut = await repository.summary(contextOf(client), mine.driverId, period('2026-11-17', '2026-11-18'));
      expect(mineOut.totals.completedCount).toBe(0n);
      expect(mineOut.totals.feeVnd).toBe(0n);
      expect(mineOut.days).toHaveLength(2);
      expect(mineOut.days.every((day) => day.completedCount === 0n && day.feeVnd === 0n)).toBe(true);

      const otherOut = await repository.summary(contextOf(client), other.driverId, period('2026-11-17', '2026-11-18'));
      expect(otherOut.totals).toMatchObject({ completedCount: 1n, feeVnd: 66666n, commissionVnd: -1000n });
    });
  });

  it('a 92-day period with many completed rows is one query with 92 days, and the totals equal the sum of the days', async () => {
    const shipper = await makeShipper();
    await inRolledBack(async (client) => {
      await fund(client, shipper.walletId, 10_000_000);
      for (let i = 0; i < 92; i++) {
        for (const hour of [2, 9]) {
          const day = new Date(Date.UTC(2026, 7, 1) + i * 86_400_000);
          const endedAt = new Date(day.getTime() + hour * 3_600_000).toISOString();
          const id = await assignment(client, shipper, { status: 'COMPLETED', endedAt, feeVnd: 10_000, snapshotVnd: 1000 });
          await debit(client, shipper.walletId, id, 1000);
        }
      }
      const out = await repository.summary(contextOf(client), shipper.driverId, period('2026-08-01', '2026-10-31'));
      expect(out.days).toHaveLength(92);
      expect(out.totals.completedCount).toBe(184n);
      expect(out.totals.feeVnd).toBe(1_840_000n);
      expect(sumOf(out.days, 'feeVnd')).toBe(out.totals.feeVnd);
      expect(sumOf(out.days, 'completedCount')).toBe(out.totals.completedCount);
    });
  });
});
