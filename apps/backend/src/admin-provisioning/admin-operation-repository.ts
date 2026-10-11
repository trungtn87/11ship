import { Injectable } from '@nestjs/common';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { OPERATION_ATTEMPT_LIMIT, OPERATION_TTL_SECONDS, OperationAction } from './admin-provisioning-constants';

export type OperationStatus = 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'INVALIDATED';
export type InvalidatedReason = 'REPLACED' | 'ATTEMPTS_EXHAUSTED';

export interface OperationRow {
  readonly operationId: string;
  readonly actorUserId: string;
  readonly actorSessionId: string;
  readonly factorId: string;
  readonly factorVersion: number;
  readonly membershipVersion: number;
  readonly action: OperationAction;
  readonly targetId: string | null;
  readonly expectedVersion: number | null;
  readonly payloadFingerprint: string;
  readonly fingerprintKeyId: string;
  readonly status: OperationStatus;
  readonly attemptCount: number;
  /**
   * Epoch milliseconds from the database. A row read UNDER A LOCK carries no "expired" flag on purpose: expiry is
   * decided by comparing this value with a database clock read AFTER the last lock (contract section 8.5).
   */
  readonly expiresAtMs: number;
  readonly verifiedAtMs: number | null;
  readonly consumedAtMs: number | null;
  readonly invalidatedReason: InvalidatedReason | null;
}

export interface NewOperation {
  readonly operationId: string;
  readonly actorUserId: string;
  readonly actorSessionId: string;
  readonly factorId: string;
  readonly factorVersion: number;
  readonly membershipVersion: number;
  readonly action: OperationAction;
  readonly targetId: string | null;
  readonly expectedVersion: number | null;
  readonly payloadFingerprint: string;
  readonly fingerprintKeyId: string;
}

interface RawOperation {
  operation_id: string;
  actor_user_id: string;
  actor_session_id: string;
  factor_id: string;
  factor_version: string;
  membership_version: string;
  action: OperationAction;
  target_id: string | null;
  expected_version: string | null;
  payload_fingerprint: string;
  fingerprint_key_id: string;
  status: OperationStatus;
  attempt_count: number;
  expires_ms: string;
  verified_ms: string | null;
  consumed_ms: string | null;
  invalidated_reason: InvalidatedReason | null;
}

const COLUMNS = `operation_id, actor_user_id, actor_session_id, factor_id, factor_version, membership_version, action,
       target_id, expected_version, payload_fingerprint, fingerprint_key_id, status, attempt_count,
       ${epochMs('expires_at')} AS expires_ms,
       CASE WHEN verified_at IS NULL THEN NULL ELSE ${epochMs('verified_at')} END AS verified_ms,
       CASE WHEN consumed_at IS NULL THEN NULL ELSE ${epochMs('consumed_at')} END AS consumed_ms,
       invalidated_reason`;

function toOperation(row: RawOperation): OperationRow {
  return {
    operationId: row.operation_id,
    actorUserId: row.actor_user_id,
    actorSessionId: row.actor_session_id,
    factorId: row.factor_id,
    factorVersion: toSafeInteger(row.factor_version),
    membershipVersion: toSafeInteger(row.membership_version),
    action: row.action,
    targetId: row.target_id,
    expectedVersion: row.expected_version === null ? null : toSafeInteger(row.expected_version),
    payloadFingerprint: row.payload_fingerprint,
    fingerprintKeyId: row.fingerprint_key_id,
    status: row.status,
    attemptCount: row.attempt_count,
    expiresAtMs: toSafeInteger(row.expires_ms),
    verifiedAtMs: row.verified_ms === null ? null : toSafeInteger(row.verified_ms),
    consumedAtMs: row.consumed_ms === null ? null : toSafeInteger(row.consumed_ms),
    invalidatedReason: row.invalidated_reason,
  };
}

/**
 * SQL for app.admin_sensitive_operations (M01-D-ADMIN-1B). Every method receives the coordinator's TransactionContext.
 * Lock rank L9 of the contract: these rows are only ever locked AFTER the actor rows (L4-L7) and the target invitation
 * (L8), so the foreign keys of an INSERT only meet rows the same transaction already holds. Every state change is a
 * compare-and-set whose timestamps come from ONE database clock read inside the statement; a change that would happen
 * at or after expires_at matches no row instead of tripping a CHECK.
 */
