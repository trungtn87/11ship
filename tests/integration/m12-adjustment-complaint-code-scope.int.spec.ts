import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminData, AdminApp, startAdminApp } from './support/admin-fixtures';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { insertCommissionSource, M07_INVARIANT_TRIGGERS } from './support/delivery-fixtures';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { activatedAdmin, ActivatedAdmin, changeGrant, getAs, Login, permission, purgeDeliveriesOfShops, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12 "Việc cần xử lý" — ADJUSTMENT_PENDING_FINANCE (Owner decision 2026-11-14, option B) on a REAL PostgreSQL through the real administration pipeline.
// A finance administrator (wallet.read) keeps the row of every commission adjustment still waiting for money, so the rows and the source count do not change.
// But the complaint code and the delivery code of such a row are shown ONLY inside the caller's complaint scope (issue #261, the same rule as the complaint list
// and P5-7e): a complaint naming only a shop is hidden from a DRIVER-only finance administrator, and so is a complaint naming a shop AND a Shipper. SYSTEM and a
// full-scope administrator see everything. A hidden code is null and its value appears nowhere in the response.
// The database is shared, so every assertion concerns the rows THIS suite seeded (their ids/codes), backdated so they are the oldest of the shared database.
// Cleanup: app.complaints, app.complaint_adjustments and app.wallet_holds reject DELETE by trigger; the suite lifts the user triggers of those tables for its own
// rows only, in one transaction, then removes the delivery, shop, Shipper profile and owner (the pattern of m12-complaints-unhandled-scope).

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const BACKDATE = '2001-01-01T00:00:00.000Z';
const KIND = 'ADJUSTMENT_PENDING_FINANCE';
const AMOUNT_VND = 15000;

type Scope = 'shopOnly' | 'driverOnly' | 'both';

describe('M12 / M11 #261 — the complaint code of a waiting commission adjustment is shown only inside the caller complaint scope', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let finance: ActivatedAdmin;
  let financeDriverOnly: ActivatedAdmin;
  let noFinance: ActivatedAdmin;
  let shopId = '';
  let driverId = '';
  let walletId = '';
  let ownerId = '';
  let ownerPhone = '';
  const seeded: Record<Scope, { adjustmentKey: string; complaintCode: string; deliveryCode: string }> = {
    shopOnly: { adjustmentKey: '', complaintCode: '', deliveryCode: '' },
    driverOnly: { adjustmentKey: '', complaintCode: '', deliveryCode: '' },
    both: { adjustmentKey: '', complaintCode: '', deliveryCode: '' },
  };

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    // wallet.read needs the DRIVER view (OD-27): the finance rows are read by DRIVER-view administrators only.
    finance = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Tài chính đủ scope ${tag}`);
    financeDriverOnly = await activatedAdmin(admin, system, [permission('DRIVER')], `Tài chính chỉ shipper ${tag}`);
    // No finance right at all (OD-27: wallet.* cannot be granted without the DRIVER view, so this is the administrator outside the finance rows entirely).
    noFinance = await activatedAdmin(admin, system, [permission('SHOP')], `Không quyền tài chính ${tag}`);
    expect((await changeGrant(admin, system, 'grant', finance.userId, 'wallet.read', 0)).status).toBe(200);
    expect((await changeGrant(admin, system, 'grant', financeDriverOnly.userId, 'wallet.read', 0)).status).toBe(200);

    ownerId = randomUUID();
    ownerPhone = randomPhone().normalized;
    await admin.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [ownerId, ownerPhone, await new Argon2idPasswordHasher().hash('owner-not-a-login')],
    );
    shopId = await createActiveShopFor(admin.pool, ownerId);
    driverId = await createDriverFor(admin.pool, ownerId);
    walletId = randomUUID();
    await admin.pool.query(
      'INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, clock_timestamp(), clock_timestamp())',
      [walletId, driverId],
    );
    // Test-only funding (the money-in path is not under test): one ledger credit with its source gate lifted, in ONE transaction (the pattern of the M10 fixtures).
    const funded = await admin.pool.connect();
    try {
      await funded.query('BEGIN');
      await funded.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await funded.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'ADJUSTMENT_CREDIT', 100000, 100000, now())`, [randomUUID(), walletId]);
      await funded.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [walletId]);
      await funded.query('SET CONSTRAINTS ALL IMMEDIATE');
      await funded.query('ALTER TABLE app.wallet_ledger_entries ENABLE TRIGGER wallet_ledger_a_source_gate');
      await funded.query('COMMIT');
    } catch (error) {
      await funded.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      funded.release();
    }

    await seedAdjustment('shopOnly', { shopId, driverId: null });
    await seedAdjustment('driverOnly', { shopId: null, driverId });
    await seedAdjustment('both', { shopId, driverId });
  });

  afterAll(async () => {
    try {
      if (ownerId !== '') {
        // This suite's own adjustments, complaints and commission holds only (the owner is untracked), with the user triggers off for that one transaction.
        const client = await admin.pool.connect();
        try {
          await client.query('BEGIN');
          const lifted = ['complaint_adjustments', 'complaints', 'wallet_holds', 'driver_wallets'];
          for (const table of lifted) {
            await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
          }
          await client.query('DELETE FROM app.complaint_adjustments WHERE created_by = $1::uuid', [ownerId]);
          await client.query('DELETE FROM app.complaints WHERE submitter_user_id = $1::uuid', [ownerId]);
          await client.query('DELETE FROM app.wallet_holds WHERE wallet_id = $1::uuid', [walletId]);
          // The held amount of the removed holds goes with them; the wallet itself is removed by purgePhone below.
          await client.query('UPDATE app.driver_wallets SET held_vnd = 0 WHERE wallet_id = $1::uuid', [walletId]);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          for (const table of lifted) {
            await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
          }
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

  /**
   * One released commission (a delivery, its assignment and its RELEASED hold, born ACTIVE and moved by the one allowed transition, as M04 does), one resolved
   * complaint in the given scope, and its WAITING commission adjustment. All in one transaction; the M07 invariants are checked at its commit.
   */
  async function seedAdjustment(which: Scope, over: { shopId: string | null; driverId: string | null }): Promise<void> {
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET CONSTRAINTS ${M07_INVARIANT_TRIGGERS.join(', ')} DEFERRED`);
      // The hold gate only accepts a hold born while its assignment is ACTIVE; the held commission is then the adjustment's source (no later move is needed).
      const assignmentId = await insertCommissionSource(client, { shopId, userId: ownerId, driverId, amountVnd: AMOUNT_VND, outcome: 'ACTIVE' });
      const found = await client.query<{ delivery_id: string; code: string }>(
        'SELECT d.delivery_id::text AS delivery_id, d.code FROM app.delivery_assignments a JOIN app.deliveries d ON d.delivery_id = a.delivery_id WHERE a.assignment_id = $1::uuid',
        [assignmentId],
      );
      const { delivery_id: deliveryId, code: deliveryCode } = found.rows[0] as { delivery_id: string; code: string };
      await client.query(
        `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, withdrawal_id, version, created_at, updated_at, resolved_at)
         VALUES ($1::uuid, $2::uuid, 'COMMISSION', $3::bigint, 'ACTIVE', $4::uuid, NULL, 1, now(), now(), NULL)`,
        [randomUUID(), walletId, AMOUNT_VND, assignmentId],
      );
      await client.query('ALTER TABLE app.driver_wallets DISABLE TRIGGER USER');
      await client.query('UPDATE app.driver_wallets SET held_vnd = held_vnd + $2::bigint, version = version + 1, updated_at = clock_timestamp() WHERE wallet_id = $1::uuid', [walletId, AMOUNT_VND]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.driver_wallets ENABLE TRIGGER USER');

      const complaintId = randomUUID();
      const complaintCode = `C${randomBytes(4).toString('hex').toUpperCase()}`;
      await client.query(
        `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, delivery_id, shop_id, driver_id, related_code, shop_name,
                                     driver_name, driver_code, scope_key, status, received_at, conclusion, closed_at, body, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, $6::uuid, 'K', 'Quán test',
                 'Shipper test', 'SHP', $7::uuid, 'RESOLVED', $8::timestamptz, 'Đã xác minh', $8::timestamptz, 'Nội dung phản ánh', $8::timestamptz, $8::timestamptz)`,
        [complaintId, complaintCode, ownerId, deliveryId, over.shopId, over.driverId, randomUUID(), BACKDATE],
      );
      const adjustmentId = randomUUID();
      await client.query(
        `INSERT INTO app.complaint_adjustments (adjustment_id, complaint_id, kind, delivery_id, assignment_id, driver_id, original_state, original_assignment_status,
           corrected_result, direction, amount_vnd, status, pending_reason, history_reviewed, successor_delivery_ids, reason, created_by, created_at, updated_at, version)
         VALUES ($1::uuid, $2::uuid, 'COMMISSION', $3::uuid, $4::uuid, $5::uuid, 'accepted', 'ACTIVE', NULL, 'CHARGE_TO_SHIPPER', $6::bigint,
                 'PENDING_FINANCE', 'INSUFFICIENT_BALANCE', true, '{}', 'Fixture điều chỉnh', $7::uuid, $8::timestamptz, $8::timestamptz, 1)`,
        [adjustmentId, complaintId, deliveryId, assignmentId, driverId, AMOUNT_VND, ownerId, BACKDATE],
      );
      await client.query('COMMIT');
      seeded[which] = { adjustmentKey: `${KIND}|adjustment:${adjustmentId}`, complaintCode, deliveryCode };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** The queue as one actor sees the adjustment source: the raw response text, the source count and the items of this kind. */
  async function adjustmentSource(who: Login): Promise<{ text: string; count: number; items: Json[] }> {
    const response = await getAs(admin, who, `/overview/action-queue?kind=${KIND}`);
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    const body = adminData(response) as Json;
    const source = (body.sources as Json[]).find((entry) => entry.kind === KIND) as Json;
    expect(source.status).toBe('OK');
    return { text: response.text, count: source.count as number, items: (body.items as Json[]).filter((item) => item.kind === KIND) };
  }

  const itemOf = (items: Json[], key: string): Json => items.find((item) => item.key === key) as Json;

  it('1. SYSTEM sees the complaint and delivery code of every waiting adjustment, whatever the complaint scope', async () => {
    const { items } = await adjustmentSource(systemLoginOf(system));
    for (const row of Object.values(seeded)) {
      expect(itemOf(items, row.adjustmentKey)).toMatchObject({ code: row.complaintCode, detail: { delivery_code: row.deliveryCode, amount_vnd: AMOUNT_VND } });
    }
  });

  it('5. an administrator without any finance right gets no adjustment source: no row, no count and no code of any waiting adjustment', async () => {
    const response = await getAs(admin, noFinance.login, `/overview/action-queue?kind=${KIND}`);
    expect(response.status).toBe(200);
    const source = (adminData(response) as Json).sources.find((entry: Json) => entry.kind === KIND) as Json;
    expect(source).toEqual({ kind: KIND, status: 'FORBIDDEN' });
    for (const row of Object.values(seeded)) {
      expect(response.text).not.toContain(row.complaintCode);
      expect(response.text).not.toContain(row.deliveryCode);
    }
  });

  it('2. a finance administrator with the full SHOP + DRIVER view sees the codes of all three', async () => {
    const { items } = await adjustmentSource(finance.login);
    for (const row of Object.values(seeded)) {
      expect(itemOf(items, row.adjustmentKey)).toMatchObject({ code: row.complaintCode, detail: { delivery_code: row.deliveryCode } });
    }
  });

  it('3. a DRIVER-only finance administrator sees the code only for the Shipper-only complaint; the shop-only and the both-party complaint lose their codes', async () => {
    const { items } = await adjustmentSource(financeDriverOnly.login);
    expect(itemOf(items, seeded.driverOnly.adjustmentKey)).toMatchObject({ code: seeded.driverOnly.complaintCode, detail: { delivery_code: seeded.driverOnly.deliveryCode } });
    for (const which of ['shopOnly', 'both'] as const) {
      expect(itemOf(items, seeded[which].adjustmentKey)).toMatchObject({ code: null, detail: { delivery_code: null, amount_vnd: AMOUNT_VND } });
    }
  });

  it('4. the hidden codes appear nowhere in the DRIVER-only response, and the rows and the source count are the same as for SYSTEM', async () => {
    const asSystem = await adjustmentSource(systemLoginOf(system));
    const asDriver = await adjustmentSource(financeDriverOnly.login);
    expect(asDriver.count).toBe(asSystem.count);
    expect(asDriver.items.map((item) => item.key).sort()).toEqual(asSystem.items.map((item) => item.key).sort());
    for (const which of ['shopOnly', 'both'] as const) {
      expect(asDriver.text).not.toContain(seeded[which].complaintCode);
      expect(asDriver.text).not.toContain(seeded[which].deliveryCode);
    }
    expect(asDriver.text).toContain(seeded.driverOnly.complaintCode);
  });
});
