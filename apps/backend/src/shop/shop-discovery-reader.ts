import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { AVAILABILITY_TIME_ZONE } from './shop-availability-sql';

/**
 * A shop a customer may be shown (issue #190): ACTIVE, in an ACTIVE area, its owner account not locked, with a weekly schedule AND a real pickup point,
 * and what the schedule says at the one instant of the read. A shop without a schedule or a pickup point is "not set up", not "closed": it is not
 * listed at all (a closed shop that IS set up stays listed). Whether it also has a sellable dish is the Menu module's fact, joined by the coordinator.
 */
export interface DiscoverableShop {
  readonly hasLogo?: boolean;
  readonly logoVersion?: string;
  readonly shopId: string;
  readonly name: string;
  readonly addressText: string;
  readonly pickupLat?: number | null;
  readonly pickupLng?: number | null;
  readonly hasHours: boolean;
  readonly inHours: boolean;
}

// The same schedule test as the availability read port (shop-availability-sql.ts): one MATERIALIZED PostgreSQL instant, local time in
// Asia/Ho_Chi_Minh, open minute inclusive, close exclusive, the Sunday -> Monday wrap. It reads only the Shop tables.
const ELIGIBLE_SHOPS_SQL = `
WITH clock AS MATERIALIZED (
  SELECT clock_timestamp() AS instant
),
local_time AS MATERIALIZED (
  SELECT c.instant,
         EXTRACT(EPOCH FROM (
           (c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}')
           - date_trunc('week', c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}')
         )) / 60 AS week_minute
    FROM clock c
)
SELECT s.shop_id, s.name, s.address_text, s.pickup_lat, s.pickup_lng, (s.logo IS NOT NULL) AS has_logo, s.version::text AS logo_version,
       EXISTS (SELECT 1 FROM app.shop_business_hours h WHERE h.shop_id = s.shop_id) AS has_hours,
       EXISTS (
         SELECT 1
           FROM app.shop_business_hours h
          CROSS JOIN LATERAL (
            SELECT (h.weekday - 1) * 1440 + h.start_minute AS open_at,
                   (h.weekday - 1 + h.end_day_offset) * 1440 + h.end_minute AS close_at
          ) w
          WHERE h.shop_id = s.shop_id
            AND ((l.week_minute >= w.open_at AND l.week_minute < w.close_at)
              OR (l.week_minute + 10080 >= w.open_at AND l.week_minute + 10080 < w.close_at))
       ) AS in_hours
  FROM app.shops s
  JOIN app.service_areas a ON a.service_area_id = s.service_area_id
 CROSS JOIN local_time l
 WHERE s.status = 'ACTIVE'
   AND a.status = 'ACTIVE'
   AND s.service_area_id = $1::uuid
   AND (s.pickup_lat IS NOT NULL AND s.pickup_lng IS NOT NULL AND NOT (s.pickup_lat = 0 AND s.pickup_lng = 0))
   AND EXISTS (SELECT 1 FROM app.shop_business_hours hh WHERE hh.shop_id = s.shop_id)
   AND NOT EXISTS (SELECT 1 FROM app.shop_members om JOIN app.users ou ON ou.user_id = om.user_id WHERE om.shop_id = s.shop_id AND om.member_role = 'OWNER' AND ou.status <> 'ACTIVE')
 ORDER BY s.shop_id`;

/**
 * Read side of customer discovery (M02): the shops of one service area that may be shown at all, with their open/closed state. Whether
 * a shop also has a public dish is the Menu module's fact, so the coordinator joins the two; this port never reads a menu table.
 */
