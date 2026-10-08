import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK_CTE, toSafeInteger } from './driver-db';
import { DriverStatus, DriverType } from './driver-types';

export interface DriverRow {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly plateNumber: string | null;
  readonly driverType: DriverType;
  readonly status: DriverStatus;
  readonly acceptingDeliveries: boolean;
  readonly version: number;
}

/** The fields self-onboarding writes, already validated and normalized by the caller. */
export interface NewDriverFields {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly plateNumber: string | null;
}

interface RawDriver {
  driver_id: string;
  user_id: string;
  full_name: string;
  plate_number: string | null;
  driver_type: DriverType;
  status: DriverStatus;
  accepting_deliveries: boolean;
  version: string;
}

function toDriver(row: RawDriver): DriverRow {
  return {
    driverId: row.driver_id,
    userId: row.user_id,
    fullName: row.full_name,
    plateNumber: row.plate_number,
    driverType: row.driver_type,
    status: row.status,
    acceptingDeliveries: row.accepting_deliveries,
    version: toSafeInteger(row.version),
  };
}

/**
 * SQL for app.drivers. M03 owns the table; no other module issues SQL against it. Every method takes the caller's TransactionContext: none of them begins, commits or rolls back anything.
 */
@Injectable()
export class DriverRepository {
  /**
   * Locks the user's Driver row (if any) and returns it as it is AFTER the lock. This is the "existing owner
   * aggregate" step of the A2 lock order, taken after the caller's user-row lock. Returns undefined when the
   * user has no Driver; in that case nothing was locked, and the caller's user-row lock is what serializes
   * concurrent creators.
   */
  async lockByUserId(context: TransactionContext, userId: string): Promise<DriverRow | undefined> {
    const result = await context.query<RawDriver>(
      `SELECT driver_id, user_id, full_name, plate_number, driver_type, status, accepting_deliveries, version
         FROM app.drivers
        WHERE user_id = $1::uuid
          FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDriver(row);
  }

  /**
   * Inserts the one shape self-onboarding may create: EXTERNAL, PENDING, not accepting deliveries, version 1.
   * The four fixed values are literals in the statement, not parameters: nothing a caller passes can change
   * them. Returns false when the user already has a Driver (the UNIQUE(user_id) rule decided, which only a
   * caller that skipped the user lock could reach): ON CONFLICT DO NOTHING lets the database decide and never
   * raises a raw unique violation, so the caller maps `false` to DRIVER_PROFILE_EXISTS.
   */
  async insertPending(context: TransactionContext, driver: NewDriverFields): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.drivers (
         driver_id, user_id, full_name, plate_number, driver_type, status, accepting_deliveries, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, 'EXTERNAL', 'PENDING', false, 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (user_id) DO NOTHING`,
      [driver.driverId, driver.userId, driver.fullName, driver.plateNumber],
    );
    return result.rowCount === 1;
  }
}
