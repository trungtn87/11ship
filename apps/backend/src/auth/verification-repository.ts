import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { LockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { OTP_QUOTA_PURPOSES } from './auth-constants';
import { CLOCK_CTE, epochMs, toSafeInteger } from './auth-db';

export type VerificationStatus =
  | 'PENDING_DELIVERY'
  | 'PENDING'
  | 'VERIFIED'
  | 'LOCKED'
  | 'INVALIDATED'
  | 'DELIVERY_FAILED';

export interface VerificationRow {
  readonly verificationId: string;
  readonly phoneNormalized: string;
  readonly purpose: string;
  readonly otpDigest: string;
  readonly status: VerificationStatus;
  readonly attemptCount: number;
  readonly expiresAtMs: number;
}

export interface NewVerification {
  readonly verificationId: string;
  readonly phoneNormalized: string;
  readonly purpose: string;
  readonly otpDigest: string;
  readonly otpTtlSeconds: number;
  readonly resendSeconds: number;
}

export interface NewProof {
  readonly proofId: string;
  readonly verificationId: string;
  readonly phoneNormalized: string;
  readonly purpose: string;
  readonly tokenDigest: string;
  readonly proofTtlSeconds: number;
}

/** SQL for phone_verifications and the proof insert. Every method takes the caller's TransactionContext. */
@Injectable()
export class VerificationRepository {
  /** Serializes one (phone, purpose) lane until the transaction ends. */
  async lockLane(context: TransactionContext, key: LockKey): Promise<void> {
    await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [key[0], key[1]]);
  }

  /**
   * Seconds left of the shared resend cooldown of a PHONE (every OTP purpose, so another flow or app gives no new budget), or undefined
   * when none is running. The window is the CURRENT policy value counted from each challenge's creation, so a change by SYSTEM applies
   * at once. A DELIVERY_FAILED challenge never holds it (a failed delivery cannot block the retry); a challenge that was locked by wrong
   * codes still does. Time is the database clock, read now.
   */
  async cooldownRemainingSeconds(context: TransactionContext, phoneNormalized: string, cooldownSeconds: number): Promise<number | undefined> {
    const result = await context.query<{ seconds: string | null }>(
      `SELECT ceil(extract(epoch FROM (max(created_at) + make_interval(secs => $2::double precision) - clock_timestamp())))::text AS seconds
         FROM app.phone_verifications
        WHERE phone_normalized = $1
          AND purpose = ANY($3::text[])
          AND status IN ('PENDING_DELIVERY', 'PENDING', 'VERIFIED', 'LOCKED')
          AND created_at + make_interval(secs => $2::double precision) > clock_timestamp()`,
      [phoneNormalized, cooldownSeconds, [...OTP_QUOTA_PURPOSES]],
    );
    const seconds = Number(result.rows[0]?.seconds ?? Number.NaN);
    return Number.isSafeInteger(seconds) && seconds >= 1 ? seconds : undefined;
  }

  /** OTP challenges of a phone (every purpose, every outcome) created inside the rolling window. Same count for unknown phones. */
  async countPhoneChallenges(context: TransactionContext, phoneNormalized: string, windowSeconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.phone_verifications
        WHERE phone_normalized = $1 AND purpose = ANY($3::text[])
          AND created_at > clock_timestamp() - make_interval(secs => $2::double precision)`,
      [phoneNormalized, windowSeconds, [...OTP_QUOTA_PURPOSES]],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  /** Seconds until enough challenges leave the window for one more to fit (>= 1). */
  async phoneRetryAfter(context: TransactionContext, phoneNormalized: string, windowSeconds: number, count: number, limit: number): Promise<number> {
    const result = await context.query<{ seconds: string | null }>(
      `SELECT ceil(extract(epoch FROM (created_at + make_interval(secs => $2::double precision) - clock_timestamp())))::text AS seconds
         FROM app.phone_verifications
        WHERE phone_normalized = $1 AND purpose = ANY($3::text[])
          AND created_at > clock_timestamp() - make_interval(secs => $2::double precision)
        ORDER BY created_at ASC OFFSET $4::int LIMIT 1`,
      [phoneNormalized, windowSeconds, [...OTP_QUOTA_PURPOSES], Math.max(0, count - limit)],
    );
    const seconds = Number(result.rows[0]?.seconds ?? '1');
    return Number.isSafeInteger(seconds) && seconds >= 1 ? seconds : 1;
  }

  /** A new request supersedes any challenge of the lane that could still be verified. */
  async invalidateLive(
    context: TransactionContext,
    phoneNormalized: string,
    purpose: string,
  ): Promise<void> {
    await context.query(
      `UPDATE app.phone_verifications
          SET status = 'INVALIDATED',
              invalidated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE phone_normalized = $1
          AND purpose = $2
          AND status IN ('PENDING_DELIVERY', 'PENDING')`,
      [phoneNormalized, purpose],
    );
  }

  async insertPendingDelivery(context: TransactionContext, row: NewVerification): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.phone_verifications (
         verification_id, phone_normalized, purpose, otp_digest, status, attempt_count,
         expires_at, resend_not_before, created_at
       )
       SELECT $1::uuid, $2, $3, $4, 'PENDING_DELIVERY', 0,
              clock.t + make_interval(secs => $5::double precision),
              clock.t + make_interval(secs => $6::double precision),
              clock.t
         FROM (${CLOCK_CTE}) AS clock`,
      [row.verificationId, row.phoneNormalized, row.purpose, row.otpDigest, row.otpTtlSeconds, row.resendSeconds],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Verification was not written');
    }
  }

  /** PENDING_DELIVERY -> PENDING. False when the challenge is no longer waiting for delivery. */
  async markPending(context: TransactionContext, verificationId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.phone_verifications SET status = 'PENDING'
        WHERE verification_id = $1::uuid AND status = 'PENDING_DELIVERY'`,
      [verificationId],
    );
    return result.rowCount === 1;
  }

  async markDeliveryFailed(context: TransactionContext, verificationId: string): Promise<void> {
    await context.query(
      `UPDATE app.phone_verifications SET status = 'DELIVERY_FAILED'
        WHERE verification_id = $1::uuid AND status = 'PENDING_DELIVERY'`,
      [verificationId],
    );
  }

  /**
   * The delivery gateway closed the challenge as undeliverable (FAILED / EXPIRED job). Also reaches a PENDING challenge that
   * nobody has tried yet (an UNKNOWN job later reported FAILED); a challenge with a wrong attempt is left alone.
   */
  async failDelivery(context: TransactionContext, verificationId: string): Promise<void> {
    await context.query(
      `UPDATE app.phone_verifications SET status = 'DELIVERY_FAILED'
        WHERE verification_id = $1::uuid AND status IN ('PENDING_DELIVERY', 'PENDING') AND attempt_count = 0`,
      [verificationId],
    );
  }

  /** What a client may learn about the delivery of a challenge it created (no account information). */
  async deliveryView(
    context: TransactionContext,
    verificationId: string,
  ): Promise<{ readonly purpose: string; readonly status: VerificationStatus; readonly jobStatus: string | undefined; readonly expired: boolean } | undefined> {
    const result = await context.query<{ purpose: string; status: VerificationStatus; job_status: string | null; expired: boolean }>(
      `SELECT v.purpose, v.status, j.status AS job_status, v.expires_at <= clock_timestamp() AS expired
         FROM app.phone_verifications v
         LEFT JOIN app.sms_jobs j ON j.verification_id = v.verification_id
        WHERE v.verification_id = $1::uuid`,
      [verificationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { purpose: row.purpose, status: row.status, jobStatus: row.job_status ?? undefined, expired: row.expired };
  }

  /** Locks the row. The caller reads the database clock AFTER this call. */
  async lockForVerify(
    context: TransactionContext,
    verificationId: string,
  ): Promise<VerificationRow | undefined> {
    const result = await context.query<{
      verification_id: string;
      phone_normalized: string;
      purpose: string;
      otp_digest: string;
      status: VerificationStatus;
      attempt_count: number;
      expires_ms: string;
    }>(
      `SELECT verification_id, phone_normalized, purpose, otp_digest, status, attempt_count,
              ${epochMs('expires_at')} AS expires_ms
         FROM app.phone_verifications
        WHERE verification_id = $1::uuid
          FOR UPDATE`,
      [verificationId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      verificationId: row.verification_id,
      phoneNormalized: row.phone_normalized,
      purpose: row.purpose,
      otpDigest: row.otp_digest,
      status: row.status,
      attemptCount: row.attempt_count,
      expiresAtMs: toSafeInteger(row.expires_ms),
    };
  }

  /** Counts one wrong attempt; reaching the maximum moves the challenge to LOCKED in the same statement. */
  async recordWrongAttempt(
    context: TransactionContext,
    verificationId: string,
    maxAttempts: number,
  ): Promise<{ readonly status: VerificationStatus; readonly attemptCount: number }> {
    const result = await context.query<{ status: VerificationStatus; attempt_count: number }>(
      `UPDATE app.phone_verifications
          SET attempt_count = attempt_count + 1,
              status = CASE WHEN attempt_count + 1 >= $2::int THEN 'LOCKED' ELSE status END
        WHERE verification_id = $1::uuid AND status = 'PENDING'
        RETURNING status, attempt_count`,
      [verificationId, maxAttempts],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Verification attempt was not recorded');
    }
    return { status: row.status, attemptCount: row.attempt_count };
  }

  async markVerified(context: TransactionContext, verificationId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.phone_verifications
          SET status = 'VERIFIED', verified_at = date_trunc('milliseconds', clock_timestamp())
        WHERE verification_id = $1::uuid AND status = 'PENDING'`,
      [verificationId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Verification was not marked verified');
    }
  }

  async insertProof(context: TransactionContext, proof: NewProof): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.verification_proofs (
         proof_id, verification_id, phone_normalized, purpose, token_digest, expires_at, created_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, $5,
              clock.t + make_interval(secs => $6::double precision), clock.t
         FROM (${CLOCK_CTE}) AS clock`,
      [proof.proofId, proof.verificationId, proof.phoneNormalized, proof.purpose, proof.tokenDigest, proof.proofTtlSeconds],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Proof was not written');
    }
  }
}
