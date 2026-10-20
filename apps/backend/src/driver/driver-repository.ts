import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK_CTE, toSafeInteger } from './driver-db';
import { DriverReviewState, DriverStatus, DriverType } from './driver-types';

export interface DriverRow {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly plateNumber: string | null;
  readonly driverType: DriverType;
  readonly status: DriverStatus;
  readonly acceptingDeliveries: boolean;
  readonly version: number;
  /** M03 */
  readonly shipperCode: string;
  readonly reviewState: DriverReviewState;
  readonly initialFundingRequired?: boolean;
  readonly submittedAtMs: number | null;
  readonly reviewedAtMs: number | null;
  readonly reviewedBy: string | null;
  readonly rejectionReason: string | null;
  readonly suspensionReason: string | null;
  readonly suspendedAtMs: number | null;
  readonly statusBeforeClosing: 'ACTIVE' | 'SUSPENDED' | null;
  readonly closureRequestedAtMs: number | null;
  readonly closureNote: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** The fields self-onboarding writes, already validated and normalized by the caller. */
export interface NewDriverFields {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly plateNumber: string | null;
}

export interface RawDriver {
  driver_id: string;
  user_id: string;
  full_name: string;
  plate_number: string | null;
  driver_type: DriverType;
  status: DriverStatus;
  accepting_deliveries: boolean;
  version: string;
  shipper_code: string;
  review_state: DriverReviewState;
  initial_funding_required: boolean;
  submitted_ms: string | null;
  reviewed_ms: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  suspension_reason: string | null;
  suspended_ms: string | null;
  status_before_closing: 'ACTIVE' | 'SUSPENDED' | null;
  closure_requested_ms: string | null;
  closure_note: string | null;
  created_ms: string;
  updated_ms: string;
}

const ms = (column: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text`;

/** Every column of a driver row as the repository reads it (the table alias is `d` where a query joins). */
export const DRIVER_COLUMNS = `d.driver_id, d.user_id, d.full_name, d.plate_number, d.driver_type, d.status, d.accepting_deliveries, d.version,
  d.shipper_code, d.review_state, d.initial_funding_required, ${ms('d.submitted_at')} AS submitted_ms, ${ms('d.reviewed_at')} AS reviewed_ms, d.reviewed_by::text AS reviewed_by,
  d.rejection_reason, d.suspension_reason, ${ms('d.suspended_at')} AS suspended_ms, d.status_before_closing,
  ${ms('d.closure_requested_at')} AS closure_requested_ms, d.closure_note, ${ms('d.created_at')} AS created_ms, ${ms('d.updated_at')} AS updated_ms`;

const optionalMs = (raw: string | null): number | null => (raw === null ? null : toSafeInteger(raw));

export function toDriver(row: RawDriver): DriverRow {
  return {
    driverId: row.driver_id,
    userId: row.user_id,
    fullName: row.full_name,
    plateNumber: row.plate_number,
    driverType: row.driver_type,
    status: row.status,
    acceptingDeliveries: row.accepting_deliveries,
    version: toSafeInteger(row.version),
    shipperCode: row.shipper_code,
    reviewState: row.review_state,
    initialFundingRequired: row.initial_funding_required,
    submittedAtMs: optionalMs(row.submitted_ms),
    reviewedAtMs: optionalMs(row.reviewed_ms),
    reviewedBy: row.reviewed_by,
    rejectionReason: row.rejection_reason,
    suspensionReason: row.suspension_reason,
    suspendedAtMs: optionalMs(row.suspended_ms),
    statusBeforeClosing: row.status_before_closing,
    closureRequestedAtMs: optionalMs(row.closure_requested_ms),
    closureNote: row.closure_note,
    createdAtMs: toSafeInteger(row.created_ms),
    updatedAtMs: toSafeInteger(row.updated_ms),
  };
}

/** Marker for "the database clock of this statement" in a DriverPatch. */
export const NOW = Symbol('now');
type PatchValue = string | boolean | null | typeof NOW;

/**
 * The columns a lifecycle transition may change. A closed whitelist: the SQL is built from these keys only, never from a client
 * value. `version` and `updated_at` are always advanced by the statement itself.
 */
export interface DriverPatch {
  readonly fullName?: string;
  readonly plateNumber?: string | null;
  readonly driverType?: DriverType;
  readonly status?: DriverStatus;
  readonly reviewState?: DriverReviewState;
  readonly acceptingDeliveries?: boolean;
  readonly submittedAt?: typeof NOW | null;
  readonly reviewedAt?: typeof NOW | null;
  readonly reviewedBy?: string | null;
  readonly rejectionReason?: string | null;
  readonly suspensionReason?: string | null;
  readonly suspendedAt?: typeof NOW | null;
  readonly statusBeforeClosing?: 'ACTIVE' | 'SUSPENDED' | null;
  readonly closureRequestedAt?: typeof NOW | null;
  readonly closureNote?: string | null;
}

const PATCH_COLUMNS: Readonly<Record<keyof DriverPatch, { column: string; cast?: string }>> = {
  fullName: { column: 'full_name' },
  plateNumber: { column: 'plate_number' },
  driverType: { column: 'driver_type' },
  status: { column: 'status' },
  reviewState: { column: 'review_state' },
  acceptingDeliveries: { column: 'accepting_deliveries' },
  submittedAt: { column: 'submitted_at' },
  reviewedAt: { column: 'reviewed_at' },
  reviewedBy: { column: 'reviewed_by', cast: '::uuid' },
  rejectionReason: { column: 'rejection_reason' },
  suspensionReason: { column: 'suspension_reason' },
  suspendedAt: { column: 'suspended_at' },
  statusBeforeClosing: { column: 'status_before_closing' },
  closureRequestedAt: { column: 'closure_requested_at' },
  closureNote: { column: 'closure_note' },
};

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
      `SELECT ${DRIVER_COLUMNS}
         FROM app.drivers d
        WHERE d.user_id = $1::uuid
          FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDriver(row);
  }

