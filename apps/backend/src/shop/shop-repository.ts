import { ShopLogo } from './shop-logo';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK_CTE, toSafeInteger } from './shop-db';
import { OWNER_MEMBER_ROLE, ShopStatus } from './shop-types';

/** The profile fields a save writes, already validated and normalized by the caller. */
export interface ShopProfileFields {
  readonly logo?: ShopLogo | null;
  readonly name: string;
  readonly contactPhoneNormalized: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly addressText: string;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly serviceAreaId: string | null;
}

export interface ShopRow extends ShopProfileFields {
  readonly shopId: string;
  readonly status: ShopStatus;
  readonly acceptingOrders: boolean;
  readonly version: number;
}

interface RawShop {
  logo?: ShopLogo | null;
  shop_id: string;
  name: string;
  contact_phone_normalized: string;
  zalo: string | null;
  facebook: string | null;
  address_text: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  service_area_id: string | null;
  status: ShopStatus;
  accepting_orders: boolean;
  version: string;
}

function toShop(row: RawShop): ShopRow {
  return {
    shopId: row.shop_id,
    ...(row.logo == null ? {} : { logo: row.logo }),
    name: row.name,
    contactPhoneNormalized: row.contact_phone_normalized,
    zalo: row.zalo,
    facebook: row.facebook,
    addressText: row.address_text,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    serviceAreaId: row.service_area_id,
    status: row.status,
    acceptingOrders: row.accepting_orders,
    version: toSafeInteger(row.version),
  };
}

/**
 * SQL for app.shops and app.shop_members. M02 owns both tables; no other module issues SQL against them.
 * Every method takes the caller's TransactionContext: none of them begins, commits or rolls back anything.
 */
@Injectable()
export class ShopRepository {
  async saveLogo(context: TransactionContext, shopId: string, logo: ShopLogo | null | undefined): Promise<void> {
    if (logo === undefined) return;
    await context.query('UPDATE app.shops SET logo = $2::jsonb WHERE shop_id = $1::uuid', [shopId, logo === null ? null : JSON.stringify(logo)]);
  }

  async publicLogo(context: TransactionContext, shopId: string): Promise<ShopLogo | undefined> {
    const result = await context.query<{ logo: ShopLogo }>(`SELECT s.logo FROM app.shops s
      JOIN app.service_areas a ON a.service_area_id = s.service_area_id
      WHERE s.shop_id = $1::uuid AND s.status = 'ACTIVE' AND a.status = 'ACTIVE' AND s.logo IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app.shop_members m JOIN app.users u ON u.user_id = m.user_id
        WHERE m.shop_id = s.shop_id AND m.member_role = 'OWNER' AND u.status <> 'ACTIVE')`, [shopId]);
    return result.rows[0]?.logo;
  }

  /** The account that owns the shop (read only, no lock): who a notification about the shop goes to. */
  async ownerUserIdOfShop(context: TransactionContext, shopId: string): Promise<string | undefined> {
    const result = await context.query<{ user_id: string }>(`SELECT user_id FROM app.shop_members WHERE shop_id = $1::uuid AND member_role = $2`, [shopId, OWNER_MEMBER_ROLE]);
    return result.rows[0]?.user_id;
  }

  /** True when this account owns the shop (read only, no lock). */
  async isOwnerOfShop(context: TransactionContext, shopId: string, userId: string): Promise<boolean> {
    return (await this.ownerUserIdOfShop(context, shopId)) === userId;
  }

  /**
   * Locks the user's OWNER membership and then the shop it points at, in that order (the A2 global lock
   * order), and returns the shop as it is AFTER the locks. Two statements on purpose: a join with
   * FOR UPDATE does not promise which row is locked first. Returns undefined when the user owns no shop; in
   * that case nothing was locked, and the caller's user-row lock is what serializes concurrent creators.
   */
  async lockOwnedShop(context: TransactionContext, userId: string): Promise<ShopRow | undefined> {
    const membership = await context.query<{ shop_id: string }>(
      `SELECT shop_id
         FROM app.shop_members
        WHERE user_id = $1::uuid AND member_role = $2
          FOR UPDATE`,
      [userId, OWNER_MEMBER_ROLE],
    );
    const owned = membership.rows[0];
    if (owned === undefined) {
      return undefined;
    }
    const shop = await context.query<RawShop>(
      `SELECT shop_id, name, contact_phone_normalized, zalo, facebook, address_text, pickup_lat, pickup_lng,
              service_area_id, status, accepting_orders, version, logo
         FROM app.shops
        WHERE shop_id = $1::uuid
          FOR UPDATE`,
      [owned.shop_id],
    );
    const row = shop.rows[0];
    if (row === undefined) {
      // The foreign key makes this impossible; refuse to continue on a broken invariant.
      throw new TechnicalError('internal', 'Shop of an owner membership was not found');
    }
    return toShop(row);
  }

