import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { ShopRevenueCursor, ShopRevenueOrderRow, ShopRevenueReader, ShopRevenueTotalsRow } from '../../apps/backend/src/orders/shop-revenue-reader';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { createActiveShopFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// #391 shop revenue: the read-only SQL against the REAL schema (migrations applied by CI). Every scenario runs inside one transaction that is ROLLED BACK; only
// the users and shops (created as a normal account would be) are committed. The order triggers are disabled inside that transaction only: the rows are shaped
// like real ones (COMPLETED orders with ended_at, a status and the amounts), and the commit-time invariants are deferred and never run, because nothing commits.

const reader = new ShopRevenueReader();
const contextOf = (client: PoolClient): TransactionContext => ({ isActive: true, query: (text, values) => client.query(text, values as unknown[] | undefined) });
const sumOf = (rows: readonly ShopRevenueTotalsRow[], key: keyof ShopRevenueTotalsRow): bigint => rows.reduce((total, row) => total + (row[key] as bigint), 0n);

describe('#391 shop revenue - SQL on the real schema', () => {
  const phonesToPurge: string[] = [];
  let pool: Pool;

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

  /** A shop owner with its own shop (committed like a real account). */
  async function makeOwner(): Promise<{ userId: string; shopId: string }> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    const shopId = await createActiveShopFor(pool, userId);
    return { userId, shopId };
  }

  /** A customer account (committed) that places the orders. */
  async function makeCustomer(): Promise<string> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    return userId;
  }

  /** Runs [run] in a transaction that is always rolled back, with the order triggers off for this transaction only. */
  async function inRolledBack(run: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await run(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /**
   * One order of a shop. Only the fields the revenue reads matter; the amounts are consistent (paid <= items). A COMPLETED order is confirmed and ended; a
   * PREPARING order is confirmed and still open; the end statuses carry their end actor (and a reason where the schema requires one).
   */
  async function order(
    client: PoolClient,
    input: { shopId: string; customerId: string; status: 'COMPLETED' | 'CANCELLED_BY_CUSTOMER' | 'REJECTED_BY_SHOP' | 'PREPARING'; endedAt?: string; itemsVnd: number },
  ): Promise<string> {
    const orderId = randomUUID();
    // orders_confirmed_ck: confirmed exactly for PREPARING and COMPLETED. orders_ended_ck: ended exactly for the end statuses (PREPARING is open).
    const confirmedAt = input.status === 'COMPLETED' || input.status === 'PREPARING' ? (input.endedAt ?? '2026-11-17T10:00:00Z') : null;
    const endedAt = input.status === 'PREPARING' ? null : (input.endedAt ?? '2026-11-18T00:00:00Z');
    const endActor = input.status === 'PREPARING' ? null : input.status === 'CANCELLED_BY_CUSTOMER' ? 'CUSTOMER' : 'SHOP';
    // orders_reason_ck: a shop refusal needs a reason.
    const endReason = input.status === 'REJECTED_BY_SHOP' ? 'Fixture reason' : null;
    await client.query(
      `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone,
         address_text, items_original_total_vnd, items_total_vnd, paid_vnd, confirmed_at, ended_at, end_actor, end_reason, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, 'Fixture shop', '+84900000001', 'Fixture address', 'Khách', '+84912345678',
         '12 Phố Huế', $7::bigint, $7::bigint, 0, $8::timestamptz, $9::timestamptz, $10, $11, 1, now(), now())`,
      [orderId, `R${orderId.slice(0, 8)}`, randomUUID(), input.customerId, input.shopId, input.status, input.itemsVnd, confirmedAt, endedAt, endActor, endReason],
    );
    return orderId;
  }

  const period = (from: string, to: string) => ({ from, to });

  it('totals and days agree; Vietnam day boundaries; other statuses, other shops and out-of-period orders never count', async () => {
    const owner = await makeOwner();
    const other = await makeOwner();
    const customer = await makeCustomer();
    await inRolledBack(async (client) => {
      // Vietnam is UTC+7: 16:59:59Z is 23:59:59 of 17/11; 17:00:00Z is 00:00 of 18/11.
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-17T16:59:59Z', itemsVnd: 100_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-17T17:00:00Z', itemsVnd: 250_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T03:00:00Z', itemsVnd: 50_000 });
      // Never counts.
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'CANCELLED_BY_CUSTOMER', endedAt: '2026-11-18T05:00:00Z', itemsVnd: 900_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'REJECTED_BY_SHOP', endedAt: '2026-11-18T05:00:00Z', itemsVnd: 800_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'PREPARING', itemsVnd: 700_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T17:00:00Z', itemsVnd: 60_000 });
      await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-16T16:59:59Z', itemsVnd: 40_000 });
      await order(client, { shopId: other.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T05:00:00Z', itemsVnd: 999_999 });

      const out = await reader.summary(contextOf(client), owner.shopId, period('2026-11-17', '2026-11-18'));
      expect(out.totals.completedCount).toBe(3n);
      expect(out.totals.itemsVnd).toBe(400_000n);
      expect(out.days.map((day) => day.day)).toEqual(['2026-11-17', '2026-11-18']);
      expect(out.days[0]).toMatchObject({ completedCount: 1n, itemsVnd: 100_000n });
      expect(out.days[1]).toMatchObject({ completedCount: 2n, itemsVnd: 300_000n });
      expect(sumOf(out.days, 'completedCount')).toBe(out.totals.completedCount);
      expect(sumOf(out.days, 'itemsVnd')).toBe(out.totals.itemsVnd);

      // The other shop sees only its own order.
      const otherOut = await reader.summary(contextOf(client), other.shopId, period('2026-11-17', '2026-11-18'));
      expect(otherOut.totals).toMatchObject({ completedCount: 1n, itemsVnd: 999_999n });
    });
  });

  it('a shop with no completed order reads as zeros for every day of the period, never as missing', async () => {
    const owner = await makeOwner();
    await inRolledBack(async (client) => {
      const out = await reader.summary(contextOf(client), owner.shopId, period('2026-11-20', '2026-11-22'));
      expect(out.days).toHaveLength(3);
      expect(out.totals).toEqual({ completedCount: 0n, itemsVnd: 0n });
      expect(out.days.every((day) => day.completedCount === 0n && day.itemsVnd === 0n)).toBe(true);
    });
  });

  it('the order list is newest first, pages by keyset without skipping or repeating, and breaks ties on order_id', async () => {
    const owner = await makeOwner();
    const customer = await makeCustomer();
    await inRolledBack(async (client) => {
      const ids: string[] = [];
      // Five completed orders; two share the exact same instant (the tie-break must keep both).
      ids.push(await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T05:00:00.000001Z', itemsVnd: 10_000 }));
      ids.push(await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T06:00:00Z', itemsVnd: 20_000 }));
      ids.push(await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T06:00:00Z', itemsVnd: 30_000 }));
      ids.push(await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T07:00:00Z', itemsVnd: 40_000 }));
      ids.push(await order(client, { shopId: owner.shopId, customerId: customer, status: 'COMPLETED', endedAt: '2026-11-18T08:00:00Z', itemsVnd: 50_000 }));

      const seen: ShopRevenueOrderRow[] = [];
      let cursor: ShopRevenueCursor | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await reader.orders(contextOf(client), owner.shopId, period('2026-11-18', '2026-11-18'), 2, cursor);
        const shown = rows.slice(0, 2);
        seen.push(...shown);
        if (rows.length <= 2) {
          break;
        }
        const last = shown[shown.length - 1] as ShopRevenueOrderRow;
        cursor = { endedAt: last.endedAt, orderId: last.orderId };
      }
      expect(seen.map((row) => row.orderId).sort()).toEqual([...ids].sort());
      expect(new Set(seen.map((row) => row.orderId)).size).toBe(5);
      // Newest first by the exact instant.
      expect(seen[0]?.endedAt).toBe('2026-11-18T08:00:00.000000Z');
      expect(seen[seen.length - 1]?.endedAt).toBe('2026-11-18T05:00:00.000001Z');
    });
  });
});
