import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { BusinessInterval, BusinessIntervalWire, fromWire } from './business-hours';
import { OWNER_SNAPSHOT_SQL, SHOP_SNAPSHOT_SQL } from './shop-availability-sql';
import { toSafeInteger } from './shop-db';
import { SERVICE_AREA_STATUSES, SHOP_STATUSES, ShopAvailability, ShopStatus } from './shop-types';

/** The raw row of the snapshot statement (see shop-availability-sql.ts). */
export interface RawShopSnapshot {
  shop_id: string;
  name: string;
  contact_phone_normalized: string;
  zalo: string | null;
  facebook: string | null;
  address_text: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  service_area_id: string | null;
  status: string;
  version: string;
  area_status: string | null;
  evaluated_at: string;
  hours: unknown;
  has_hours: boolean;
  in_hours: boolean;
}

/**
 * Everything GET /v1/shop/me returns about a shop, read in ONE statement: profile, status, version, the schedule
 * and the availability computed at one instant. `accepting_orders` is deliberately not part of it.
 */
export interface ShopSnapshot {
  readonly shopId: string;
  readonly name: string;
  readonly contactPhoneNormalized: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly addressText: string;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly serviceAreaId: string | null;
  readonly status: ShopStatus;
  readonly version: number;
  readonly hours: readonly BusinessInterval[];
  readonly availability: ShopAvailability;
}

const EVALUATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isShopStatus(value: string): value is ShopStatus {
  return (SHOP_STATUSES as readonly string[]).includes(value);
}

function broken(): never {
  throw new TechnicalError('internal', 'Database returned an unexpected shop snapshot');
}

function parseHours(raw: unknown): BusinessInterval[] {
  if (!Array.isArray(raw)) {
    return broken();
  }
  return raw.map((entry: unknown): BusinessInterval => {
    if (typeof entry !== 'object' || entry === null) {
      return broken();
    }
    const wire = entry as Record<string, unknown>;
    return fromWire({
      weekday: toSafeInteger(wire.weekday),
      start_minute: toSafeInteger(wire.start_minute),
      end_minute: toSafeInteger(wire.end_minute),
      end_day_offset: toSafeInteger(wire.end_day_offset),
    } satisfies BusinessIntervalWire);
  });
}

/**
 * ONLINE iff the shop is ACTIVE AND its service area is ACTIVE AND the instant lies in at least one interval.
 * The first failing condition is the reason, in the documented order. A status nobody recognizes is a broken
 * invariant, never "ONLINE by default": it is a technical error.
 */
export function evaluateAvailability(
  status: string,
  areaStatus: string | null,
  hasHours: boolean,
  inHours: boolean,
  evaluatedAt: string,
): ShopAvailability {
  if (!isShopStatus(status) || !EVALUATED_AT_PATTERN.test(evaluatedAt)) {
    return broken();
  }
  if (status === 'DISABLED') {
    return { online: false, reason: 'SHOP_DISABLED', evaluatedAt };
  }
  if (status === 'INCOMPLETE') {
    return { online: false, reason: 'SHOP_INCOMPLETE', evaluatedAt };
  }
  // ACTIVE: an ACTIVE shop always has an area (database CHECK + FK), so a missing or unknown area status is broken.
  if (areaStatus === null || !(SERVICE_AREA_STATUSES as readonly string[]).includes(areaStatus)) {
    return broken();
  }
  if (areaStatus !== 'ACTIVE') {
    return { online: false, reason: 'SERVICE_AREA_INACTIVE', evaluatedAt };
  }
  if (!hasHours) {
    return { online: false, reason: 'NO_BUSINESS_HOURS', evaluatedAt };
  }
  if (!inHours) {
    return { online: false, reason: 'OUTSIDE_BUSINESS_HOURS', evaluatedAt };
  }
  return { online: true, reason: 'ONLINE', evaluatedAt };
}

/** Maps the raw statement row to the snapshot. Exported so a test that supplies its own clock uses the same code. */
export function toShopSnapshot(row: RawShopSnapshot): ShopSnapshot {
  if (typeof row.has_hours !== 'boolean' || typeof row.in_hours !== 'boolean' || !isShopStatus(row.status)) {
    return broken();
  }
  return {
    shopId: row.shop_id,
    name: row.name,
    contactPhoneNormalized: row.contact_phone_normalized,
    zalo: row.zalo,
    facebook: row.facebook,
    addressText: row.address_text,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    serviceAreaId: row.service_area_id,
    status: row.status,
    version: toSafeInteger(row.version),
    hours: parseHours(row.hours),
    availability: evaluateAvailability(row.status, row.area_status, row.has_hours, row.in_hours, row.evaluated_at),
  };
}

/**
 * The read side of M02-A: the shop, its schedule and its availability in ONE statement and one snapshot.
 *
 * It is a participant, not a coordinator: it takes the caller's TransactionContext, opens no transaction and takes no
 * session or user lock (the coordinator's authorization does). It reads, writes nothing and locks nothing. The clock
 * is the PostgreSQL clock, sampled once inside the statement; no application or device clock is ever used.
 *
 * `availabilityOf` is the read port a later Order module consumes. A GET that says ONLINE grants nothing: Order must
 * re-check through a write/lock port inside the transaction that creates an order (that port is not part of this
 * slice).
 */
@Injectable()
export class ShopAvailabilityReader {
  /** The shop the user OWNS, or undefined when the user owns none. Membership and shop are one snapshot. */
  async snapshotOfOwner(context: TransactionContext, userId: string): Promise<ShopSnapshot | undefined> {
    const result = await context.query<RawShopSnapshot>(OWNER_SNAPSHOT_SQL, [userId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toShopSnapshot(row);
  }

  /** The shop with this id, whatever its status, or undefined when there is none (the public shop view decides what to show). */
  async snapshotOfShop(context: TransactionContext, shopId: string): Promise<ShopSnapshot | undefined> {
    const result = await context.query<RawShopSnapshot>(SHOP_SNAPSHOT_SQL, [shopId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toShopSnapshot(row);
  }

  /** The availability of one shop. Throws the typed SHOP_NOT_FOUND when there is no such shop. */
  async availabilityOf(context: TransactionContext, shopId: string): Promise<ShopAvailability> {
    const result = await context.query<RawShopSnapshot>(SHOP_SNAPSHOT_SQL, [shopId]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return toShopSnapshot(row).availability;
  }
}
