import { Injectable } from '@nestjs/common';
import { TERMINAL_STATES } from '../delivery/delivery-constants';
import { ENDED_STATUSES } from '../orders/order-constants';
import { pinInAreaSql, pinInCircleSql } from '../shop/shop-availability-sql';
import { toSafeInteger } from '../shop/shop-db';
import { TransactionContext } from '../transaction/transaction-context';
import { Coverage } from './admin-service-area-validation';

export interface AreaRecord {
  readonly serviceAreaId: string;
  readonly code: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
  readonly coverage: Coverage | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface AreaCounts {
  readonly shopsTotal: number;
  /** ACTIVE, ever activated, owner not locked: the shops customers may see today (before schedule and dishes). */
  readonly shopsPublic: number;
  /** Shops with a stored pin that lies outside the area's CURRENT circle (0 while the area has no circle). */
  readonly pinsOutside: number;
}

export interface AreaImpact {
  readonly shopsTotal: number;
  readonly shopsPublic: number;
  readonly pinsOutsideCurrent: number;
  /** Pins outside the circle that WOULD be in force (the proposed one, else the current one). */
  readonly pinsOutsideProposed: number;
  /** Public shops whose pin is outside the proposed circle but was inside the current one (they would stop being listed). */
  readonly publicShopsNewlyOutside: number;
  readonly ordersOpen: number;
  readonly activeDeliveries: number;
}

interface Raw {
  service_area_id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; version: string;
  coverage_lat: number | null; coverage_lng: number | null; coverage_radius_m: number | null; created_ms: string; updated_ms: string;
}

const COLUMNS = `a.service_area_id, a.code, a.name, a.status, a.version::text AS version, a.coverage_lat, a.coverage_lng, a.coverage_radius_m,
       (extract(epoch FROM a.created_at) * 1000)::bigint::text AS created_ms, (extract(epoch FROM a.updated_at) * 1000)::bigint::text AS updated_ms`;

function toRecord(row: Raw): AreaRecord {
  const configured = row.coverage_radius_m !== null && row.coverage_lat !== null && row.coverage_lng !== null;
  return {
    serviceAreaId: row.service_area_id,
    code: row.code,
    name: row.name,
    status: row.status,
    version: toSafeInteger(row.version),
    coverage: configured ? { latitude: Number(row.coverage_lat), longitude: Number(row.coverage_lng), radiusMeters: Number(row.coverage_radius_m) } : null,
    createdAtMs: toSafeInteger(row.created_ms),
    updatedAtMs: toSafeInteger(row.updated_ms),
  };
}

const PUBLIC_SHOP = `s.status = 'ACTIVE' AND s.activated_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app.shop_members om JOIN app.users ou ON ou.user_id = om.user_id WHERE om.shop_id = s.shop_id AND om.member_role = 'OWNER' AND ou.status <> 'ACTIVE')`;

/** SQL of the SYSTEM-only management of app.service_areas (issue #253). A row is only inserted or updated: nothing here deletes an area. */
@Injectable()
export class AdminServiceAreaRepository {
  async list(context: TransactionContext): Promise<{ area: AreaRecord; counts: AreaCounts }[]> {
    const result = await context.query<Raw & { shops_total: string; shops_public: string; pins_outside: string }>(
      `SELECT ${COLUMNS},
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = a.service_area_id) AS shops_total,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = a.service_area_id AND ${PUBLIC_SHOP}) AS shops_public,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = a.service_area_id AND s.pickup_lat IS NOT NULL AND NOT ${pinInAreaSql('s', 'a')}) AS pins_outside
         FROM app.service_areas a
        ORDER BY a.name ASC, a.service_area_id ASC`,
    );
    return result.rows.map((row) => ({
      area: toRecord(row),
      counts: { shopsTotal: toSafeInteger(row.shops_total), shopsPublic: toSafeInteger(row.shops_public), pinsOutside: toSafeInteger(row.pins_outside) },
    }));
  }

