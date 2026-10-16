import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, standardAccountOriginPolicy } from './account-origin';
import { AUDIT_ACTIONS, OTP_PROVIDER_TIMEOUT_MS, REGISTER_PURPOSE, RESET_PASSWORD_PURPOSE } from './auth-constants';
import { AUTH_CONFIG } from './auth-config.provider';
import { computeOtpDigest, digestsEqual, generateOtp } from './otp';
import { otpRequestLockKey } from './otp-lane-lock';
import { isQueuedReceipt, OTP_PROVIDER, OtpDelivery, OtpProvider } from './otp-provider';
import { generateToken } from './tokens';
import { UserRepository } from './user-repository';
import { SystemSettingsReader } from '../system-settings/system-settings-reader';
import { VerificationRepository } from './verification-repository';

/**
 * `delivery_status` is present ONLY when the code was accepted into the SMS queue and is NOT sent yet (PENDING_DELIVERY): the
 * code cannot be verified until the phone reports it (GET /auth/phone-verifications/:id). A synchronous provider omits the
 * field, which keeps the original response shape.
 */
export interface OtpRequestResult {
  readonly verification_id: string;
  readonly expires_in_seconds: number;
  readonly resend_after_seconds: number;
  readonly delivery_status?: 'PENDING_DELIVERY';
}

/** SENT | PENDING_DELIVERY | UNCERTAIN (the SMS may or may not have left; the code can still be used) | FAILED | EXPIRED | CLOSED */
export interface OtpDeliveryStatus {
  readonly delivery_status: 'SENT' | 'PENDING_DELIVERY' | 'UNCERTAIN' | 'FAILED' | 'EXPIRED' | 'CLOSED';
}

export interface OtpVerifyResult {
  readonly verification_token: string;
  readonly purpose: string;
  readonly expires_in_seconds: number;
}

type VerifyOutcome =
  | { readonly kind: 'verified'; readonly token: string }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly justLocked: boolean }
  | { readonly kind: 'expired' }
  | { readonly kind: 'rejected'; readonly code: 'OTP_INVALID' | 'OTP_ALREADY_USED' };