  /** The shop by id, locked FOR SHARE (M10: an Order is placed against a shop that cannot be disabled or moved until the Order has committed). */
  async lockShopShared(context: TransactionContext, shopId: string): Promise<ShopRow | undefined> {
    const result = await context.query<RawShop>(
      `SELECT shop_id, name, contact_phone_normalized, zalo, facebook, address_text, pickup_lat, pickup_lng,
              service_area_id, status, accepting_orders, version, logo
         FROM app.shops WHERE shop_id = $1::uuid FOR SHARE`,
      [shopId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toShop(row);
  }

  /**
   * The shop by id, whatever its status, locked FOR UPDATE (administration: disable / enable). The owner's membership is NOT locked: an
   * administrator never changes the membership, and every owner path locks membership then shop, so this order cannot close a cycle.
   */
  async lockShopForUpdate(context: TransactionContext, shopId: string): Promise<ShopRow | undefined> {
    const result = await context.query<RawShop>(
      `SELECT shop_id, name, contact_phone_normalized, zalo, facebook, address_text, pickup_lat, pickup_lng,
              service_area_id, status, accepting_orders, version, logo
         FROM app.shops WHERE shop_id = $1::uuid FOR UPDATE`,
      [shopId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toShop(row);
  }

  /**
   * ACTIVE <-> DISABLED at exactly `expectedVersion` and returns the new version. Nothing else of the shop changes (profile, schedule, dishes,
   * owner membership and the legacy accepting_orders column stay as they are). An update that touches no row is a broken invariant: the caller
   * holds the row FOR UPDATE and has just compared status and version.
   */
  async changeStatus(context: TransactionContext, shopId: string, from: 'ACTIVE' | 'DISABLED', to: 'ACTIVE' | 'DISABLED', expectedVersion: number): Promise<number> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.shops
          SET status = $4,
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE shop_id = $1::uuid AND status = $2 AND version = $3::bigint
        RETURNING version`,
      [shopId, from, expectedVersion, to],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Shop status was not changed');
    }
    return toSafeInteger(row.version);
  }

  /**
   * Reads the shop the user owns, whatever its status, or undefined when the user owns none. ONE statement on
   * purpose: the OWNER membership and the shop are joined in a single snapshot, so the caller can never see a
   * membership from one moment and a shop from another. It locks nothing and writes nothing.
   */
  async findOwnedShop(context: TransactionContext, userId: string): Promise<ShopRow | undefined> {
    const result = await context.query<RawShop>(
      `SELECT s.shop_id, s.name, s.contact_phone_normalized, s.zalo, s.facebook, s.address_text, s.pickup_lat,
              s.pickup_lng, s.service_area_id, s.status, s.accepting_orders, s.version, s.logo
         FROM app.shop_members m
         JOIN app.shops s ON s.shop_id = m.shop_id
        WHERE m.user_id = $1::uuid AND m.member_role = $2`,
      [userId, OWNER_MEMBER_ROLE],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toShop(row);
  }

  /** Inserts an INCOMPLETE draft at version 1 that is not accepting orders. */
  async insertDraft(context: TransactionContext, shopId: string, profile: ShopProfileFields): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.shops (
         shop_id, name, contact_phone_normalized, zalo, facebook, address_text, pickup_lat, pickup_lng,
         service_area_id, status, accepting_orders, version, created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, $4, $5, $6, $7::double precision, $8::double precision, $9::uuid,
              'INCOMPLETE', false, 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock`,
      [
        shopId,
        profile.name,
        profile.contactPhoneNormalized,
        profile.zalo,
        profile.facebook,
        profile.addressText,
        profile.pickupLat,
        profile.pickupLng,
        profile.serviceAreaId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Shop was not written');
    }
  }

  /**
   * Inserts the OWNER membership. Returns false when a unique rule already holds (the shop has an owner, or the
   * user already owns a shop): ON CONFLICT DO NOTHING lets the database decide and never raises a raw unique
   * violation, so the caller maps `false` to SHOP_ONBOARDING_EXISTS.
   */
  async insertOwnerMembership(context: TransactionContext, shopId: string, userId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.shop_members (shop_id, user_id, member_role, created_at)
       SELECT $1::uuid, $2::uuid, $3, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT DO NOTHING`,
      [shopId, userId, OWNER_MEMBER_ROLE],
    );
    return result.rowCount === 1;
  }

  /**
   * Replaces the profile of an INCOMPLETE shop at exactly `expectedVersion` and returns the new version. The
   * WHERE clause repeats the status and version the caller verified under lock: it is a second guard, and an
   * update that touches no row is a broken invariant, not a business answer.
   */
  async updateDraft(
    context: TransactionContext,
    shopId: string,
    expectedVersion: number,
    profile: ShopProfileFields,
  ): Promise<number> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.shops
          SET name = $3,
              contact_phone_normalized = $4,
              zalo = $5,
              facebook = $6,
              address_text = $7,
              pickup_lat = $8::double precision,
              pickup_lng = $9::double precision,
              service_area_id = $10::uuid,
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE shop_id = $1::uuid AND status = 'INCOMPLETE' AND version = $2::bigint
        RETURNING version`,
      [
        shopId,
        expectedVersion,
        profile.name,
        profile.contactPhoneNormalized,
        profile.zalo,
        profile.facebook,
        profile.addressText,
        profile.pickupLat,
        profile.pickupLng,
        profile.serviceAreaId,
      ],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Shop draft was not updated');
    }
    return toSafeInteger(row.version);
  }

  /**
   * Replaces the profile of an ACTIVE shop at exactly `expectedVersion` (M02-A) and returns the new version. Like
   * updateDraft, the WHERE clause repeats the status and version the caller verified under the shop lock: it is a
   * second guard, and an update that touches no row is a broken invariant, not a business answer. The status, the
   * legacy accepting_orders column and the ownership are never written here; the database still refuses an ACTIVE
   * shop without a pickup point and a service area.
   */
  async updateActiveProfile(
    context: TransactionContext,
    shopId: string,
    expectedVersion: number,
    profile: ShopProfileFields,
  ): Promise<number> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.shops
          SET name = $3,
              contact_phone_normalized = $4,
              zalo = $5,
              facebook = $6,
              address_text = $7,
              pickup_lat = $8::double precision,
              pickup_lng = $9::double precision,
              service_area_id = $10::uuid,
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE shop_id = $1::uuid AND status = 'ACTIVE' AND version = $2::bigint
        RETURNING version`,
      [
        shopId,
        expectedVersion,
        profile.name,
        profile.contactPhoneNormalized,
        profile.zalo,
        profile.facebook,
        profile.addressText,
        profile.pickupLat,
        profile.pickupLng,
        profile.serviceAreaId,
      ],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Shop profile was not updated');
    }
    return toSafeInteger(row.version);
  }

  /**
   * Advances the shared version of an ACTIVE shop by exactly one (a business-hours replacement changes no profile
   * column, but profile and hours share ONE version) and returns it. The WHERE clause repeats the status and version
   * the caller verified under lock; an update that touches no row is a broken invariant.
   */
  async advanceVersion(context: TransactionContext, shopId: string, expectedVersion: number): Promise<number> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.shops
          SET version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE shop_id = $1::uuid AND status = 'ACTIVE' AND version = $2::bigint
        RETURNING version`,
      [shopId, expectedVersion],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Shop version was not advanced');
    }
    return toSafeInteger(row.version);
  }

  /**
   * INCOMPLETE -> ACTIVE at exactly `expectedVersion`, still not accepting orders, and returns the new
   * version. The database also refuses an ACTIVE shop without a pickup point and a service area.
   */
  async activate(context: TransactionContext, shopId: string, expectedVersion: number): Promise<number> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.shops
          SET status = 'ACTIVE',
              accepting_orders = false,
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE shop_id = $1::uuid AND status = 'INCOMPLETE' AND version = $2::bigint
        RETURNING version`,
      [shopId, expectedVersion],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Shop was not activated');
    }
    return toSafeInteger(row.version);
  }
}