  async find(context: TransactionContext, id: string, lock: boolean): Promise<AreaRecord | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.service_areas a WHERE a.service_area_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [id]);
    return result.rows[0] === undefined ? undefined : toRecord(result.rows[0]);
  }

  async codeExists(context: TransactionContext, code: string): Promise<boolean> {
    const result = await context.query('SELECT 1 FROM app.service_areas WHERE lower(code) = lower($1)', [code]);
    return result.rows.length > 0;
  }

  async counts(context: TransactionContext, id: string): Promise<AreaCounts> {
    const row = (await this.list(context)).find((entry) => entry.area.serviceAreaId === id);
    return row?.counts ?? { shopsTotal: 0, shopsPublic: 0, pinsOutside: 0 };
  }

  /**
   * What a change would do, counted at one snapshot (a circle that is not proposed stays as it is). The caller holds the area row FOR UPDATE when this
   * backs a write. Pure reads of shops, orders and deliveries: nothing is moved, closed or rewritten.
   */
  async impact(context: TransactionContext, area: AreaRecord, proposed: Coverage | null): Promise<AreaImpact> {
    const next = proposed ?? area.coverage;
    const cur = area.coverage;
    // Every parameter is referenced whatever the circles are (PostgreSQL cannot type an unused one); a missing circle simply proves nothing (never "outside").
    const outsideNext = `($5::integer IS NOT NULL AND s.pickup_lat IS NOT NULL AND NOT ${pinInCircleSql('s', '$3::double precision', '$4::double precision', '$5::integer')})`;
    const outsideCur = `($8::integer IS NOT NULL AND s.pickup_lat IS NOT NULL AND NOT ${pinInCircleSql('s', '$6::double precision', '$7::double precision', '$8::integer')})`;
    const result = await context.query<{ total: string; pub: string; out_cur: string; out_next: string; newly: string; orders: string; deliveries: string }>(
      `SELECT (SELECT count(*) FROM app.shops s WHERE s.service_area_id = $1::uuid) AS total,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = $1::uuid AND ${PUBLIC_SHOP}) AS pub,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = $1::uuid AND (${outsideCur})) AS out_cur,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = $1::uuid AND (${outsideNext})) AS out_next,
              (SELECT count(*) FROM app.shops s WHERE s.service_area_id = $1::uuid AND ${PUBLIC_SHOP} AND (${outsideNext}) AND NOT (${outsideCur})) AS newly,
              (SELECT count(*) FROM app.orders o JOIN app.shops s ON s.shop_id = o.shop_id WHERE s.service_area_id = $1::uuid AND o.status <> ALL($2::text[])) AS orders,
              (SELECT count(*) FROM app.deliveries d JOIN app.shops s ON s.shop_id = d.shop_id WHERE s.service_area_id = $1::uuid AND d.state <> ALL($9::text[])) AS deliveries`,
      [
        area.serviceAreaId, ENDED_STATUSES,
        next?.latitude ?? null, next?.longitude ?? null, next?.radiusMeters ?? null,
        cur?.latitude ?? null, cur?.longitude ?? null, cur?.radiusMeters ?? null,
        TERMINAL_STATES,
      ],
    );
    const row = result.rows[0];
    return {
      shopsTotal: toSafeInteger(row?.total),
      shopsPublic: toSafeInteger(row?.pub),
      pinsOutsideCurrent: toSafeInteger(row?.out_cur),
      pinsOutsideProposed: toSafeInteger(row?.out_next),
      publicShopsNewlyOutside: toSafeInteger(row?.newly),
      ordersOpen: toSafeInteger(row?.orders),
      activeDeliveries: toSafeInteger(row?.deliveries),
    };
  }

  async insert(context: TransactionContext, areaId: string, input: { code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; coverage: Coverage | null }): Promise<void> {
    await context.query(
      `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at, coverage_lat, coverage_lng, coverage_radius_m)
       VALUES ($1::uuid, $2, $3, $4, 1, date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', clock_timestamp()), $5, $6, $7)`,
      [areaId, input.code, input.name, input.status, input.coverage?.latitude ?? null, input.coverage?.longitude ?? null, input.coverage?.radiusMeters ?? null],
    );
  }

  async update(context: TransactionContext, areaId: string, changes: { name: string; coverage: Coverage | undefined; status: 'ACTIVE' | 'INACTIVE' }): Promise<void> {
    await context.query(
      `UPDATE app.service_areas
          SET name = $2, status = $3, version = version + 1, updated_at = greatest(updated_at, date_trunc('milliseconds', clock_timestamp())),
              coverage_lat = CASE WHEN $4::boolean THEN $5::double precision ELSE coverage_lat END,
              coverage_lng = CASE WHEN $4::boolean THEN $6::double precision ELSE coverage_lng END,
              coverage_radius_m = CASE WHEN $4::boolean THEN $7::integer ELSE coverage_radius_m END
        WHERE service_area_id = $1::uuid`,
      [areaId, changes.name, changes.status, changes.coverage !== undefined, changes.coverage?.latitude ?? null, changes.coverage?.longitude ?? null, changes.coverage?.radiusMeters ?? null],
    );
  }
}