/**
 * OTP request and verification (task sections 7, 8 and 11 to 13).
 *
 * Request: short transaction (lane lock, cooldown, PENDING_DELIVERY row), COMMIT, provider call OUTSIDE any
 * transaction, then a short transaction to PENDING (or a best-effort DELIVERY_FAILED and a sanitized 503).
 * Verify: ONE transaction that locks the row, reads the database clock after the lock and either counts a
 * wrong attempt or verifies and creates the proof. A wrong attempt and a LOCKED transition must COMMIT, so
 * the transaction returns an outcome and the typed error is thrown after the commit.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly verifications: VerificationRepository,
    private readonly users: UserRepository,
    private readonly recorder: StandaloneAuditRecorder,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy = standardAccountOriginPolicy(),
    // The SYSTEM settings; optional only so that a unit harness without a database can build the service.
    @Optional() private readonly systemSettings?: SystemSettingsReader,
  ) {}

  async requestOtp(phoneNormalized: string, purpose: string): Promise<OtpRequestResult> {
    // Staging fixture mode (M00-D2): closed at the service boundary, before the database, a digest or the provider.
    this.policy.assertRegistrationOpen();
    // SYSTEM turned the registration OTP off: no code is issued (nothing is sent, no SMS is spent). The application registers
    // without a proof; the SMS gateway itself stays on for the other purposes. The recovery of a locked account has its own request.
    if (this.systemSettings !== undefined && !(await this.systemSettings.registrationOtpRequired())) {
      throw new AppError('PHONE_VERIFICATION_NOT_REQUIRED');
    }
    // A provider with a queue (the SMS gateway) says BEFORE anything is written whether it can take a message at all.
    const readiness = await this.provider.assertReady?.(phoneNormalized, REGISTER_PURPOSE);
    if (readiness !== undefined && !readiness.deliverable) {
      throw new TechnicalError('unavailable', 'OTP delivery is not available for this number');
    }
    const verificationId = randomUUID();
    const otp = generateOtp();
    const otpDigest = computeOtpDigest(this.config.otpHmacKey, verificationId, phoneNormalized, purpose, otp);

    await this.transactions.withTransaction(async (context) => {
      await this.verifications.lockLane(context, otpRequestLockKey(phoneNormalized, purpose));
      if (await this.users.isPhoneRegistered(context, 'APP_USER', phoneNormalized)) {
        // A locked account whose owner asked for its deletion can be recovered (OTP + a new password): the app opens that flow.
        const existing = await this.users.findByPhone(context, 'APP_USER', phoneNormalized);
        throw new AppError(
          existing?.status === 'DISABLED' && existing.lockReason === 'DELETE_REQUEST' ? 'ACCOUNT_RECOVERY_AVAILABLE' : 'PHONE_ALREADY_REGISTERED',
        );
      }
      if (await this.verifications.hasLiveCooldown(context, phoneNormalized, purpose)) {
        throw new AppError('OTP_RATE_LIMITED');
      }
      await this.verifications.invalidateLive(context, phoneNormalized, purpose);
      await this.verifications.insertPendingDelivery(context, {
        verificationId,
        phoneNormalized,
        purpose,
        otpDigest,
        otpTtlSeconds: this.config.otpTtlSeconds,
        resendSeconds: this.config.otpResendSeconds,
      });
    });

    // Committed. The provider is called with no transaction open.
    let queued = false;
    try {
      queued = await this.#deliver(phoneNormalized, otp, {
        verificationId,
        purpose: REGISTER_PURPOSE,
        ttlSeconds: this.config.otpTtlSeconds,
      });
    } catch {
      await this.#markDeliveryFailed(verificationId);
      throw new TechnicalError('unavailable', 'OTP delivery failed');
    }

    if (queued) {
      // Only ACCEPTED into the SMS queue: the challenge stays PENDING_DELIVERY (cannot be verified) until the gateway reports.
      return {
        verification_id: verificationId,
        expires_in_seconds: this.config.otpTtlSeconds,
        resend_after_seconds: this.config.otpResendSeconds,
        delivery_status: 'PENDING_DELIVERY',
      };
    }

    const marked = await this.transactions.withTransaction((context) =>
      this.verifications.markPending(context, verificationId),
    );
    if (!marked) {
      // Superseded while the provider was working: this OTP can no longer be verified.
      throw new TechnicalError('unavailable', 'OTP challenge was superseded');
    }

    return {
      verification_id: verificationId,
      expires_in_seconds: this.config.otpTtlSeconds,
      resend_after_seconds: this.config.otpResendSeconds,
    };
  }

  /**
   * RESET_PASSWORD request (issue #102). The answer never depends on the account: a challenge row is written for EVERY number
   * (so the cooldown and the per-phone caps behave the same), and only an eligible, allowed number is actually queued.
   * Pre-flight failures (kill switch, no gateway, caps) are identical for every number. After the pre-flight a failure to queue
   * is NOT shown either: the challenge is closed and the caller still gets the generic answer.
   */
  async requestResetOtp(
    phoneNormalized: string,
    isEligible: (context: TransactionContext) => Promise<boolean>,
    // The challenge purpose (the account scope / flow it is bound to). The SMS category stays RESET_PASSWORD for all of them.
    purpose: string = RESET_PASSWORD_PURPOSE,
  ): Promise<OtpRequestResult> {
    const sender = this.provider.sendResetOtp?.bind(this.provider);
    if (sender === undefined) {
      throw new TechnicalError('unavailable', 'Password reset OTP is not available');
    }
    const readiness = await this.provider.assertReady?.(phoneNormalized, RESET_PASSWORD_PURPOSE);
    if (readiness === undefined) {
      throw new TechnicalError('unavailable', 'Password reset OTP is not available');
    }
    const verificationId = randomUUID();
    const otp = generateOtp();
    const otpDigest = computeOtpDigest(this.config.otpHmacKey, verificationId, phoneNormalized, purpose, otp);

    const eligible = await this.transactions.withTransaction(async (context) => {
      await this.verifications.lockLane(context, otpRequestLockKey(phoneNormalized, purpose));
      if (await this.verifications.hasLiveCooldown(context, phoneNormalized, purpose)) {
        throw new AppError('OTP_RATE_LIMITED');
      }
      await this.verifications.invalidateLive(context, phoneNormalized, purpose);
      await this.verifications.insertPendingDelivery(context, {
        verificationId,
        phoneNormalized,
        purpose,
        otpDigest,
        otpTtlSeconds: this.config.otpTtlSeconds,
        resendSeconds: this.config.otpResendSeconds,
      });
      return (await isEligible(context)) && readiness.deliverable;
    });

    if (eligible) {
      try {
        await this.#withTimeout(
          sender(phoneNormalized, otp, {
            verificationId,
            purpose: RESET_PASSWORD_PURPOSE,
            ttlSeconds: this.config.otpTtlSeconds,
          }),
        );
      } catch {
        await this.#markDeliveryFailed(verificationId);
      }
    }
    return {
      verification_id: verificationId,
      expires_in_seconds: this.config.otpTtlSeconds,
      resend_after_seconds: this.config.otpResendSeconds,
      delivery_status: 'PENDING_DELIVERY',
    };
  }

  /** Delivery state of a REGISTER challenge, for the client that created it. Says nothing about any account. */
  async getDelivery(verificationId: string): Promise<OtpDeliveryStatus> {
    const view = await this.transactions.withTransaction((context) => this.verifications.deliveryView(context, verificationId));
    if (view === undefined || view.purpose !== REGISTER_PURPOSE) {
      throw new AppError('OTP_INVALID');
    }
    if (view.status === 'PENDING_DELIVERY') {
      return { delivery_status: view.expired ? 'EXPIRED' : 'PENDING_DELIVERY' };
    }
    if (view.status === 'DELIVERY_FAILED') {
      return { delivery_status: view.jobStatus === 'EXPIRED' ? 'EXPIRED' : 'FAILED' };
    }
    if (view.status === 'PENDING') {
      return { delivery_status: view.expired ? 'EXPIRED' : view.jobStatus === 'UNKNOWN' ? 'UNCERTAIN' : 'SENT' };
    }
    return { delivery_status: 'CLOSED' };
  }

  async verifyOtp(
    verificationId: string,
    otp: string,
    requestId: string,
    purpose: string = REGISTER_PURPOSE,
  ): Promise<OtpVerifyResult> {
    // Same boundary as requestOtp: nothing is read or counted while the fixture mode is on.
    this.policy.assertRegistrationOpen();
    const outcome = await this.transactions.withTransaction((context) =>
      this.#verifyInTransaction(context, verificationId, otp, purpose),
    );

    switch (outcome.kind) {
      case 'verified':
        return {
          verification_token: outcome.token,
          purpose,
          expires_in_seconds: this.config.proofTtlSeconds,
        };
      case 'wrong':
        throw new AppError('OTP_INVALID');
      case 'expired':
        throw new AppError('OTP_EXPIRED');
      case 'rejected':
        throw new AppError(outcome.code);
      case 'locked':
        await this.recorder.recordBestEffort({
          requestId,
          actorType: 'ANONYMOUS',
          action: AUDIT_ACTIONS.otpVerify,
          resourceType: 'phone_verification',
          resourceId: verificationId,
          outcome: 'DENIED',
          reasonCode: outcome.justLocked ? 'OTP_LOCKED' : 'OTP_ALREADY_LOCKED',
        });
        throw new AppError('OTP_RATE_LIMITED');
    }
  }

  async #verifyInTransaction(
    context: TransactionContext,
    verificationId: string,
    otp: string,
    purpose: string,
  ): Promise<VerifyOutcome> {
    const row = await this.verifications.lockForVerify(context, verificationId);
    // A challenge of another purpose is indistinguishable from an unknown one: a REGISTER code never resets a password and
    // the other way round. Nothing is counted against it.
    if (row === undefined || row.purpose !== purpose) {
      return { kind: 'rejected', code: 'OTP_INVALID' };
    }
    // The clock is read AFTER the lock: the wait for the lock may have lasted past the expiry.
    const nowMs = await freshClockMs(context);

    switch (row.status) {
      case 'VERIFIED':
      case 'INVALIDATED':
        return { kind: 'rejected', code: 'OTP_ALREADY_USED' };
      case 'LOCKED':
        return { kind: 'locked', justLocked: false };
      case 'PENDING_DELIVERY':
      case 'DELIVERY_FAILED':
        // Never handed to a client as usable.
        return { kind: 'rejected', code: 'OTP_INVALID' };
      case 'PENDING':
        break;
    }

    if (row.expiresAtMs <= nowMs) {
      return { kind: 'expired' };
    }

    const expected = computeOtpDigest(
      this.config.otpHmacKey,
      row.verificationId,
      row.phoneNormalized,
      row.purpose,
      otp,
    );
    if (!digestsEqual(expected, row.otpDigest)) {
      const { status } = await this.verifications.recordWrongAttempt(
        context,
        row.verificationId,
        this.config.otpMaxAttempts,
      );
      return status === 'LOCKED' ? { kind: 'locked', justLocked: true } : { kind: 'wrong' };
    }

    await this.verifications.markVerified(context, row.verificationId);
    const { token, digest } = generateToken();
    await this.verifications.insertProof(context, {
      proofId: randomUUID(),
      verificationId: row.verificationId,
      phoneNormalized: row.phoneNormalized,
      purpose: row.purpose,
      tokenDigest: digest,
      proofTtlSeconds: this.config.proofTtlSeconds,
    });
    return { kind: 'verified', token };
  }

  /** True when the provider only QUEUED the message (it is not delivered yet). */
  async #deliver(phoneNormalized: string, otp: string, delivery: OtpDelivery): Promise<boolean> {
    const result = await this.#withTimeout(
      (async () => this.provider.sendRegisterOtp(phoneNormalized, otp, delivery))(),
    );
    return isQueuedReceipt(result);
  }

  async #withTimeout<T>(call: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('provider timeout')), OTP_PROVIDER_TIMEOUT_MS);
    });
    // If the timeout wins, a later rejection of the abandoned call must not become an unhandled rejection.
    call.catch(() => undefined);
    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #markDeliveryFailed(verificationId: string): Promise<void> {
    try {
      await this.transactions.withTransaction((context) =>
        this.verifications.markDeliveryFailed(context, verificationId),
      );
    } catch {
      // Best effort: the row then stays PENDING_DELIVERY, which can never be verified and stops holding the
      // cooldown when it elapses. The caller still gets the sanitized 503.
    }
  }
}
