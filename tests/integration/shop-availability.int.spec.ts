import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  BusinessInterval,
  canonicalizeBusinessHours,
  fromWire,
  isOpenAt,
} from '../../apps/backend/src/shop/business-hours';
import { RawShopSnapshot, ShopAvailabilityReader, toShopSnapshot } from '../../apps/backend/src/shop/shop-availability-reader';
import { buildAvailabilitySnapshotSql } from '../../apps/backend/src/shop/shop-availability-sql';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import {
  createShopOwner,
  getShop,
  hoursBody,
  insertHours,
  interval,
  putHours,
  ShopOwner,
  Wire,
} from './support/shop-management-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M02-A acceptance A06, A08 and A18 — availability is decided by ONE PostgreSQL statement. The statement under
// test is the production one, built around a fixed instant instead of clock_timestamp() (the only difference), so
// the boundaries are exact. The reference model in business-hours.ts is an independent oracle.
describe('M02-A — availability on PostgreSQL', () => {
  let app: AuthApp;
  let owner: ShopOwner;
  const FIXED_SQL = buildAvailabilitySnapshotSql('$2::timestamptz', 'shop');

  beforeAll(async () => {
    app = await startAuthApp();
    owner = await createShopOwner(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setSchedule(shopId: string, intervals: readonly Wire[]): Promise<void> {
    await app.pool.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [shopId]);
    await insertHours(app.pool, shopId, intervals);
  }

  async function at(instant: string, shopId: string = owner.shopId, timeZone?: string) {
    const client = await app.pool.connect();
    try {
      if (timeZone !== undefined) {
        await client.query(`SET TIME ZONE '${timeZone}'`);
      }
      const result = await client.query<RawShopSnapshot>(FIXED_SQL, [shopId, instant]);
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('no snapshot row');
      }
      return toShopSnapshot(row);
    } finally {
      client.release();
    }
  }

  const online = async (instant: string, timeZone?: string): Promise<boolean> =>
    (await at(instant, owner.shopId, timeZone)).availability.online;

  describe('A06 — the open minute is inclusive, the close minute exclusive, on Vietnam time', () => {
    it('Monday 08:00-17:00', async () => {
      await setSchedule(owner.shopId, [interval(1, 480, 1020)]);
      // 2026-10-05 is a Monday.
      expect(await online('2026-10-05T07:59:59.999+07:00')).toBe(false);
      expect(await online('2026-10-05T08:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-05T08:00:00.001+07:00')).toBe(true);
      expect(await online('2026-10-05T16:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-05T17:00:00.000+07:00')).toBe(false);
      expect(await online('2026-10-06T10:00:00.000+07:00')).toBe(false);
    });

    it('seconds and milliseconds are part of the instant', async () => {
      await setSchedule(owner.shopId, [interval(2, 600, 601)]);
      expect(await online('2026-10-06T09:59:59.999+07:00')).toBe(false);
      expect(await online('2026-10-06T10:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-06T10:00:59.999+07:00')).toBe(true);
      expect(await online('2026-10-06T10:01:00.000+07:00')).toBe(false);
    });

    it('the instant is read as Vietnam wall time whatever UTC says and whatever the session time zone is', async () => {
      await setSchedule(owner.shopId, [interval(1, 0, 60)]);
      // Monday 00:30 in Vietnam is Sunday 17:30 UTC.
      const instant = '2026-10-04T17:30:00.000Z';
      for (const zone of [undefined, 'UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
        expect([zone, await online(instant, zone)]).toEqual([zone, true]);
        expect([zone, await online('2026-10-04T18:30:00.000Z', zone)]).toEqual([zone, false]);
      }
    });

    it('evaluated_at is the instant that was evaluated, in UTC milliseconds', async () => {
      await setSchedule(owner.shopId, [interval(1, 0, 60)]);
      expect((await at('2026-10-04T17:30:00.123Z')).availability.evaluatedAt).toBe('2026-10-04T17:30:00.123Z');
    });
  });

  describe('A18 — midnight, 24 hours, the week wrap and one instant', () => {
    it('00:00 belongs to the day that opens at it; 24:00 is the next day, exclusive', async () => {
      await setSchedule(owner.shopId, [interval(1, 0, 1440)]);
      expect(await online('2026-10-04T23:59:59.999+07:00')).toBe(false); // Sunday
      expect(await online('2026-10-05T00:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-05T23:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-06T00:00:00.000+07:00')).toBe(false);
    });

    it('a 24-hour interval that starts at noon runs to the next noon, exclusive', async () => {
      await setSchedule(owner.shopId, [interval(3, 720, 720, 1)]);
      expect(await online('2026-10-07T11:59:59.999+07:00')).toBe(false);
      expect(await online('2026-10-07T12:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-08T11:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-08T12:00:00.000+07:00')).toBe(false);
    });

    it('Sunday 22:00 -> Monday 02:00 wraps over the week boundary', async () => {
      await setSchedule(owner.shopId, [interval(7, 1320, 120, 1)]);
      expect(await online('2026-10-11T21:59:59.999+07:00')).toBe(false);
      expect(await online('2026-10-11T22:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-11T23:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-12T00:00:00.000+07:00')).toBe(true); // the next Monday
      expect(await online('2026-10-12T01:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-12T02:00:00.000+07:00')).toBe(false);
    });

    it('adjacent intervals stay open across the shared minute', async () => {
      await setSchedule(owner.shopId, [interval(1, 480, 720), interval(1, 720, 1020)]);
      expect(await online('2026-10-05T11:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-05T12:00:00.000+07:00')).toBe(true);
      expect(await online('2026-10-05T16:59:59.999+07:00')).toBe(true);
      expect(await online('2026-10-05T17:00:00.000+07:00')).toBe(false);
    });

    it('differential: SQL equals the independent reference model on 300 pseudo-random instants and schedules', async () => {
      let seed = 20261008;
      const next = (limit: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % limit;
      };
      let compared = 0;
      for (let round = 0; round < 6; round += 1) {
        const candidates: BusinessInterval[] = [];
        for (let i = 0; i < 6; i += 1) {
          const start = next(1440);
          const overnight = next(3) === 0;
          const end = overnight ? next(start + 1) : start + 1 + next(1440 - start);
          candidates.push({ weekday: 1 + next(7), startMinute: start, endMinute: end, endDayOffset: overnight ? 1 : 0 });
        }
        const accepted: BusinessInterval[] = [];
        for (const candidate of candidates) {
          try {
            accepted.splice(0, accepted.length, ...canonicalizeBusinessHours([...accepted, candidate]));
          } catch (error) {
            expect(error).toBeInstanceOf(AppError);
          }
        }
        await setSchedule(
          owner.shopId,
          accepted.map((i) => ({ weekday: i.weekday, start_minute: i.startMinute, end_minute: i.endMinute, end_day_offset: i.endDayOffset })),
        );
        for (let i = 0; i < 50; i += 1) {
          const instantMs = Date.UTC(2026, 9, 5) + next(7 * 24 * 60) * 60_000 + next(60) * 1000 + next(1000) - 7 * 3_600_000;
          const instant = new Date(instantMs).toISOString();
          expect([round, instant, await online(instant)]).toEqual([round, instant, isOpenAt(accepted, instantMs)]);
          compared += 1;
        }
        // And the persisted rows read back as the same intervals.
        const snapshot = await at('2026-10-05T12:00:00.000+07:00');
        expect(snapshot.hours).toEqual(accepted.map((i) => fromWire({ weekday: i.weekday, start_minute: i.startMinute, end_minute: i.endMinute, end_day_offset: i.endDayOffset })));
      }
      expect(compared).toBe(300);
    });

    it('the production statement samples the database clock once: evaluated_at lies between two clock reads of the same connection', async () => {
      await setSchedule(owner.shopId, [interval(1, 0, 60)]);
      const client = await app.pool.connect();
      try {
        const lower = await client.query<{ t: string }>(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS t",
        );
        const reader = new ShopAvailabilityReader();
        const manager = managerFor(poolClientSource(app.pool));
        const availability = await manager.withTransaction((context) => reader.availabilityOf(context, owner.shopId));
        const upper = await client.query<{ t: string }>(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS t",
        );
        const evaluated = Date.parse(availability.evaluatedAt);
        expect(evaluated).toBeGreaterThanOrEqual(Math.floor(Date.parse(lower.rows[0]?.t ?? '') / 1) - 1);
        expect(evaluated).toBeLessThanOrEqual(Date.parse(upper.rows[0]?.t ?? ''));
        expect(availability.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      } finally {
        client.release();
      }
    });
  });

  describe('A08 — status conditions always win over the schedule', () => {
    async function freshOpenShop(): Promise<ShopOwner> {
      const shop = await createShopOwner(app);
      await insertHours(app.pool, shop.shopId, [1, 2, 3, 4, 5, 6, 7].map((day) => interval(day, 0, 1440)));
      return shop;
    }
    const NOW = '2026-10-07T12:00:00.000+07:00';

    it('ACTIVE shop, ACTIVE area, inside the schedule: ONLINE', async () => {
      const shop = await freshOpenShop();
      expect((await at(NOW, shop.shopId)).availability).toMatchObject({ online: true, reason: 'ONLINE' });
    });

    it('an INACTIVE service area is always OFFLINE (SERVICE_AREA_INACTIVE), even inside the schedule', async () => {
      const shop = await freshOpenShop();
      await app.pool.query("UPDATE app.service_areas SET status = 'INACTIVE' WHERE service_area_id = $1::uuid", [shop.areaId]);
      expect((await at(NOW, shop.shopId)).availability).toMatchObject({ online: false, reason: 'SERVICE_AREA_INACTIVE' });
      const read = await getShop(app, shop.token);
      expect(dataOf(read).availability).toMatchObject({ online: false, reason: 'SERVICE_AREA_INACTIVE' });
    });

    it('a DISABLED shop is always OFFLINE (SHOP_DISABLED), also with an INACTIVE area (shop status wins)', async () => {
      const shop = await freshOpenShop();
      await app.pool.query("UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid", [shop.shopId]);
      expect((await at(NOW, shop.shopId)).availability).toMatchObject({ online: false, reason: 'SHOP_DISABLED' });
      await app.pool.query("UPDATE app.service_areas SET status = 'INACTIVE' WHERE service_area_id = $1::uuid", [shop.areaId]);
      expect((await at(NOW, shop.shopId)).availability.reason).toBe('SHOP_DISABLED');
    });

    it('no schedule is NO_BUSINESS_HOURS; outside it is OUTSIDE_BUSINESS_HOURS', async () => {
      const shop = await createShopOwner(app);
      expect((await at(NOW, shop.shopId)).availability.reason).toBe('NO_BUSINESS_HOURS');
      await insertHours(app.pool, shop.shopId, [interval(1, 0, 60)]);
      expect((await at(NOW, shop.shopId)).availability.reason).toBe('OUTSIDE_BUSINESS_HOURS');
    });

    it('the read port needs no session at all and throws SHOP_NOT_FOUND for an unknown shop', async () => {
      const shop = await freshOpenShop();
      const reader = new ShopAvailabilityReader();
      const manager = managerFor(poolClientSource(app.pool));
      // Revoke every session of the owner: the port is a pure read of shop state and the database clock.
      await app.pool.query(`UPDATE app.sessions SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
                              updated_at = date_trunc('milliseconds', clock_timestamp())
          WHERE user_id = $1::uuid`, [shop.userId]);
      const availability = await manager.withTransaction((context) => reader.availabilityOf(context, shop.shopId));
      expect(['ONLINE', 'OUTSIDE_BUSINESS_HOURS']).toContain(availability.reason);
      expect(availability.online).toBe(true);
      await expect(manager.withTransaction((context) => reader.availabilityOf(context, randomUUID()))).rejects.toMatchObject({
        code: 'SHOP_NOT_FOUND',
      });
    });

    it('business hours do not change which roles Auth offers', async () => {
      const shop = await createShopOwner(app);
      const roles = async () => dataOf(await app.call('GET', '/auth/me', { bearer: shop.token })).available_roles;
      const before = await roles();
      expect(before).toEqual(['SHOP']);
      expect((await putHours(app, shop.token, hoursBody([interval(1, 0, 600)]))).status).toBe(200);
      expect(await roles()).toEqual(before);
      expect((await putHours(app, shop.token, hoursBody([], 3))).status).toBe(200);
      expect(await roles()).toEqual(before);
    });
  });
});
