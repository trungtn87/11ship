import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { VerificationRepository } from '../auth/verification-repository';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { SmsGatewayConfig } from '../config/sms-gateway-config';
import { CryptoError } from '../crypto/crypto-error';
import { Keyring } from '../crypto/keyring';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  renderOtpSms,
  SMS_ACK_RESULTS,
  SMS_ERROR_CODE_PATTERN,
  SMS_MIN_REMAINING_SECONDS,
  SmsAckResult,
  SmsPurpose,
} from './sms-gateway-constants';
import { SmsGatewayRepository } from './sms-gateway-repository';

export interface SmsDelivery {
  readonly verificationId: string;
  readonly purpose: SmsPurpose;
  readonly ttlSeconds: number;
}

export interface Readiness {
  /** False when the recipient policy (allowlist) excludes the number: the caller must not queue anything. */
  readonly deliverable: boolean;
}

/** What the gateway receives for one claimed job. The only place where the plaintext message leaves the server. */
export interface ClaimedMessage {
  readonly jobId: string;
  readonly attemptId: string;
  readonly to: string;
  readonly text: string;
  readonly leaseSeconds: number;
  readonly expiresAt: string;
}

/** Holder so the keyring (optional in AppConfig) is resolved once and failure is explicit. */
@Injectable()
export class SmsKeyringHolder {
  readonly keyring: Keyring;

  constructor(@Inject(APP_CONFIG) appConfig: AppConfig) {
    if (appConfig.crypto === undefined) {
      throw new TechnicalError('internal', 'Keyring is required');
    }
    this.keyring = appConfig.crypto;
  }
}

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/**
 * The OTP queue (issue #102). The backend is the only place that creates an OTP and the only place that composes the SMS: the
 * gateway can neither choose the text nor the recipient. A job is handed out at most ONCE (no automatic retry): whatever
 * happens after a claim is reported as SENT, FAILED or UNKNOWN, and a challenge whose SMS may or may not have left stays
 * usable (UNKNOWN) instead of being resent. The sealed message is erased from the row the moment the job is final.
 */
