import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { ServiceAreaStatus } from './shop-types';

export interface ServiceAreaRow {
  readonly serviceAreaId: string;
  readonly status: ServiceAreaStatus;
}

/** What a client may choose from: an ACTIVE area's identifier and its display name, nothing else (no code, no geometry). */
export interface ActiveServiceAreaRow {
  readonly serviceAreaId: string;
  readonly name: string;
}

/** SQL for app.service_areas. M02 owns the table; A2S only reads it (there is no management API yet). */
@Injectable()
export class ServiceAreaRepository {
  /**
   * Locks the area row FOR SHARE and returns its CURRENT state (read after the lock, so an UPDATE that
   * committed while this call waited is seen). FOR SHARE conflicts with an UPDATE of the row, so an operator
   * cannot deactivate the area between this check and the commit of the caller's transaction, while any
   * number of shops can hold the same area locked at once (they do not serialize on a popular area).
   * Returns undefined when no such area exists. Whether the status is acceptable is the caller's rule.
   */
  async lockShared(context: TransactionContext, serviceAreaId: string): Promise<ServiceAreaRow | undefined> {
    const result = await context.query<{ service_area_id: string; status: ServiceAreaStatus }>(
      `SELECT service_area_id, status
         FROM app.service_areas
        WHERE service_area_id = $1::uuid
          FOR SHARE`,
      [serviceAreaId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { serviceAreaId: row.service_area_id, status: row.status };
  }

  /**
   * The ACTIVE areas a shop can pick during onboarding, by name and then by identifier so that the order is the same on
   * every call. A plain read: no lock (a later deactivation is caught by the FOR SHARE re-check of save and complete),
   * no write, and no row of any other table.
   */
  async listActive(context: TransactionContext): Promise<ActiveServiceAreaRow[]> {
    const result = await context.query<{ service_area_id: string; name: string }>(
      `SELECT service_area_id, name
         FROM app.service_areas
        WHERE status = 'ACTIVE'
        ORDER BY name ASC, service_area_id ASC`,
    );
    return result.rows.map((row) => ({ serviceAreaId: row.service_area_id, name: row.name }));
  }
}
