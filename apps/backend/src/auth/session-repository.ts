import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountOrigin, isAccountOrigin } from './account-origin';
import { CLOCK_CTE, epochMs, toSafeInteger } from './auth-db';
import { DeviceInfo } from './auth-validation';
import { generateToken } from './tokens';

export interface CreatedSession {
  readonly sessionId: string;
  /** Plaintext access token: returned to the client once, never stored. */
  readonly accessToken: string;
  /** The absolute expiry the database wrote, as epoch milliseconds (the client API reports it as ISO UTC). */
  readonly expiresAtMs: number;
}

export interface SessionView {
  readonly sessionId: string;
  readonly userId: string;
  readonly activeRole: string | null;
  readonly revoked: boolean;
  readonly expired: boolean;
  readonly userStatus: string;
  readonly phoneNormalized: string;
  /** The owner's account origin, read in the same statement; the bearer policy decides on it. */
  readonly accountOrigin: AccountOrigin;
}

/**
 * A session row read under a row lock (FOR UPDATE or FOR SHARE). It carries the CURRENT active role, read from the
 * locked row, so neither /auth/me nor a Shop command ever acts on the role the guard saw before the transaction
 * began.
 */
export interface LockedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly activeRole: string | null;
  readonly revoked: boolean;
  readonly expiresAtMs: number;
}

/**
 * The immutable birth facts of a session plus the role stored on it, for the client API (M01.04). app, platform and the
 * expiry never change after creation, and the caller holds the session lock, so a plain read is coherent.
 */
export interface ClientSessionView {
  readonly app: string;
  readonly platform: string;
  readonly activeRole: string | null;
  readonly expiresAtMs: number;
}

/** The shared-lock variant returns the same shape; the alias keeps the name the readers already use. */
export type SharedLockedSession = LockedSession;

/** SQL for sessions. The plaintext token exists only inside create(); the table gets the SHA-256 digest. */
@Injectable()
export class SessionRepository {
  /**
   * Creates a session with an absolute expiry. It is roleless (active_role NULL) unless the caller names an `activeRole`
   * on purpose: only the client registration does (M01.03, CUSTOMER), so the default of every legacy caller is unchanged.
   */
  async create(
    context: TransactionContext,
    input: { userId: string; device: DeviceInfo; ttlSeconds: number; activeRole?: string },
  ): Promise<CreatedSession> {
    const sessionId = randomUUID();
    const { token, digest } = generateToken();
    const result = await context.query<{ expires_ms: string }>(
      `INSERT INTO app.sessions (
         session_id, user_id, token_digest, device_id, platform, app, active_role,
         expires_at, revoked_at, created_at, updated_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $8::varchar,
              clock.t + make_interval(secs => $7::double precision), NULL, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       RETURNING ${epochMs('expires_at')} AS expires_ms`,
      [
        sessionId,
        input.userId,
        digest,
        input.device.deviceId,
        input.device.platform,
        input.device.app,
        input.ttlSeconds,
        input.activeRole ?? null,
      ],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Session was not written');
    }
    return { sessionId, accessToken: token, expiresAtMs: toSafeInteger(row.expires_ms) };
  }

  /** Authentication read: the session joined with its user, with revoked/expired decided by the database. */
  async findByDigest(context: TransactionContext, tokenDigest: string): Promise<SessionView | undefined> {
    const result = await context.query<{
      session_id: string;
      user_id: string;
      active_role: string | null;
      revoked: boolean;
      expired: boolean;
      status: string;
      phone_normalized: string;
      account_origin: string;
    }>(
      `SELECT s.session_id, s.user_id, s.active_role,
              s.revoked_at IS NOT NULL AS revoked,
              s.expires_at <= clock_timestamp() AS expired,
              u.status, u.phone_normalized, u.account_origin
         FROM app.sessions s
         JOIN app.users u ON u.user_id = s.user_id
        WHERE s.token_digest = $1`,
      [tokenDigest],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (!isAccountOrigin(row.account_origin)) {
      throw new TechnicalError('internal', 'Database returned an unexpected account origin');
    }
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      activeRole: row.active_role,
      revoked: row.revoked,
      expired: row.expired,
      userStatus: row.status,
      phoneNormalized: row.phone_normalized,
      accountOrigin: row.account_origin,
    };
  }

