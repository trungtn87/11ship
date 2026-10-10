import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';

export interface AdminSessionRow {
  readonly sessionId: string;
  readonly userId: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly passwordBinding: string;
  readonly passwordKeyId: string;
  readonly membershipVersion: number;
  readonly factorId: string;
  readonly factorVersion: number;
  readonly revoked: boolean;
  /**
   * Epoch milliseconds from the database. A row read UNDER A LOCK deliberately carries no "expired" flag: whether it is
   * expired is decided by comparing this value with a database clock read AFTER the last lock was granted
   * (isExpiredAt + freshClockMs), because a flag computed inside the locking statement can predate the lock wait.
   */
  readonly expiresAtMs: number;
}

/** The unlocked lookup by cookie digest: its flag is an early filter only, never the decision to accept a credential. */
export interface SessionLookup extends AdminSessionRow {
  /** True when the database clock had passed expires_at when this lookup statement ran (no lock, no wait). */
  readonly expiredAtLookup: boolean;
}

interface RawSession {
  session_id: string;
  user_id: string;
  csrf_nonce: Buffer;
  csrf_key_id: string;
  password_binding: string;
  password_key_id: string;
  membership_version: string;
  factor_id: string;
  factor_version: string;
  revoked: boolean;
  expires_ms: string;
}

interface RawSessionLookup extends RawSession {
  expired_at_lookup: boolean;
}

const COLUMNS = `session_id, user_id, csrf_nonce, csrf_key_id, password_binding, password_key_id,
       membership_version, factor_id, factor_version,
       revoked_at IS NOT NULL AS revoked, ${epochMs('expires_at')} AS expires_ms`;

/** Locking reads: no clock expression in a statement that can wait for a lock. */
const SELECT = `SELECT ${COLUMNS}
  FROM app.admin_sessions`;

/** The plain lookup never waits for a lock, so its clock reading is current when it is taken. */
const LOOKUP = `SELECT ${COLUMNS}, expires_at <= clock_timestamp() AS expired_at_lookup
  FROM app.admin_sessions`;

function toSession(row: RawSession): AdminSessionRow {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    csrfNonce: row.csrf_nonce,
    csrfKeyId: row.csrf_key_id,
    passwordBinding: row.password_binding,
    passwordKeyId: row.password_key_id,
    membershipVersion: toSafeInteger(row.membership_version),
    factorId: row.factor_id,
    factorVersion: toSafeInteger(row.factor_version),
    revoked: row.revoked,
    expiresAtMs: toSafeInteger(row.expires_ms),
  };
}

function toLookup(row: RawSessionLookup): SessionLookup {
  return { ...toSession(row), expiredAtLookup: row.expired_at_lookup };
}

export interface NewAdminSession {
  readonly userId: string;
  readonly tokenDigest: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly passwordBinding: string;
  readonly passwordKeyId: string;
  readonly membershipVersion: number;
  readonly factorId: string;
  readonly factorVersion: number;
  readonly deviceId: string;
  readonly ttlSeconds: number;
}

/** SQL for app.admin_sessions. The plaintext cookie value never reaches this class, only its digest. */
@Injectable()
export class AdminSessionRepository {
  async findByDigest(context: TransactionContext, tokenDigest: string): Promise<SessionLookup | undefined> {
    const result = await context.query<RawSessionLookup>(`${LOOKUP} WHERE token_digest = $1`, [tokenDigest]);
    const row = result.rows[0];
    return row === undefined ? undefined : toLookup(row);
  }

  async lock(context: TransactionContext, sessionId: string): Promise<AdminSessionRow | undefined> {
    const result = await context.query<RawSession>(`${SELECT} WHERE session_id = $1::uuid FOR UPDATE`, [sessionId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSession(row);
  }

  async lockShared(context: TransactionContext, sessionId: string): Promise<AdminSessionRow | undefined> {
    const result = await context.query<RawSession>(`${SELECT} WHERE session_id = $1::uuid FOR SHARE`, [sessionId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSession(row);
  }

  /** Revokes every session of the user that is not revoked yet (expired but unrevoked ones included). */
  async revokeAllForUser(context: TransactionContext, userId: string): Promise<void> {
    await context.query(
      `UPDATE app.admin_sessions
          SET revoked_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [userId],
    );
  }

  async insert(
    context: TransactionContext,
    input: NewAdminSession,
  ): Promise<{ sessionId: string; expiresAtMs: number }> {
    const sessionId = randomUUID();
    const result = await context.query<{ expires_ms: string }>(
      `INSERT INTO app.admin_sessions (
         session_id, user_id, token_digest, csrf_nonce, csrf_key_id, password_binding, password_key_id,
         membership_version, factor_id, factor_version, device_id, mfa_completed_at, expires_at, revoked_at, created_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::bigint, $9::uuid, $10::bigint, $11, clock.t,
              clock.t + make_interval(secs => $12::double precision), NULL, clock.t
         FROM (${CLOCK_CTE}) AS clock
       RETURNING ${epochMs('expires_at')} AS expires_ms`,
      [
        sessionId,
        input.userId,
        input.tokenDigest,
        input.csrfNonce,
        input.csrfKeyId,
        input.passwordBinding,
        input.passwordKeyId,
        input.membershipVersion,
        input.factorId,
        input.factorVersion,
        input.deviceId,
        input.ttlSeconds,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Session was not written');
    }
    return { sessionId, expiresAtMs: toSafeInteger(row.expires_ms) };
  }

  /** True when this call revoked the session. */
  async revoke(context: TransactionContext, sessionId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_sessions
          SET revoked_at = date_trunc('milliseconds', clock_timestamp())
        WHERE session_id = $1::uuid AND revoked_at IS NULL`,
      [sessionId],
    );
    return result.rowCount === 1;
  }
}