@Injectable()
export class SmsQueueService {
  private readonly config: SmsGatewayConfig;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly repository: SmsGatewayRepository,
    private readonly verifications: VerificationRepository,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    private readonly keyring: SmsKeyringHolder,
  ) {
    if (appConfig.smsGateway === undefined) {
      throw new TechnicalError('internal', 'SMS gateway is not configured');
    }
    this.config = appConfig.smsGateway;
  }

  get settings(): SmsGatewayConfig {
    return this.config;
  }

  /**
   * Checks that a message could be queued right now, WITHOUT looking at any account, so that the answer is identical for a
   * registered and an unregistered number: kill switch, a ready gateway, the global cap and the per-phone caps (counted over
   * the OTP challenges of the phone, which exist for unknown numbers too). Throws 503 (not ready) or 429 (a cap).
   */
  async assertReady(phoneNormalized: string): Promise<Readiness> {
    return this.transactions.withTransaction(async (context) => {
      await this.#gate(context, phoneNormalized, true);
      return { deliverable: this.#recipientAllowed(phoneNormalized) };
    });
  }

  /** Queues the fixed OTP message for an already committed PENDING_DELIVERY challenge. */
  async enqueue(phoneNormalized: string, otp: string, delivery: SmsDelivery): Promise<void> {
    if (!this.#recipientAllowed(phoneNormalized)) {
      throw new TechnicalError('unavailable', 'Recipient is not allowed');
    }
    const jobId = randomUUID();
    const plaintext = Buffer.from(
      JSON.stringify({ to: phoneNormalized, text: renderOtpSms(delivery.purpose, otp, delivery.ttlSeconds) }),
      'utf8',
    );
    const version = this.keyring.keyring.active();
    const sealed = version.sealSmsPayload(jobId, plaintext);
    plaintext.fill(0);

    const inserted = await this.transactions.withTransaction(async (context) => {
      await this.repository.lockEnqueue(context);
      // Re-checked under the lock: the global cap and the kill switch cannot be raced past by concurrent requests.
      await this.#gate(context, phoneNormalized, false);
      return this.repository.insertJob(context, {
        jobId,
        verificationId: delivery.verificationId,
        purpose: delivery.purpose,
        phoneNormalized,
        sealed: { ...sealed, keyId: version.id },
      });
    });
    if (!inserted) {
      // The challenge was superseded or already queued: nothing was written, so nothing may be reported as accepted.
      throw new TechnicalError('unavailable', 'OTP challenge is no longer waiting for delivery');
    }
  }

  async #gate(context: TransactionContext, phoneNormalized: string, checkPhoneCaps: boolean): Promise<void> {
    if (!(await this.repository.sendingEnabled(context))) {
      throw new TechnicalError('unavailable', 'SMS sending is disabled');
    }
    if ((await this.repository.countReadyDevices(context, this.config.onlineWindowSeconds)) < 1) {
      throw new TechnicalError('unavailable', 'No SMS gateway is online');
    }
    if ((await this.repository.countJobsSince(context, DAY_SECONDS)) >= this.config.limitGlobalPerDay) {
      throw new AppError('OTP_RATE_LIMITED');
    }
    if (checkPhoneCaps) {
      if (
        (await this.repository.countChallengesSince(context, phoneNormalized, HOUR_SECONDS)) >= this.config.limitPhonePerHour ||
        (await this.repository.countChallengesSince(context, phoneNormalized, DAY_SECONDS)) >= this.config.limitPhonePerDay
      ) {
        throw new AppError('OTP_RATE_LIMITED');
      }
    }
  }

  #recipientAllowed(phoneNormalized: string): boolean {
    return this.config.recipientMode === 'OPEN' || this.config.allowlist.has(phoneNormalized);
  }

  // --- gateway side ----------------------------------------------------------------------------------------------

  /** Heartbeat of a paired device; the answer tells it whether sending is enabled at all (the kill switch). */
  async heartbeat(
    deviceId: string,
    input: { appVersion: string | null; smsPermission: boolean | null; paused: boolean | null },
  ): Promise<{ sendingEnabled: boolean; pollSeconds: number }> {
    return this.transactions.withTransaction(async (context) => {
      if (!(await this.repository.recordHeartbeat(context, { deviceId, ...input }))) {
        throw new AppError('GATEWAY_UNAUTHORIZED');
      }
      return { sendingEnabled: await this.repository.sendingEnabled(context), pollSeconds: this.config.pollSeconds };
    });
  }

  /** Hands out at most one job. Expired work is closed first so that no stale OTP is ever delivered. */
  async claim(deviceId: string, device: { paused: boolean | null; smsPermission: boolean | null }): Promise<{ sendingEnabled: boolean; message: ClaimedMessage | undefined }> {
    const attemptId = randomUUID();
    return this.transactions.withTransaction(async (context) => {
      if (!(await this.repository.recordHeartbeat(context, { deviceId, appVersion: null, smsPermission: device.smsPermission, paused: device.paused }))) {
        throw new AppError('GATEWAY_UNAUTHORIZED');
      }
      const expired = await this.repository.expireQueued(context, SMS_MIN_REMAINING_SECONDS);
      for (const verificationId of expired) {
        await this.verifications.failDelivery(context, verificationId);
      }
      const unknown = await this.repository.expireLeases(context);
      for (const verificationId of unknown) {
        await this.verifications.markPending(context, verificationId);
      }
      const sendingEnabled = await this.repository.sendingEnabled(context);
      if (!sendingEnabled || device.paused === true || device.smsPermission === false) {
        return { sendingEnabled, message: undefined };
      }
      const job = await this.repository.claimNext(context, { deviceId, attemptId, leaseSeconds: this.config.leaseSeconds });
      if (job === undefined) {
        return { sendingEnabled, message: undefined };
      }
      const version = this.keyring.keyring.version(job.sealed.keyId);
      if (version === undefined) {
        throw new TechnicalError('internal', 'SMS payload key is not available');
      }
      let opened: { to: string; text: string };
      try {
        const plaintext = version.openSmsPayload(job.jobId, job.sealed);
        opened = JSON.parse(plaintext.toString('utf8')) as { to: string; text: string };
        plaintext.fill(0);
      } catch (error) {
        if (error instanceof CryptoError) {
          throw new TechnicalError('internal', 'SMS payload could not be opened');
        }
        throw new TechnicalError('internal', 'SMS payload is malformed');
      }
      return {
        sendingEnabled,
        message: {
          jobId: job.jobId,
          attemptId: job.attemptId,
          to: opened.to,
          text: opened.text,
          leaseSeconds: this.config.leaseSeconds,
          expiresAt: new Date(job.expiresAtMs).toISOString(),
        },
      };
    });
  }

  /**
   * Idempotent acknowledgement. The same result twice is a no-op; UNKNOWN may be refined to SENT or FAILED; a contradictory final
   * result is a 409. The challenge follows the job: SENT/UNKNOWN make it verifiable, FAILED closes it.
   */
  async acknowledge(
    deviceId: string,
    jobId: string,
    input: { attemptId: string; result: SmsAckResult; errorCode: string | null },
  ): Promise<{ status: string }> {
    if (!SMS_ACK_RESULTS.includes(input.result) || (input.errorCode !== null && !SMS_ERROR_CODE_PATTERN.test(input.errorCode))) {
      throw new AppError('GATEWAY_ACK_CONFLICT');
    }
    return this.transactions.withTransaction(async (context) => {
      const job = await this.repository.lockJobForAck(context, jobId);
      if (job === undefined || job.attemptId !== input.attemptId || job.claimedBy !== deviceId) {
        throw new AppError('GATEWAY_JOB_NOT_FOUND');
      }
      if (input.result === 'DELIVERED') {
        if (job.status !== 'SENT') {
          throw new AppError('GATEWAY_ACK_CONFLICT');
        }
        await this.repository.markDelivered(context, jobId);
        return { status: job.status };
      }
      if (job.status === input.result) {
        return { status: job.status };
      }
      const allowed =
        job.status === 'CLAIMED' || (job.status === 'UNKNOWN' && (input.result === 'SENT' || input.result === 'FAILED'));
      if (!allowed) {
        throw new AppError('GATEWAY_ACK_CONFLICT');
      }
      await this.repository.finishJob(context, jobId, input.result, input.errorCode);
      if (input.result === 'FAILED') {
        await this.verifications.failDelivery(context, job.verificationId);
      } else {
        await this.verifications.markPending(context, job.verificationId);
      }
      return { status: input.result };
    });
  }
}
