import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminData, AdminApp, startAdminApp } from './support/admin-fixtures';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { activatedAdmin, ActivatedAdmin, changeGrant, getAs, Login, permission, purgeDeliveriesOfShops, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// OD (#352 follow-up, P5-7f): the business report's complaint figures (trade.quality.complaints) are counted inside the caller's complaint scope, the same
// rule as the overview counter and the action queue (M08-R-12, issue #261, AdminRights.feedbackViewScope). Real PostgreSQL, real administration pipeline.
// Four files are seeded: naming a shop and a Shipper, naming only a shop, naming only a Shipper, and an ADMIN with neither part. Expected: SYSTEM and a
// full-scope ADMIN count all three, a SHOP-only ADMIN counts one, a DRIVER-only ADMIN counts one, the ADMIN with no SHOP/DRIVER view counts none.
// Figures are DELTAS, because the database is shared. Cleanup follows the #352 suite: app.complaints rejects DELETE by trigger, so the user triggers are
// disabled for this suite's own rows only, in one transaction.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M08-R-12 / M11 #261 — business report complaint figures are counted only inside the caller scope', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let shopOnly: ActivatedAdmin;
  let driverOnly: ActivatedAdmin;
  let both: ActivatedAdmin;
  let noScope: ActivatedAdmin;
  let shopId = '';
  let driverId = '';
  let deliveryId = '';
  let ownerId = '';
  let ownerPhone = '';

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    shopOnly = await activatedAdmin(admin, system, [permission('SHOP')], `Báo cáo chỉ quán ${tag}`);
    driverOnly = await activatedAdmin(admin, system, [permission('DRIVER')], `Báo cáo chỉ shipper ${tag}`);
    both = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Báo cáo cả hai ${tag}`);
    noScope = await activatedAdmin(admin, system, [permission('CUSTOMER')], `Báo cáo không scope ${tag}`);
    for (const who of [shopOnly, driverOnly, both, noScope]) {
      expect((await changeGrant(admin, system, 'grant', who.userId, 'report.read', 0)).status).toBe(200);
    }
    ownerId = randomUUID();
    ownerPhone = randomPhone().normalized;
    await admin.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [ownerId, ownerPhone, await new Argon2idPasswordHasher().hash('owner-not-a-login')],
    );
    shopId = await createActiveShopFor(admin.pool, ownerId);
    driverId = await createDriverFor(admin.pool, ownerId);
    deliveryId = await seedDelivery(admin.pool, { shopId, userId: ownerId });
  });

  afterAll(async () => {
    try {
      if (ownerId !== '') {
        const client = await admin.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('ALTER TABLE app.complaints DISABLE TRIGGER USER');
          await client.query('DELETE FROM app.complaints WHERE submitter_user_id = $1::uuid', [ownerId]);
          await client.query('ALTER TABLE app.complaints ENABLE TRIGGER USER');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        await purgeDeliveriesOfShops(admin.pool, [shopId]);
        await purgeShopDisplayCodes(admin.pool, [shopId]);
        await purgePhone(admin.pool, ownerPhone);
      }
    } finally {
      await admin.close();
    }
  });

  /** The complaint figure of the business report for one actor (today, the current period). */
  const reportComplaints = async (who: Login): Promise<number> => {
    const response = await getAs(admin, who, '/business/reports?range=today');
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    const trade = (adminData(response) as Json).trade as Json;
    return trade.quality.complaints as number;
  };

  /** A complaint row as the M11 workflow stores it. `shopId` / `driverId` null = the file does not name that party. */
  async function seedComplaint(over: { shopId: string | null; driverId: string | null }): Promise<void> {
    await admin.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, delivery_id, shop_id, driver_id, related_code, shop_name,
                                   driver_name, driver_code, scope_key, status, received_at, body, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, $6::uuid, 'K', 'Quán test',
               'Shipper test', 'SHP', $7::uuid, 'PENDING', now(), 'Nội dung phản ánh', now(), now())`,
      [randomUUID(), `C${randomBytes(4).toString('hex').toUpperCase()}`, ownerId, deliveryId, over.shopId, over.driverId, randomUUID()],
    );
  }

  it('counts the report complaint figure inside each caller scope: SYSTEM and a full-scope ADMIN see every file, a part-scope ADMIN only its own part, no scope none', async () => {
    const actors = { system: systemLoginOf(system), both: both.login, shop: shopOnly.login, driver: driverOnly.login, none: noScope.login };
    const before: Record<string, number> = {};
    for (const [name, who] of Object.entries(actors)) before[name] = await reportComplaints(who);

    await seedComplaint({ shopId, driverId });
    await seedComplaint({ shopId, driverId: null });
    await seedComplaint({ shopId: null, driverId });

    const delta: Record<string, number> = {};
    for (const [name, who] of Object.entries(actors)) delta[name] = (await reportComplaints(who)) - before[name]!;
    // A file naming a shop AND a Shipper needs both parts: the SHOP-only and DRIVER-only ADMINs do not count it.
    expect(delta).toEqual({ system: 3, both: 3, shop: 1, driver: 1, none: 0 });
  });

  /** A CLOSED file: its resolution time is closed_at - created_at, so the seeded day decides the period it belongs to. */
  async function seedClosed(over: { shopId: string | null; driverId: string | null; closedAtMs: number; seconds: number }): Promise<void> {
    await admin.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, delivery_id, shop_id, driver_id, related_code, shop_name,
                                   driver_name, driver_code, scope_key, status, received_at, conclusion, closed_at, body, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, $6::uuid, 'K', 'Quán test',
               'Shipper test', 'SHP', $7::uuid, 'RESOLVED', $9::timestamptz, 'Đã xác minh', $8::timestamptz, 'Nội dung phản ánh', $9::timestamptz, $8::timestamptz)`,
      [
        randomUUID(),
        `C${randomBytes(4).toString('hex').toUpperCase()}`,
        ownerId,
        deliveryId,
        over.shopId,
        over.driverId,
        randomUUID(),
        new Date(over.closedAtMs).toISOString(),
        new Date(over.closedAtMs - over.seconds * 1000).toISOString(),
      ],
    );
  }

  it('averages the resolution time of closed files only inside the caller scope, in the report period and in the previous period', async () => {
    // Vietnam calendar day (00:00 Asia/Ho_Chi_Minh = 17:00 UTC of the day before). The custom range accepts years from 2020 on. A random day in
    // 2020-2023 keeps the window away from the current data of the shared database; the report's custom range is that one day, and its previous
    // period is the day before it (the server computes it).
    const HOUR = 3600_000;
    const DAY = 24 * HOUR;
    const dayMs = Date.UTC(2019, 11, 31, 17) + randomInt(1, 1400) * DAY;
    const vnDay = (ms: number): string => new Date(ms + 7 * HOUR).toISOString().slice(0, 10);
    // Current day, closed at 03:00 Vietnam time. Hand-computed resolution times:
    //   shop-only 600 s, Shipper-only 2400 s, both 3600 s  ->  all = (600+2400+3600)/3 = 2200;  shop = 600;  Shipper = 2400;  none = null.
    await seedClosed({ shopId, driverId: null, closedAtMs: dayMs + 3 * HOUR, seconds: 600 });
    await seedClosed({ shopId: null, driverId, closedAtMs: dayMs + 3 * HOUR, seconds: 2400 });
    await seedClosed({ shopId, driverId, closedAtMs: dayMs + 3 * HOUR, seconds: 3600 });
    // Previous day, same shape. Hand-computed: all = (300+900+2100)/3 = 1100;  shop = 300;  Shipper = 900;  none = null.
    await seedClosed({ shopId, driverId: null, closedAtMs: dayMs - DAY + 3 * HOUR, seconds: 300 });
    await seedClosed({ shopId: null, driverId, closedAtMs: dayMs - DAY + 3 * HOUR, seconds: 900 });
    await seedClosed({ shopId, driverId, closedAtMs: dayMs - DAY + 3 * HOUR, seconds: 2100 });

    const figures = async (who: Login): Promise<{ current: unknown; previous: unknown; count: unknown }> => {
      const day = vnDay(dayMs);
      const response = await getAs(admin, who, `/business/reports?range=custom&from=${day}&to=${day}`);
      expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
      const data = adminData(response) as Json;
      return {
        current: data.trade.quality.average_resolution_seconds,
        previous: data.previous_trade.quality.average_resolution_seconds,
        count: data.trade.quality.complaints,
      };
    };

    expect(await figures(systemLoginOf(system))).toEqual({ current: 2200, previous: 1100, count: 3 });
    expect(await figures(both.login)).toEqual({ current: 2200, previous: 1100, count: 3 });
    expect(await figures(shopOnly.login)).toEqual({ current: 600, previous: 300, count: 1 });
    expect(await figures(driverOnly.login)).toEqual({ current: 2400, previous: 900, count: 1 });
    expect(await figures(noScope.login)).toEqual({ current: null, previous: null, count: 0 });
  });
});
