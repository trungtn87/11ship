import { randomBytes, randomUUID } from 'node:crypto';
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
});
