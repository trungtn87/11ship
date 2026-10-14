import { Injectable } from '@nestjs/common';
import { epochMs, toSafeInteger } from '../auth/auth-db';
import { deriveLockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { SMS_ENQUEUE_LOCK_DOMAIN, SmsJobStatus, SmsPurpose } from './sms-gateway-constants';

export interface SealedPayload {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
  readonly keyId: string;
}

export interface ClaimedJob {
  readonly jobId: string;
  readonly attemptId: string;
  readonly purpose: SmsPurpose;
  readonly sealed: SealedPayload;
  readonly expiresAtMs: number;
  readonly leaseExpiresAtMs: number;
}

export interface JobForAck {
  readonly jobId: string;
  readonly verificationId: string;
  readonly status: SmsJobStatus;
  readonly attemptId: string | null;
  readonly claimedBy: string | null;
  readonly deliveredAt: boolean;
}

export interface DeviceInfo {
  readonly deviceId: string;
  readonly label: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly createdAtMs: number;
  readonly lastSeenAtMs: number | undefined;
  readonly appVersion: string | undefined;
  readonly smsPermission: boolean | undefined;
  readonly paused: boolean | undefined;
}

/** SQL for the SMS gateway tables. Every method takes the caller's TransactionContext. */
@Injectable()
export class SmsGatewayRepository {
  /** Serializes the cap check + insert of the queue until the transaction ends. */
  async lockEnqueue(context: TransactionContext): Promise<void> {
    const key = deriveLockKey(SMS_ENQUEUE_LOCK_DOMAIN, ['queue']);
    await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [key[0], key[1]]);
  }

  /** True only when the control row exists and says sending is enabled (absent = disabled, fail closed). */
  async sendingEnabled(context: TransactionContext): Promise<boolean> {
    const result = await context.query<{ sending_enabled: boolean }>(
      'SELECT sending_enabled FROM app.sms_gateway_control WHERE singleton',
    );
    return result.rows[0]?.sending_enabled === true;
  }

  async setSendingEnabled(context: TransactionContext, enabled: boolean): Promise<void> {
    await context.query(
      `INSERT INTO app.sms_gateway_control (singleton, sending_enabled, updated_at)
       VALUES (true, $1, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (singleton) DO UPDATE SET sending_enabled = EXCLUDED.sending_enabled, updated_at = EXCLUDED.updated_at`,
      [enabled],
    );
  }

  /** Number of ACTIVE devices that polled recently, reported permission to send and are not paused. */
  async countReadyDevices(context: TransactionContext, onlineWindowSeconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM app.sms_gateway_devices
        WHERE status = 'ACTIVE'
          AND last_seen_at > clock_timestamp() - make_interval(secs => $1::double precision)
          AND sms_permission IS TRUE
          AND paused IS NOT TRUE`,
      [onlineWindowSeconds],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  async countJobsSince(context: TransactionContext, windowSeconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.sms_jobs
        WHERE created_at > clock_timestamp() - make_interval(secs => $1::double precision)`,
      [windowSeconds],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  /** OTP challenges of a phone (every purpose, every outcome) inside the window. Same count for unknown phones. */
  async countChallengesSince(context: TransactionContext, phoneNormalized: string, windowSeconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.phone_verifications
        WHERE phone_normalized = $1
          AND purpose IN ('REGISTER', 'RESET_PASSWORD')
          AND created_at > clock_timestamp() - make_interval(secs => $2::double precision)`,
      [phoneNormalized, windowSeconds],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  /** The OTP expiry of a challenge, as epoch ms of the database clock; undefined when it does not exist. */
  async verificationExpiry(context: TransactionContext, verificationId: string): Promise<{ readonly expiresAtMs: number; readonly nowMs: number } | undefined> {
    const result = await context.query<{ expires_ms: string; now_ms: string }>(
      `SELECT ${epochMs('expires_at')} AS expires_ms, ${epochMs('clock_timestamp()')} AS now_ms
         FROM app.phone_verifications WHERE verification_id = $1::uuid`,
      [verificationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { expiresAtMs: toSafeInteger(row.expires_ms), nowMs: toSafeInteger(row.now_ms) };
  }

  async insertJob(
    context: TransactionContext,
    job: { jobId: string; verificationId: string; purpose: SmsPurpose; phoneNormalized: string; sealed: SealedPayload },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.sms_jobs (
         job_id, verification_id, purpose, phone_normalized, status,
         payload_iv, payload_tag, payload_ciphertext, crypto_key_id, created_at, expires_at
       )
       SELECT $1::uuid, $2::uuid, $3, $4, 'QUEUED', $5, $6, $7, $8, clock.t, v.expires_at
         FROM app.phone_verifications v,
              (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock
        WHERE v.verification_id = $2::uuid AND v.status = 'PENDING_DELIVERY'
       ON CONFLICT (verification_id) DO NOTHING`,
      [
        job.jobId,
        job.verificationId,
        job.purpose,
        job.phoneNormalized,
        job.sealed.iv,
        job.sealed.tag,
        job.sealed.ciphertext,
        job.sealed.keyId,
      ],
    );
    return result.rowCount === 1;
  }

  /** QUEUED jobs whose OTP is (almost) gone become EXPIRED and their ciphertext is erased. Returns their challenges. */
  async expireQueued(context: TransactionContext, minRemainingSeconds: number): Promise<string[]> {
    const result = await context.query<{ verification_id: string }>(
      `UPDATE app.sms_jobs
          SET status = 'EXPIRED', payload_iv = NULL, payload_tag = NULL, payload_ciphertext = NULL,
              finished_at = date_trunc('milliseconds', clock_timestamp()), result_code = 'OTP_EXPIRED'
        WHERE status = 'QUEUED'
          AND expires_at <= clock_timestamp() + make_interval(secs => $1::double precision)
        RETURNING verification_id`,
      [minRemainingSeconds],
    );
    return result.rows.map((row) => row.verification_id);
  }

  /** CLAIMED jobs whose lease ran out without an acknowledgement become UNKNOWN (never resent). */
  async expireLeases(context: TransactionContext): Promise<string[]> {
    const result = await context.query<{ verification_id: string }>(
      `UPDATE app.sms_jobs
          SET status = 'UNKNOWN', payload_iv = NULL, payload_tag = NULL, payload_ciphertext = NULL,
              finished_at = date_trunc('milliseconds', clock_timestamp()), result_code = 'LEASE_EXPIRED'
        WHERE status = 'CLAIMED' AND lease_expires_at <= clock_timestamp()
        RETURNING verification_id`,
    );
    return result.rows.map((row) => row.verification_id);
  }

  /** Hands the oldest sendable job to this device attempt. Concurrent claims never get the same job (SKIP LOCKED). */
  async claimNext(
    context: TransactionContext,
    args: { deviceId: string; attemptId: string; leaseSeconds: number },
  ): Promise<ClaimedJob | undefined> {
    const result = await context.query<{
      job_id: string;
      attempt_id: string;
      purpose: SmsPurpose;
      payload_iv: Buffer;
      payload_tag: Buffer;
      payload_ciphertext: Buffer;
      crypto_key_id: string;
      expires_ms: string;
      lease_ms: string;
    }>(
      `UPDATE app.sms_jobs j
          SET status = 'CLAIMED', attempt_id = $2::uuid, claimed_by = $1::uuid,
              claimed_at = date_trunc('milliseconds', clock_timestamp()),
              lease_expires_at = date_trunc('milliseconds', clock_timestamp()) + make_interval(secs => $3::double precision)
        WHERE j.job_id = (
                SELECT job_id FROM app.sms_jobs
                 WHERE status = 'QUEUED'
                 ORDER BY created_at
                 LIMIT 1
                   FOR UPDATE SKIP LOCKED)
          AND j.status = 'QUEUED'
        RETURNING j.job_id, j.attempt_id, j.purpose, j.payload_iv, j.payload_tag, j.payload_ciphertext, j.crypto_key_id,
                  ${epochMs('j.expires_at')} AS expires_ms, ${epochMs('j.lease_expires_at')} AS lease_ms`,
      [args.deviceId, args.attemptId, args.leaseSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      jobId: row.job_id,
      attemptId: row.attempt_id,
      purpose: row.purpose,
      sealed: { iv: row.payload_iv, tag: row.payload_tag, ciphertext: row.payload_ciphertext, keyId: row.crypto_key_id },
      expiresAtMs: toSafeInteger(row.expires_ms),
      leaseExpiresAtMs: toSafeInteger(row.lease_ms),
    };
  }

  async lockJobForAck(context: TransactionContext, jobId: string): Promise<JobForAck | undefined> {
    const result = await context.query<{
      job_id: string;
      verification_id: string;
      status: SmsJobStatus;
      attempt_id: string | null;
      claimed_by: string | null;
      delivered: boolean;
    }>(
      `SELECT job_id, verification_id, status, attempt_id, claimed_by, delivered_at IS NOT NULL AS delivered
         FROM app.sms_jobs WHERE job_id = $1::uuid FOR UPDATE`,
      [jobId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      jobId: row.job_id,
      verificationId: row.verification_id,
      status: row.status,
      attemptId: row.attempt_id,
      claimedBy: row.claimed_by,
      deliveredAt: row.delivered,
    };
  }

  /** Final transition. The ciphertext is erased in the same statement. */
  async finishJob(context: TransactionContext, jobId: string, status: 'SENT' | 'FAILED' | 'UNKNOWN', resultCode: string | null): Promise<void> {
    await context.query(
      `UPDATE app.sms_jobs
          SET status = $2, payload_iv = NULL, payload_tag = NULL, payload_ciphertext = NULL,
              finished_at = COALESCE(finished_at, date_trunc('milliseconds', clock_timestamp())),
              result_code = $3
        WHERE job_id = $1::uuid`,
      [jobId, status, resultCode],
    );
  }

  async markDelivered(context: TransactionContext, jobId: string): Promise<void> {
    await context.query(
      `UPDATE app.sms_jobs SET delivered_at = COALESCE(delivered_at, date_trunc('milliseconds', clock_timestamp()))
        WHERE job_id = $1::uuid`,
      [jobId],
    );
  }

  // --- devices ---------------------------------------------------------------------------------------------------

  async insertDevice(context: TransactionContext, args: { deviceId: string; label: string; credentialDigest: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.sms_gateway_devices (device_id, label, credential_digest, status, created_at)
       VALUES ($1::uuid, $2, $3, 'ACTIVE', date_trunc('milliseconds', clock_timestamp()))`,
      [args.deviceId, args.label, args.credentialDigest],
    );
  }

  async findActiveDeviceByDigest(context: TransactionContext, credentialDigest: string): Promise<string | undefined> {
    const result = await context.query<{ device_id: string }>(
      `SELECT device_id FROM app.sms_gateway_devices WHERE credential_digest = $1 AND status = 'ACTIVE'`,
      [credentialDigest],
    );
    return result.rows[0]?.device_id;
  }

  async recordHeartbeat(
    context: TransactionContext,
    args: { deviceId: string; appVersion: string | null; smsPermission: boolean | null; paused: boolean | null },
  ): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.sms_gateway_devices
          SET last_seen_at = date_trunc('milliseconds', clock_timestamp()),
              app_version = COALESCE($2, app_version),
              sms_permission = COALESCE($3, sms_permission),
              paused = COALESCE($4, paused)
        WHERE device_id = $1::uuid AND status = 'ACTIVE'`,
      [args.deviceId, args.appVersion, args.smsPermission, args.paused],
    );
    return result.rowCount === 1;
  }

  async revokeDevice(context: TransactionContext, deviceId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.sms_gateway_devices
          SET status = 'REVOKED', revoked_at = date_trunc('milliseconds', clock_timestamp())
        WHERE device_id = $1::uuid AND status = 'ACTIVE'`,
      [deviceId],
    );
    return result.rowCount === 1;
  }

  async listDevices(context: TransactionContext): Promise<DeviceInfo[]> {
    const result = await context.query<{
      device_id: string;
      label: string;
      status: 'ACTIVE' | 'REVOKED';
      created_ms: string;
      seen_ms: string | null;
      app_version: string | null;
      sms_permission: boolean | null;
      paused: boolean | null;
    }>(
      `SELECT device_id, label, status, ${epochMs('created_at')} AS created_ms,
              CASE WHEN last_seen_at IS NULL THEN NULL ELSE ${epochMs('last_seen_at')} END AS seen_ms,
              app_version, sms_permission, paused
         FROM app.sms_gateway_devices ORDER BY created_at`,
    );
    return result.rows.map((row) => ({
      deviceId: row.device_id,
      label: row.label,
      status: row.status,
      createdAtMs: toSafeInteger(row.created_ms),
      lastSeenAtMs: row.seen_ms === null ? undefined : toSafeInteger(row.seen_ms),
      appVersion: row.app_version ?? undefined,
      smsPermission: row.sms_permission ?? undefined,
      paused: row.paused ?? undefined,
    }));
  }
}