  /**
   * The user's own Driver row exactly as stored, or undefined (M01.05 GET /driver/me). A plain read that takes no lock: the
   * caller holds the user row lock (every writer of a driver takes it first, as the eligibility port relies on) and never
   * changes anything here. Status and type are returned as stored, never translated.
   */
  async findByUserId(context: TransactionContext, userId: string): Promise<DriverRow | undefined> {
    const result = await context.query<RawDriver>(
      `SELECT ${DRIVER_COLUMNS}
         FROM app.drivers d
        WHERE d.user_id = $1::uuid`,
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
       SELECT $1::uuid, $2::uuid, $3, $4, 'EXTERNAL', 'ACTIVE', false, 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (user_id) DO NOTHING`,
      [driver.driverId, driver.userId, driver.fullName, driver.plateNumber],
    );
    return result.rowCount === 1;
  }

  /** A plain read by id (the administration detail). */
  /** Of the given Shippers, those that are ACTIVE and have deliveries switched on, with their account. A cheap prefilter for "who may be told about a new delivery". */
  async listAcceptingAmong(context: TransactionContext, driverIds: readonly string[]): Promise<{ driverId: string; userId: string }[]> {
    if (driverIds.length === 0) {
      return [];
    }
    const result = await context.query<{ driver_id: string; user_id: string }>(
      `SELECT driver_id, user_id FROM app.drivers WHERE driver_id = ANY($1::uuid[]) AND status = 'ACTIVE' AND accepting_deliveries`,
      [driverIds],
    );
    return result.rows.map((r) => ({ driverId: r.driver_id, userId: r.user_id }));
  }

  async findById(context: TransactionContext, driverId: string): Promise<DriverRow | undefined> {
    const result = await context.query<RawDriver>(`SELECT ${DRIVER_COLUMNS} FROM app.drivers d WHERE d.driver_id = $1::uuid`, [driverId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toDriver(row);
  }

  /** Locks a driver row by id (the administration commands; the target comes from the path). */
  async lockById(context: TransactionContext, driverId: string): Promise<DriverRow | undefined> {
    const result = await context.query<RawDriver>(
      `SELECT ${DRIVER_COLUMNS}
         FROM app.drivers d
        WHERE d.driver_id = $1::uuid
          FOR UPDATE`,
      [driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDriver(row);
  }

  /**
   * Applies a patch to a row the caller holds locked and read in this transaction. The version is checked in the statement
   * (optimistic) and advanced by it; the database clock stamps updated_at and every NOW column with one value. Returns the row as
   * stored, or undefined when no row had that id and version (the caller maps it to VERSION_CONFLICT).
   */
  async update(context: TransactionContext, driverId: string, expectedVersion: number, patch: DriverPatch): Promise<DriverRow | undefined> {
    const params: unknown[] = [driverId, expectedVersion];
    const sets: string[] = [];
    for (const key of Object.keys(patch) as (keyof DriverPatch)[]) {
      const spec = PATCH_COLUMNS[key];
      const value = patch[key] as PatchValue | undefined;
      if (spec === undefined || value === undefined) {
        continue;
      }
      if (value === NOW) {
        sets.push(`${spec.column} = clock.t`);
      } else {
        params.push(value);
        sets.push(`${spec.column} = $${params.length}${spec.cast ?? ''}`);
      }
    }
    sets.push('version = d.version + 1', 'updated_at = clock.t');
    const result = await context.query<RawDriver>(
      `UPDATE app.drivers AS d
          SET ${sets.join(', ')}
         FROM (${CLOCK_CTE}) AS clock
        WHERE d.driver_id = $1::uuid AND d.version = $2::bigint
    RETURNING ${DRIVER_COLUMNS}`,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDriver(row);
  }
}
