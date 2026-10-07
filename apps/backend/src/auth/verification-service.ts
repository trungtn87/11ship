import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AUDIT_ACTIONS, OTP_PROVIDER_TIMEOUT_MS, REGISTER_PURPOSE } from './auth-constants';
import { AUTH_CONFIG } from './auth-config.provider';
import { computeOtpDigest, digestsEqual, generateOtp } from './otp';
import { otpRequestLockKey } from './otp-lane-lock';
import { OTP_PROVIDER, OtpProvider } from './otp-provider';
import { generateToken } from './tokens';
import { UserRepository } from './user-repository';
import { VerificationRepository } from './verification-repository';

export interface OtpRequestResult {
  readonly verification_id: string;
  readonly expires_in_seconds: number;
  readonly resend_after_seconds: number;
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
  ) {}

  async requestOtp(phoneNormalized: string, purpose: string): Promise<OtpRequestResult> {
    const verificationId = randomUUID();
    const otp = generateOtp();
    const otpDigest = computeOtpDigest(this.config.otpHmacKey, verificationId, phoneNormalized, purpose, otp);

    await this.transactions.withTransaction(async (context) => {
      await this.verifications.lockLane(context, otpRequestLockKey(phoneNormalized, purpose));
      if (await this.users.isPhoneRegistered(context, phoneNormalized)) {
        throw new AppError('PHONE_ALREADY_REGISTERED');
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
    try {
      await this.#deliver(phoneNormalized, otp);
    } catch {
      await this.#markDeliveryFailed(verificationId);
      throw new TechnicalError('unavailable', 'OTP delivery failed');
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

  async verifyOtp(verificationId: string, otp: string, requestId: string): Promise<OtpVerifyResult> {
    const outcome = await this.transactions.withTransaction((context) =>
      this.#verifyInTransaction(context, verificationId, otp),
    );

    switch (outcome.kind) {
      case 'verified':
        return {
          verification_token: outcome.token,
          purpose: REGISTER_PURPOSE,
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
  ): Promise<VerifyOutcome> {
    const row = await this.verifications.lockForVerify(context, verificationId);
    if (row === undefined) {
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

  async #deliver(phoneNormalized: string, otp: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('provider timeout')), OTP_PROVIDER_TIMEOUT_MS);
    });
    const call = (async () => this.provider.sendRegisterOtp(phoneNormalized, otp))();
    // If the timeout wins, a later rejection of the abandoned call must not become an unhandled rejection.
    call.catch(() => undefined);
    try {
      await Promise.race([call, timeout]);
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
