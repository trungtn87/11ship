// The ONE statement that reads a shop for M02-A (profile, service-area status, weekly schedule and availability).
// It lives in its own file, away from the repositories, because it is built from a clock expression: production
// passes exactly PRODUCTION_CLOCK (the PostgreSQL clock) and nothing else; the integration tests build the very same
// statement around a fixed instant to prove the boundaries. There is no clock override anywhere at runtime.
//
// Why one statement: the profile, the area status, the schedule rows and `evaluated_at` come from ONE snapshot, so a
// concurrent mutation is seen entirely or not at all (never a profile of one version with hours of another), and the
// membership test and evaluated_at use the SAME instant: the clock CTE is MATERIALIZED, so clock_timestamp() runs once.
//
// Time model (docs/tasks/M02-A-shop-management.md sections 3 and 5):
//   - the local time is the PostgreSQL instant converted AT TIME ZONE 'Asia/Ho_Chi_Minh'; the process time zone and
//     the device clock are never consulted;
//   - week_minute is the fractional minute since local Monday 00:00 (date_trunc('week') is ISO: Monday), so a second
//     or a millisecond inside a minute is part of the instant: the open minute is inclusive, the close is exclusive;
//   - an interval opens at (weekday - 1) * 1440 + start_minute and closes at (weekday - 1 + end_day_offset) * 1440 +
//     end_minute on the same week line; one that runs past Sunday midnight is also tested one week earlier
//     (week_minute + 10080), which is the wrap Sunday -> Monday.
//
// accepting_orders is deliberately absent from the column list: availability never reads the legacy column.

export const AVAILABILITY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** The only clock expression production uses. */
export const PRODUCTION_CLOCK = 'clock_timestamp()';

export type SnapshotSource = 'owner' | 'shop';

const SELECT_LIST = `
SELECT s.shop_id, s.name, s.contact_phone_normalized, s.zalo, s.facebook, s.address_text, s.pickup_lat, s.pickup_lng,
       s.service_area_id, s.status, s.version,
       a.status AS area_status,
       to_char(date_trunc('milliseconds', l.instant) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS evaluated_at,
       COALESCE(
         (SELECT json_agg(
                   json_build_object(
                     'weekday', h.weekday,
                     'start_minute', h.start_minute,
                     'end_minute', h.end_minute,
                     'end_day_offset', h.end_day_offset
                   )
                   ORDER BY h.weekday, h.start_minute, h.end_minute, h.end_day_offset
                 )
            FROM app.shop_business_hours h
           WHERE h.shop_id = s.shop_id),
         '[]'::json
       ) AS hours,
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
       ) AS in_hours`;

const FROM_OWNER = `
  FROM app.shop_members m
  JOIN app.shops s ON s.shop_id = m.shop_id
  LEFT JOIN app.service_areas a ON a.service_area_id = s.service_area_id
 CROSS JOIN local_time l
 WHERE m.user_id = $1::uuid AND m.member_role = 'OWNER'`;

const FROM_SHOP = `
  FROM app.shops s
  LEFT JOIN app.service_areas a ON a.service_area_id = s.service_area_id
 CROSS JOIN local_time l
 WHERE s.shop_id = $1::uuid`;

/**
 * Builds the snapshot statement. `clockExpression` is a fixed SQL fragment chosen by code (PRODUCTION_CLOCK, or a
 * typed parameter placeholder in a test), never client input. $1 is the owner user id ('owner') or the shop id
 * ('shop'); a test that passes a placeholder such as `$2::timestamptz` supplies that parameter itself.
 */
export function buildAvailabilitySnapshotSql(clockExpression: string, source: SnapshotSource): string {
  return `
WITH clock AS MATERIALIZED (
  SELECT ${clockExpression} AS instant
),
local_time AS MATERIALIZED (
  SELECT c.instant,
         EXTRACT(EPOCH FROM (
           (c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}')
           - date_trunc('week', c.instant AT TIME ZONE '${AVAILABILITY_TIME_ZONE}')
         )) / 60 AS week_minute
    FROM clock c
)${SELECT_LIST}${source === 'owner' ? FROM_OWNER : FROM_SHOP}`;
}

export const OWNER_SNAPSHOT_SQL = buildAvailabilitySnapshotSql(PRODUCTION_CLOCK, 'owner');
export const SHOP_SNAPSHOT_SQL = buildAvailabilitySnapshotSql(PRODUCTION_CLOCK, 'shop');