@Injectable()
export class ShopDiscoveryReader {
  async eligibleShopsOfArea(context: TransactionContext, serviceAreaId: string): Promise<DiscoverableShop[]> {
    const result = await context.query<{ shop_id: string; name: string; address_text: string; pickup_lat: number | string | null; pickup_lng: number | string | null; has_logo?: boolean; logo_version?: string; has_hours: boolean; in_hours: boolean }>(ELIGIBLE_SHOPS_SQL, [serviceAreaId]);
    return result.rows.map((row) => ({ shopId: row.shop_id, pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat), pickupLng: row.pickup_lng == null ? null : Number(row.pickup_lng), hasLogo: row.has_logo === true, logoVersion: row.logo_version, name: row.name, addressText: row.address_text, hasHours: row.has_hours, inHours: row.in_hours }));
  }

  /**
   * How many shops are taking orders RIGHT NOW (M12 overview): ACTIVE shop, ACTIVE area, owner account not locked, and inside its weekly hours at the one
   * PostgreSQL instant of the read. It is the very predicate of `availability` (shop-availability-sql.ts), counted instead of listed.
   */
  /** Include closed and off-page shops: open-only lists must wake when a currently absent shop opens. */
  async nextRefreshMs(context: TransactionContext, areaId: string): Promise<number | null> {
    const result = await context.query<{ delay: string | null }>(`
      WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS t),
      local_clock AS (SELECT EXTRACT(EPOCH FROM ((t AT TIME ZONE '${AVAILABILITY_TIME_ZONE}') - date_trunc('week', t AT TIME ZONE '${AVAILABILITY_TIME_ZONE}'))) * 1000 AS ms FROM clock)
      SELECT min(CASE WHEN delta = 0 THEN 604800000 ELSE delta END)::text AS delay
      FROM app.shop_business_hours h JOIN app.shops s ON s.shop_id = h.shop_id CROSS JOIN local_clock
      CROSS JOIN LATERAL (VALUES (((h.weekday - 1) * 1440 + h.start_minute) * 60000::numeric), (((h.weekday - 1 + h.end_day_offset) * 1440 + h.end_minute) * 60000::numeric)) b(ms)
      CROSS JOIN LATERAL (SELECT mod(mod(b.ms - local_clock.ms, 604800000) + 604800000, 604800000) AS delta) d
      WHERE s.service_area_id = $1::uuid AND s.status = 'ACTIVE'`, [areaId]);
    return result.rows[0]?.delay == null ? null : Math.ceil(Number(result.rows[0].delay));
  }

  async countOnline(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(
      `WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS instant),
            local_time AS MATERIALIZED (
              SELECT c.instant, EXTRACT(EPOCH FROM ((c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}') - date_trunc('week', c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}'))) / 60 AS week_minute
                FROM clock c)
       SELECT count(*)::text AS n
         FROM app.shops s
         JOIN app.service_areas a ON a.service_area_id = s.service_area_id
        CROSS JOIN local_time l
        WHERE s.status = 'ACTIVE' AND a.status = 'ACTIVE'
          AND (s.pickup_lat IS NOT NULL AND s.pickup_lng IS NOT NULL AND NOT (s.pickup_lat = 0 AND s.pickup_lng = 0))
          AND NOT EXISTS (SELECT 1 FROM app.shop_members om JOIN app.users ou ON ou.user_id = om.user_id WHERE om.shop_id = s.shop_id AND om.member_role = 'OWNER' AND ou.status <> 'ACTIVE')
          AND EXISTS (
            SELECT 1 FROM app.shop_business_hours h
             CROSS JOIN LATERAL (SELECT (h.weekday - 1) * 1440 + h.start_minute AS open_at, (h.weekday - 1 + h.end_day_offset) * 1440 + h.end_minute AS close_at) w
             WHERE h.shop_id = s.shop_id
               AND ((l.week_minute >= w.open_at AND l.week_minute < w.close_at) OR (l.week_minute + 10080 >= w.open_at AND l.week_minute + 10080 < w.close_at)))`,
    );
    const value = Number(result.rows[0]?.n);
    if (!Number.isSafeInteger(value)) {
      throw new Error('Database returned an unexpected shop count');
    }
    return value;
  }
}
