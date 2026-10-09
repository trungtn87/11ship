import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';
import { CHALLENGE_ATTEMPT_LIMIT } from './admin-auth-constants';

export interface ChallengeRow {
  readonly challengeId: string;
  readonly userId: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly passwordBinding: string;
  readonly passwordKeyId: string;
  readonly membershipVersion: number;
  readonly factorId: string | null;
  readonly factorVersion: number | null;
  readonly deviceId: string;
  readonly attemptCount: number;
  readonly consumed: boolean;
  /** Decided by the database clock at read time. */
  readonly expired: boolean;
  readonly expiresAtMs: number;
}

interface RawChallenge {
  challenge_id: string;
  user_id: string;
  csrf_nonce: Buffer;
  csrf_key_id: string;
  password_binding: string;
  password_key_id: string;
  membership_version: string;
  factor_id: string | null;
  factor_version: string | null;
  device_id: string;
  attempt_count: number;
  consumed: boolean;
  expired: boolean;
  expires_ms: string;
}

const SELECT = `SELECT challenge_id, user_id, csrf_nonce, csrf_key_id, password_binding, password_key_id,
       membership_version, factor_id, factor_version, device_id, attempt_count,
       consumed_at IS NOT NULL AS consumed, expires_at <= clock_timestamp() AS expired,
       ${epochMs('expires_at')} AS expires_ms
  FROM app.admin_auth_challenges`;

function toChallenge(row: RawChallenge): ChallengeRow {
  return {
    challengeId: row.challenge_id,
    userId: row.user_id,
    csrfNonce: row.csrf_nonce,
    csrfKeyId: row.csrf_key_id,
    passwordBinding: row.password_binding,
    passwordKeyId: row.password_key_id,
    membershipVersion: toSafeInteger(row.membership_version),
    factorId: row.factor_id,
    factorVersion: row.factor_version === null ? null : toSafeInteger(row.factor_version),
    deviceId: row.device_id,
    attemptCount: row.attempt_count,
    consumed: row.consumed,
    expired: row.expired,
    expiresAtMs: toSafeInteger(row.expires_ms),
  };
}

export interface NewChallenge {
  readonly userId: string;
  readonly tokenDigest: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly passwordBinding: string;
  readonly passwordKeyId: string;
  readonly membershipVersion: number;
  readonly factorId: string | null;
  readonly factorVersion: number | null;
  readonly deviceId: string;
  readonly ttlSeconds: number;
}

/** SQL for app.admin_auth_challenges (the preauth step). Plaintext tokens never reach this class, only digests. */
@Injectable()
export class AdminChallengeRepository {
  async findByDigest(context: TransactionContext, tokenDigest: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<RawChallenge>(`${SELECT} WHERE token_digest = $1`, [tokenDigest]);
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  async lock(context: TransactionContext, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<RawChallenge>(`${SELECT} WHERE challenge_id = $1::uuid FOR UPDATE`, [
      challengeId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  async lockShared(context: TransactionContext, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<RawChallenge>(`${SELECT} WHERE challenge_id = $1::uuid FOR SHARE`, [
      challengeId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  /** Consumes every unconsumed preauth step of the user: a new login replaces the older ones. */
  async supersedeUnconsumed(context: TransactionContext, userId: string): Promise<void> {
    await context.query(
      `UPDATE app.admin_auth_challenges
          SET consumed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = $1::uuid AND consumed_at IS NULL`,
      [userId],
    );
  }

  async insert(context: TransactionContext, input: NewChallenge): Promise<{ challengeId: string; expiresAtMs: number }> {
    const challengeId = randomUUID();
    const result = await context.query<{ expires_ms: string }>(
      `INSERT INTO app.admin_auth_challenges (
         challenge_id, user_id, token_digest, csrf_nonce, csrf_key_id, password_binding, password_key_id,
         membership_version, factor_id, factor_version, device_id, expires_at, attempt_count, consumed_at, created_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::bigint, $9::uuid, $10::bigint, $11,
              clock.t + make_interval(secs => $12::double precision), 0, NULL, clock.t
         FROM (${CLOCK_CTE}) AS clock
       RETURNING ${epochMs('expires_at')} AS expires_ms`,
      [
        challengeId,
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
      throw new TechnicalError('internal', 'Challenge was not written');
    }
    return { challengeId, expiresAtMs: toSafeInteger(row.expires_ms) };
  }

  async setFactorSnapshot(
    context: TransactionContext,
    input: { challengeId: string; factorId: string; factorVersion: number },
  ): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_auth_challenges
          SET factor_id = $2::uuid, factor_version = $3::bigint
        WHERE challenge_id = $1::uuid AND consumed_at IS NULL AND factor_id IS NULL`,
      [input.challengeId, input.factorId, input.factorVersion],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Challenge snapshot was not written');
    }
  }

  /** One wrong code: the counter goes up and the challenge is consumed when it reaches the limit. */
  async recordWrongAttempt(
    context: TransactionContext,
    challengeId: string,
  ): Promise<{ attemptCount: number; consumed: boolean }> {
    const result = await context.query<{ attempt_count: number; consumed: boolean }>(
      `UPDATE app.admin_auth_challenges
          SET attempt_count = attempt_count + 1,
              consumed_at = CASE WHEN attempt_count + 1 >= $2::int
                                 THEN date_trunc('milliseconds', clock_timestamp()) ELSE consumed_at END
        WHERE challenge_id = $1::uuid AND consumed_at IS NULL AND attempt_count < $2::int
       RETURNING attempt_count, consumed_at IS NOT NULL AS consumed`,
      [challengeId, CHALLENGE_ATTEMPT_LIMIT],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Challenge attempt was not recorded');
    }
    return { attemptCount: row.attempt_count, consumed: row.consumed };
  }

  async consume(context: TransactionContext, challengeId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_auth_challenges
          SET consumed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE challenge_id = $1::uuid AND consumed_at IS NULL`,
      [challengeId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Challenge was not consumed');
    }
  }
}