@Injectable()
export class AdminOperationRepository {
  /** Plain read without a lock: only to learn the IMMUTABLE target of an operation before the locks are taken. */
  async peekTarget(context: TransactionContext, operationId: string): Promise<{ targetId: string | null } | undefined> {
    const result = await context.query<{ target_id: string | null }>(
      'SELECT target_id FROM app.admin_sensitive_operations WHERE operation_id = $1::uuid',
      [operationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { targetId: row.target_id };
  }

  async lock(context: TransactionContext, operationId: string, actorUserId: string): Promise<OperationRow | undefined> {
    const result = await context.query<RawOperation>(
      `SELECT ${COLUMNS} FROM app.admin_sensitive_operations
        WHERE operation_id = $1::uuid AND actor_user_id = $2::uuid FOR UPDATE`,
      [operationId, actorUserId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toOperation(row);
  }

  async lockShared(context: TransactionContext, operationId: string, actorUserId: string): Promise<OperationRow | undefined> {
    const result = await context.query<RawOperation>(
      `SELECT ${COLUMNS} FROM app.admin_sensitive_operations
        WHERE operation_id = $1::uuid AND actor_user_id = $2::uuid FOR SHARE`,
      [operationId, actorUserId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toOperation(row);
  }

  /** The live (PENDING|VERIFIED) operations of an actor, locked. At most one exists; the caller holds the user lock. */
  async lockLive(context: TransactionContext, actorUserId: string): Promise<OperationRow[]> {
    const result = await context.query<RawOperation>(
      `SELECT ${COLUMNS} FROM app.admin_sensitive_operations
        WHERE actor_user_id = $1::uuid AND status IN ('PENDING','VERIFIED')
        ORDER BY operation_id FOR UPDATE`,
      [actorUserId],
    );
    return result.rows.map(toOperation);
  }

  /** PENDING|VERIFIED -> INVALIDATED(REPLACED). Returns true when this call changed the row. */
  async replace(context: TransactionContext, operationId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_sensitive_operations o
          SET status = 'INVALIDATED', invalidated_at = clock.t, invalidated_reason = 'REPLACED'
         FROM (${CLOCK_CTE}) AS clock
        WHERE o.operation_id = $1::uuid AND o.status IN ('PENDING','VERIFIED')`,
      [operationId],
    );
    return result.rowCount === 1;
  }

  /** A new PENDING operation: created_at is the database clock, expires_at exactly 120 seconds later. */
  async insert(context: TransactionContext, row: NewOperation): Promise<{ expiresAtMs: number }> {
    const result = await context.query<{ expires_ms: string }>(
      `INSERT INTO app.admin_sensitive_operations (
         operation_id, actor_user_id, actor_session_id, factor_id, factor_version, membership_version, action,
         target_id, expected_version, payload_fingerprint, fingerprint_key_id, status, attempt_count,
         created_at, expires_at
       )
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::bigint, $7,
              $8::uuid, $9::bigint, $10, $11, 'PENDING', 0,
              clock.t, clock.t + ($12::integer * interval '1 second')
         FROM (${CLOCK_CTE}) AS clock
       RETURNING ${epochMs('expires_at')} AS expires_ms`,
      [
        row.operationId,
        row.actorUserId,
        row.actorSessionId,
        row.factorId,
        row.factorVersion,
        row.membershipVersion,
        row.action,
        row.targetId,
        row.expectedVersion,
        row.payloadFingerprint,
        row.fingerprintKeyId,
        OPERATION_TTL_SECONDS,
      ],
    );
    const inserted = result.rows[0];
    if (inserted === undefined) {
      throw new TechnicalError('internal', 'Operation was not written');
    }
    return { expiresAtMs: toSafeInteger(inserted.expires_ms) };
  }

  /**
   * One wrong TOTP code, compared and refused: attempt_count + 1, and the fifth one INVALIDATES the row in the SAME
   * statement (the trigger accepts nothing else). Returns the new count and whether it was the last one.
   */
  async recordWrongAttempt(
    context: TransactionContext,
    operationId: string,
  ): Promise<{ attemptCount: number; exhausted: boolean }> {
    const result = await context.query<{ attempt_count: number; status: OperationStatus }>(
      `UPDATE app.admin_sensitive_operations o
          SET attempt_count = o.attempt_count + 1,
              status = CASE WHEN o.attempt_count + 1 >= $2::int THEN 'INVALIDATED' ELSE o.status END,
              invalidated_at = CASE WHEN o.attempt_count + 1 >= $2::int THEN clock.t ELSE NULL END,
              invalidated_reason = CASE WHEN o.attempt_count + 1 >= $2::int THEN 'ATTEMPTS_EXHAUSTED' ELSE NULL END
         FROM (${CLOCK_CTE}) AS clock
        WHERE o.operation_id = $1::uuid AND o.status = 'PENDING'
        RETURNING o.attempt_count, o.status`,
      [operationId, OPERATION_ATTEMPT_LIMIT],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Operation attempt was not recorded');
    }
    return { attemptCount: row.attempt_count, exhausted: row.status === 'INVALIDATED' };
  }

  /** PENDING -> VERIFIED, only strictly before expires_at by the statement's own clock. */
  async markVerified(context: TransactionContext, operationId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_sensitive_operations o
          SET status = 'VERIFIED', verified_at = clock.t
         FROM (${CLOCK_CTE}) AS clock
        WHERE o.operation_id = $1::uuid AND o.status = 'PENDING' AND clock.t < o.expires_at`,
      [operationId],
    );
    return result.rowCount === 1;
  }

  /** VERIFIED -> CONSUMED in the transaction of the mutation, only strictly before expires_at. */
  async consume(context: TransactionContext, operationId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_sensitive_operations o
          SET status = 'CONSUMED', consumed_at = clock.t
         FROM (${CLOCK_CTE}) AS clock
        WHERE o.operation_id = $1::uuid AND o.status = 'VERIFIED' AND clock.t < o.expires_at`,
      [operationId],
    );
    return result.rowCount === 1;
  }
}