  /**
   * Locks the session row FOR UPDATE and returns its CURRENT state, including the active role stored on the locked
   * row. The caller reads the database clock AFTER this call.
   */
  async lockById(context: TransactionContext, sessionId: string): Promise<LockedSession | undefined> {
    const result = await context.query<{
      session_id: string;
      user_id: string;
      active_role: string | null;
      revoked: boolean;
      expires_ms: string;
    }>(
      `SELECT session_id, user_id, active_role, revoked_at IS NOT NULL AS revoked,
              ${epochMs('expires_at')} AS expires_ms
         FROM app.sessions WHERE session_id = $1::uuid FOR UPDATE`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      activeRole: row.active_role,
      revoked: row.revoked,
      expiresAtMs: toSafeInteger(row.expires_ms),
    };
  }

  /**
   * A shared row lock on the session, for a reader that must see one coherent state together with the user row
   * it already holds FOR SHARE (/auth/me). It waits for a writer holding the session FOR UPDATE (role selection,
   * revocation) and lets other FOR SHARE readers through. The caller reads the database clock AFTER this call.
   */
  async lockByIdForShare(context: TransactionContext, sessionId: string): Promise<SharedLockedSession | undefined> {
    const result = await context.query<{
      session_id: string;
      user_id: string;
      active_role: string | null;
      revoked: boolean;
      expires_ms: string;
    }>(
      `SELECT session_id, user_id, active_role, revoked_at IS NOT NULL AS revoked,
              ${epochMs('expires_at')} AS expires_ms
         FROM app.sessions WHERE session_id = $1::uuid FOR SHARE`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      activeRole: row.active_role,
      revoked: row.revoked,
      expiresAtMs: toSafeInteger(row.expires_ms),
    };
  }

  /** Revokes every OTHER unrevoked SHOP-context session of the user and returns their ids. */
  async revokeOtherShopSessions(
    context: TransactionContext,
    userId: string,
    currentSessionId: string,
  ): Promise<string[]> {
    const result = await context.query<{ session_id: string }>(
      `UPDATE app.sessions
          SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = $1::uuid
          AND session_id <> $2::uuid
          AND active_role = 'SHOP'
          AND revoked_at IS NULL
        RETURNING session_id`,
      [userId, currentSessionId],
    );
    return result.rows.map((row) => row.session_id).sort();
  }

  /** See ClientSessionView. Undefined when the session does not exist. */
  async readClientView(context: TransactionContext, sessionId: string): Promise<ClientSessionView | undefined> {
    const result = await context.query<{
      app: string;
      platform: string;
      active_role: string | null;
      expires_ms: string;
    }>(
      `SELECT app, platform, active_role, ${epochMs('expires_at')} AS expires_ms
         FROM app.sessions WHERE session_id = $1::uuid`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      app: row.app,
      platform: row.platform,
      activeRole: row.active_role,
      expiresAtMs: toSafeInteger(row.expires_ms),
    };
  }

  /**
   * Revokes ONE session by id (client logout, M01.04). The caller holds the user and session locks. True when THIS call
   * changed it from active to revoked; false when it was already revoked (so a retry changes and audits nothing).
   */
  async revokeById(context: TransactionContext, sessionId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.sessions
          SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE session_id = $1::uuid AND revoked_at IS NULL`,
      [sessionId],
    );
    return result.rowCount === 1;
  }

  async setActiveRole(context: TransactionContext, sessionId: string, role: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.sessions
          SET active_role = $2, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE session_id = $1::uuid AND revoked_at IS NULL`,
      [sessionId, role],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Session role was not set');
    }
  }
}
