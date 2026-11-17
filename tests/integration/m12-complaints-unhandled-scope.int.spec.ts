import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminData, AdminApp, startAdminApp } from './support/admin-fixtures';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { activatedAdmin, ActivatedAdmin, getAs, Login, permission, purgeDeliveriesOfShops, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M08-R-12 (counter of the administration only counts inside the ADMIN's own scope) with the complaint scope of issue #261, on a REAL PostgreSQL through the
// real administration pipeline. The database is shared, so every count is a DELTA of what this suite seeded. Four files are seeded: one naming a shop and a
// Shipper, one naming only a shop, one naming only a Shipper, and one already RESOLVED. Expected: SYSTEM and a full-scope ADMIN count the three open files,
// a SHOP-only ADMIN counts one, a DRIVER-only ADMIN counts one; no ADMIN ever sees a total that includes another scope. The action queue shows the same
// files, so an out-of-scope file must not appear there either.
// Cleanup: app.complaints rejects DELETE by trigger, so the suite disables the user triggers for its own rows only (the pattern the M11 suite uses), in one
// transaction, and then removes the delivery, shop and Shipper profile of its untracked owner. A leftover complaint would block every later systemSession().

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// Backdated so these files are the OLDEST complaints of the shared database: the action queue reads the oldest 100 files of each kind.
const BACKDATE = '2001-01-01T00:00:00.000Z';

describe('M08-R-12 / M11 #261 — unhandled complaints are counted and listed only inside the caller scope', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let shopOnly: ActivatedAdmin;
  let driverOnly: ActivatedAdmin;
  let both: ActivatedAdmin;
  let shopId = '';
  let driverId = '';
  let deliveryId = '';
  // The owner of the seeded shop, Shipper profile and files is NOT tracked, so the cleanup of the tracked accounts never deletes them (complaints reference them).
  let ownerId = '';
  let ownerPhone = '';

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    shopOnly = await activatedAdmin(admin, system, [permission('SHOP')], `Chỉ quán ${tag}`);
    driverOnly = await activatedAdmin(admin, system, [permission('DRIVER')], `Chỉ shipper ${tag}`);
    both = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Cả hai ${tag}`);
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
        // Only this suite's own complaints (submitted by the untracked owner), with the user triggers off for that one transaction.
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

  /** The to-do counter of the overview for one actor (the figure the tile shows). */
  const complaintsUnhandled = async (who: Login): Promise<number> => {
    const response = await getAs(admin, who, '/overview?range=today');
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    const todo = (adminData(response) as Json).todo as Json[];
    const item = todo.find((entry) => entry.key === 'complaints_unhandled') as Json;
    expect(item.status).toBe('OK');
    return item.value as number;
  };

  /** The complaint keys the action queue lists for one actor (the files behind the to-do figure). */
  const queueComplaintKeys = async (who: Login): Promise<string[]> => {
    const response = await getAs(admin, who, '/overview/action-queue');
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    const items = (adminData(response) as Json).items as Json[];
    // The queue key is `KIND|key`; the complaint key is the part after the bar.
    return items.filter((item) => item.kind === 'COMPLAINT').map((item) => String(item.key).split('|').slice(1).join('|'));
  };

  /** A complaint row as the M11 workflow stores it. `shopId` / `driverId` null = the file does not name that party. */
  async function seedComplaint(over: { shopId: string | null; driverId: string | null; status?: 'PENDING' | 'RESOLVED' }): Promise<{ key: string }> {
    const complaintId = randomUUID();
    const resolved = over.status === 'RESOLVED';
    await admin.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, delivery_id, shop_id, driver_id, related_code, shop_name,
                                   driver_name, driver_code, scope_key, status, received_at, conclusion, closed_at, body, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, $6::uuid, 'K', 'Quán test',
               'Shipper test', 'SHP', $7::uuid, $8, $9::timestamptz, $10::text, $11::timestamptz, 'Nội dung phản ánh', $12::timestamptz, $12::timestamptz)`,
      [
        complaintId,
        `C${randomBytes(4).toString('hex').toUpperCase()}`,
        ownerId,
        deliveryId,
        over.shopId,
        over.driverId,
        randomUUID(),
        resolved ? 'RESOLVED' : 'PENDING',
        resolved ? BACKDATE : null,
        resolved ? 'Đã xác minh' : null,
        resolved ? BACKDATE : null,
        BACKDATE,
      ],
    );
    return { key: `complaint:${complaintId}` };
  }

  it('1. the counter counts inside each caller scope: SYSTEM and a full-scope ADMIN see every open file, a part-scope ADMIN only the files of its own part', async () => {
    const before = {
      system: await complaintsUnhandled(systemLoginOf(system)),
      both: await complaintsUnhandled(both.login),
      shop: await complaintsUnhandled(shopOnly.login),
      driver: await complaintsUnhandled(driverOnly.login),
    };

    await seedComplaint({ shopId, driverId });
    await seedComplaint({ shopId, driverId: null });
    await seedComplaint({ shopId: null, driverId });
    await seedComplaint({ shopId, driverId: null, status: 'RESOLVED' });

    const after = {
      system: await complaintsUnhandled(systemLoginOf(system)),
      both: await complaintsUnhandled(both.login),
      shop: await complaintsUnhandled(shopOnly.login),
      driver: await complaintsUnhandled(driverOnly.login),
    };
    // A file naming a shop AND a Shipper needs both parts (it cannot be shown per party), so the SHOP-only and DRIVER-only ADMINs do not count it.
    expect(after.system - before.system).toBe(3);
    expect(after.both - before.both).toBe(3);
    expect(after.shop - before.shop).toBe(1);
    expect(after.driver - before.driver).toBe(1);
  });

  it('2. the action queue lists a complaint only inside the caller scope: no file of another part appears, and the full-scope ADMIN and SYSTEM see all', async () => {
    const shopFile = await seedComplaint({ shopId, driverId: null });
    const driverFile = await seedComplaint({ shopId: null, driverId });
    const bothFile = await seedComplaint({ shopId, driverId });

    const shopKeys = await queueComplaintKeys(shopOnly.login);
    expect(shopKeys).toContain(shopFile.key);
    expect(shopKeys).not.toContain(driverFile.key);
    expect(shopKeys).not.toContain(bothFile.key);

    const driverKeys = await queueComplaintKeys(driverOnly.login);
    expect(driverKeys).toContain(driverFile.key);
    expect(driverKeys).not.toContain(shopFile.key);
    expect(driverKeys).not.toContain(bothFile.key);

    const bothKeys = await queueComplaintKeys(both.login);
    expect([shopFile.key, driverFile.key, bothFile.key].every((key) => bothKeys.includes(key))).toBe(true);

    const systemKeys = await queueComplaintKeys(systemLoginOf(system));
    expect([shopFile.key, driverFile.key, bothFile.key].every((key) => systemKeys.includes(key))).toBe(true);
  });

  it('3. the other to-do figures are not changed by the complaint scope: a SHOP-only ADMIN still gets FORBIDDEN for the money figures, SYSTEM still gets its own figures', async () => {
    const response = await getAs(admin, shopOnly.login, '/overview?range=today');
    const todo = (adminData(response) as Json).todo as Json[];
    expect(todo.find((entry) => entry.key === 'topups_pending')).toEqual({ key: 'topups_pending', status: 'FORBIDDEN' });
    expect(todo.find((entry) => entry.key === 'shipper_profiles_pending')).toEqual({ key: 'shipper_profiles_pending', status: 'FORBIDDEN' });
    expect(todo.find((entry) => entry.key === 'shop_profiles_pending')).toMatchObject({ status: 'NOT_READY', reason: 'M02_NO_SHOP_REVIEW_FLOW' });
  });
});
