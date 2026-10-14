import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ADMIN_LIMITER_KEY } from '../admin-auth/admin-limiter';
import { AdminCrypto } from '../admin-auth/admin-crypto';
import { AdminLimitsRepository } from '../admin-auth/admin-limits-repository';
import { base32Encode } from '../admin-auth/base32';
import { TOTP_ISSUER } from '../admin-auth/admin-auth-constants';
import { buildOtpauthUri, matchTotp } from '../admin-auth/totp';
import { AdminInvitationParticipant } from '../admin-invitations/admin-invitation-participant';
import { InvitationRow } from '../admin-invitations/admin-invitation-repository';
import { AdminInvitationReader, InvitationDetail } from '../admin-provisioning/admin-invitation-reader';
import { lockPhone, setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../auth/admin-password-verifier';
import { generateOtp } from '../auth/otp';
import { digestToken } from '../auth/tokens';
import { AuditWriter } from '../audit/audit-writer';
import {
  ActivationErrorDetails,
  ActivationStateError,
  AdminAuthRateLimitError,
  AppError,
  TechnicalError,
} from '../common/app-errors';
import { ActivationLimits, ActivationPhoneVerificationMode, AdminActivationConfig } from '../config/admin-activation-config';
import { AdminLimiterKey } from '../config/admin-auth-config';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { JsonObject } from '../shared/json/json-object';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ADMIN_ACTIVATION_CONFIG } from './admin-activation-config.provider';
import {
  ACTIVATION_AUDIT_ACTIONS,
  ACTOR_ANONYMOUS,
  ACTOR_USER,
  LIVE_ATTEMPT_STATUSES,
  OTP_WRONG_LIMIT,
  RESOURCE_ATTEMPT,
  RESOURCE_CHALLENGE,
  RESOURCE_INVITATION,
  TOTP_FAILURE_LIMIT,
  TOTP_WRONG_LIMIT,
} from './admin-activation-constants';
import { AdminActivationLimiter } from './admin-activation-limiter';
import { AdminActivationRepository, AttemptRow, AttemptSnapshot, ChallengeRow } from './admin-activation-repository';
import { passwordDeadlineMs, stateBody, ViewInput } from './admin-activation-views';
import { ACTIVATION_OTP_PROVIDER, ActivationOtpContext, ActivationOtpDelivery, ActivationOtpProvider } from './activation-otp-provider';

// Account activation by the invited ADMIN (M01-D-ADMIN-1C, contract sections 6 and 8-14). Every business transaction
// follows the one lock order  R0 < S0 < L2 (limiter buckets) < L3 (phone advisory) < L8 (invitation) < L9a (attempt)
// < L9b (newest challenge) < L10 (new rows), sets lock_timeout FIRST, reads the database clock `T` ONCE after its last
// lock, and decides every expiry, cooldown and TTL with that `T`. A pure refusal ROLLS BACK; only the wrong-code
// counters, the PHONE_CONFLICT closure and real state transitions COMMIT (the first two commit and THEN throw).
// There is no idempotency executor: replays are answered from the state machine (section 11).

export interface RequestMeta {
  readonly requestId: string;
  readonly ip: string;
}

/** A cookie to set on the response; `token` is the plaintext secret (only its digest is stored). */
export interface IssuedCookie {
  readonly token: string;
  readonly maxAgeSeconds: number;
}

export interface Answer {
  readonly status: number;
  readonly body: JsonObject;
  readonly cookie?: IssuedCookie;
}

type Outcome<V> = { readonly kind: 'value'; readonly value: V } | { readonly kind: 'throw'; readonly error: unknown };

const value = <V>(v: V): Outcome<V> => ({ kind: 'value', value: v });
const thenThrow = (error: unknown): Outcome<never> => ({ kind: 'throw', error });

/** Thrown INSIDE a transaction to roll it back and still answer with a prepared replay. Never reaches a client. */
class ReplayAnswer extends Error {
  readonly answer: unknown;
  constructor(answer: unknown) {
    super('replay');
    this.name = 'ReplayAnswer';
    this.answer = answer;
  }
}

const sessionInvalid = (): AppError => new AppError('ADMIN_ACTIVATION_SESSION_INVALID');
const linkInvalid = (): AppError => new AppError('ADMIN_ACTIVATION_LINK_INVALID');
const iso = (ms: number): string => new Date(ms).toISOString();
const isLive = (attempt: AttemptRow): boolean => LIVE_ATTEMPT_STATUSES.includes(attempt.status);

@Injectable()
export class AdminActivationService {
  readonly #lockTimeoutMs: number;
  readonly #providerTimeoutMs: number;
  readonly #promoteGraceMs: number;
  readonly #limits: ActivationLimits;
  /** The mode of THIS process: every new attempt records it, and a live attempt of another mode is never continued. */
  readonly #phoneMode: ActivationPhoneVerificationMode;
  /** ADMIN_ACTIVATION_OTP_MODE=SMS: delivery is asynchronous (the SMS gateway queue), so only the gateway promotes a challenge. */
  readonly #asyncDelivery: boolean;
  readonly #otpTtlSeconds: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: AdminActivationRepository,
    private readonly invitations: AdminInvitationParticipant,
    private readonly reader: AdminInvitationReader,
    private readonly identities: AdminIdentityParticipant,
    private readonly passwords: AdminPasswordVerifier,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
    private readonly limiter: AdminActivationLimiter,
    private readonly limits: AdminLimitsRepository,
    @Inject(ADMIN_LIMITER_KEY) private readonly limiterKey: AdminLimiterKey,
    // Bound only when the phone verification is REQUIRED; DISABLED_TEST has no OTP step and therefore no provider.
    @Optional() @Inject(ACTIVATION_OTP_PROVIDER) private readonly otpProvider: ActivationOtpProvider | undefined,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Inject(ADMIN_ACTIVATION_CONFIG) config: AdminActivationConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
    this.#providerTimeoutMs = config.providerTimeoutMs;
    this.#promoteGraceMs = config.promoteGraceMs;
    this.#limits = config.limits;
    this.#phoneMode = config.phoneVerificationMode;
    this.#asyncDelivery = config.otpMode === 'SMS';
    this.#otpTtlSeconds = config.limits.otpTtlSeconds;
    if (config.phoneVerificationMode === 'REQUIRED' && otpProvider === undefined) {
      // Startup refuses this first (AppModule); this keeps the service itself from existing without its provider.
      throw new TechnicalError('internal', 'Activation OTP provider is missing');
    }
  }

  // ===== POST /start (10.1) ==================================================================================

  async start(cookieToken: string | undefined, linkToken: string, meta: RequestMeta): Promise<Answer> {
    const tokenDigest = digestToken(linkToken);
    const cookieDigest = cookieToken === undefined ? undefined : digestToken(cookieToken);

    // TX-P: read only, no lock. It may answer ONLY the monotonic fact "this cookie's attempt is COMPLETED for this very
    // invitation", and only while the cookie is still valid by the database clock of the same statement.
    const early = await this.transactions.withTransaction(async (context) => {
      const hint = await this.repo.peekInvitationByTokenDigest(context, tokenDigest);
      const snapshot = cookieDigest === undefined ? undefined : await this.repo.readSnapshot(context, cookieDigest);
      return { hint, snapshot };
    });
    const candidate = early.snapshot;
    if (
      candidate !== undefined &&
      early.hint !== undefined &&
      candidate.attempt.invitationId === early.hint.invitationId &&
      candidate.nowMs < candidate.attempt.expiresAtMs &&
      candidate.attempt.status === 'COMPLETED'
    ) {
      return this.#completedAnswer(candidate);
    }

    return this.#run<Answer>(async (context) => {
      const linkBucket = this.limiter.linkBucket(meta.ip);
      const [bucket] = await this.limits.lockBuckets(context, [linkBucket], this.#limits.linkFailureWindowSeconds);
      if (bucket === undefined) {
        throw new TechnicalError('internal', 'Bucket is missing');
      }
      if (bucket.lockedRemainingSeconds > 0) {
        return thenThrow(new AdminAuthRateLimitError(bucket.lockedRemainingSeconds));
      }
      const failLink = async (): Promise<Outcome<never>> => {
        await this.limits.recordFailure(context, {
          bucketKey: linkBucket.bucketKey,
          limit: this.#limits.linkFailureLimit,
          lockSeconds: this.#limits.linkFailureLockSeconds,
        });
        return thenThrow(linkInvalid());
      };

      // The token digest is immutable on its invitation, so this hint only chooses WHICH locks to take; a token that
      // matches nothing is a counted failure with no phone lock at all. Every condition is re-read under the locks.
      const hint = await this.repo.peekInvitationByTokenDigest(context, tokenDigest);
      if (hint === undefined) {
        return failLink();
      }
      await lockPhone(context, this.limiterKey, hint.phoneNormalized);
      const invitation = await this.invitations.lock(context, hint.invitationId);
      if (invitation === undefined) {
        return failLink();
      }
      // The cookie's attempt only counts when it belongs to THIS invitation (another invitation's cookie is ignored).
      const cookieAttemptId = candidate?.attempt.invitationId === hint.invitationId ? candidate.attempt.attemptId : undefined;
      const attempts = await this.repo.lockAttempts(context, { invitationId: invitation.invitationId, cookieAttemptId });
      // L9b before `T`: the live challenge of every live attempt is locked HERE, because a late delivery outcome (txn2 of
      // otp/request) holds it without the attempt lock and any wait for it after `T` would act on a stale clock.
      const challenges = await this.#lockLiveChallenges(context, attempts);
      const nowMs = await freshClockMs(context);

      const cookieAttempt = attempts.find((attempt) => attempt.attemptId === cookieAttemptId);
      const cookieValid = cookieAttempt !== undefined && nowMs < cookieAttempt.expiresAtMs;
      if (cookieValid && cookieAttempt.status === 'COMPLETED') {
        // Raced with a complete that committed after TX-P: answer the replay, write nothing, keep no bucket row.
        throw new ReplayAnswer(await this.#completedAnswerLocked(context, cookieAttempt));
      }
      if (invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        return failLink();
      }
      if (await this.#phoneTaken(context, invitation.phoneNormalized)) {
        return this.#phoneConflict(context, meta, invitation, attempts, challenges, nowMs);
      }

      const live = attempts.filter(isLive);
      if (cookieValid && isLive(cookieAttempt) && this.#modeMatches(cookieAttempt) && this.#resumable(cookieAttempt, nowMs)) {
        const newest = await this.repo.peekNewestChallenge(context, cookieAttempt.attemptId);
        const view: ViewInput = { attempt: cookieAttempt, newestChallenge: newest, invitation, nowMs };
        throw new ReplayAnswer({ status: 200, body: this.#stateEnvelope(view, this.#csrfOf(cookieAttempt)) } satisfies Answer);
      }
      await this.#supersede(context, meta, live, challenges, nowMs);
      const created = await this.#newAttempt(context, meta, invitation, nowMs, ACTIVATION_AUDIT_ACTIONS.attemptStarted);
      return value(created);
    });
  }

  // ===== POST /restart (10.1A) ===============================================================================

  async restart(cookieToken: string | undefined, csrfHeader: unknown, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    if (snapshot.attempt.status === 'COMPLETED' || (snapshot.attempt.status === 'INVALIDATED' && snapshot.attempt.invalidatedReason !== 'ATTEMPTS_EXHAUSTED')) {
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;

    return this.#run<Answer>(async (context) => {
      const phone = await this.repo.peekInvitationPhone(context, invitationId);
      if (phone === undefined) {
        throw sessionInvalid();
      }
      await lockPhone(context, this.limiterKey, phone);
      const invitation = await this.invitations.lock(context, invitationId);
      const attempts = await this.repo.lockAttempts(context, { invitationId, cookieAttemptId: attemptId });
      const challenges = await this.#lockLiveChallenges(context, attempts); // L9b before `T` (see start)
      const nowMs = await freshClockMs(context);
      const own = attempts.find((attempt) => attempt.attemptId === attemptId);
      if (own === undefined || nowMs >= own.expiresAtMs) {
        throw sessionInvalid();
      }
      const allowed = isLive(own) || (own.status === 'INVALIDATED' && own.invalidatedReason === 'ATTEMPTS_EXHAUSTED');
      if (!allowed) {
        throw this.#stepInvalid(await this.#lockedView(context, own, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      if (await this.#phoneTaken(context, invitation.phoneNormalized)) {
        return this.#phoneConflict(context, meta, invitation, attempts, challenges, nowMs);
      }
      await this.#supersede(context, meta, attempts.filter(isLive), challenges, nowMs);
      return value(await this.#newAttempt(context, meta, invitation, nowMs, ACTIVATION_AUDIT_ACTIONS.attemptRestarted));
    });
  }

  // ===== GET /state (6.3, 10.7) ==============================================================================

  async state(cookieToken: string | undefined): Promise<JsonObject> {
    if (cookieToken === undefined) {
      throw sessionInvalid();
    }
    const snapshot = await this.transactions.withTransaction((context) => this.repo.readSnapshot(context, digestToken(cookieToken)));
    if (snapshot === undefined || snapshot.nowMs >= snapshot.attempt.expiresAtMs) {
      throw sessionInvalid();
    }
    if (isLive(snapshot.attempt) && !this.#modeMatches(snapshot.attempt)) {
      throw sessionInvalid();
    }
    if (snapshot.attempt.status === 'COMPLETED') {
      return this.#completedAnswer(snapshot).body;
    }
    return this.#stateEnvelope(this.#viewOf(snapshot), this.#csrfOf(snapshot.attempt));
  }

  // ===== POST /otp/request (10.2, 13) ========================================================================

  async requestOtp(cookieToken: string | undefined, csrfHeader: unknown, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    // DISABLED_TEST has no OTP step: nothing is requested, delivered or stored, and the answer is the safe current state.
    if (snapshot.attempt.phoneVerificationMode === 'DISABLED_TEST' || snapshot.attempt.status !== 'STARTED') {
      // Past STARTED, or terminal: both only move forward, so the read-only answer is exact.
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;
    const otp = generateOtp();

    // txn1: the challenge is written and committed BEFORE the provider is called.
    const created = await this.#run<{ challengeId: string; phone: string; resendAtMs: number }>(async (context) => {
      const sendBucket = this.limiter.otpSendBucket(invitationId);
      const [bucket] = await this.limits.lockBuckets(context, [sendBucket], this.#limits.otpSendWindowSeconds);
      if (bucket === undefined) {
        throw new TechnicalError('internal', 'Bucket is missing');
      }
      const phone = await this.repo.peekInvitationPhone(context, invitationId);
      if (phone === undefined) {
        throw sessionInvalid();
      }
      await lockPhone(context, this.limiterKey, phone);
      const invitation = await this.invitations.lock(context, invitationId);
      const attempt = await this.repo.lockAttempt(context, attemptId);
      const newest = attempt === undefined ? undefined : await this.repo.lockNewestChallenge(context, attemptId);
      const nowMs = await freshClockMs(context);
      if (attempt === undefined || nowMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      if (attempt.status !== 'STARTED') {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      if (await this.#phoneTaken(context, invitation.phoneNormalized)) {
        // The live challenge is the newest one, already locked above (L9b) before `T`.
        const held = newest !== undefined && (newest.status === 'PENDING_DELIVERY' || newest.status === 'PENDING') ? [newest] : [];
        return this.#phoneConflict(context, meta, invitation, [attempt], new Map(held.map((row) => [row.attemptId, row])), nowMs);
      }
      if (newest !== undefined && newest.status !== 'DELIVERY_FAILED' && newest.resendNotBeforeMs > nowMs) {
        throw new AppError('OTP_RATE_LIMITED');
      }
      if (bucket.lockedRemainingSeconds > 0) {
        throw new AppError('OTP_RATE_LIMITED');
      }
      if (newest !== undefined && (newest.status === 'PENDING_DELIVERY' || newest.status === 'PENDING')) {
        await this.repo.invalidateChallenge(context, { challengeId: newest.challengeId, atMs: nowMs });
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.attemptInvalidated,
          resourceType: RESOURCE_CHALLENGE,
          resourceId: newest.challengeId,
          metadata: { attempt_id: attempt.attemptId, to_state: 'INVALIDATED', reason: 'RESENT' },
        });
      }
      const challengeId = randomUUID();
      const digest = this.crypto.activationOtpDigest(challengeId, invitation.phoneNormalized, otp);
      const resendAtMs = nowMs + this.#limits.otpResendCooldownSeconds * 1000;
      await this.repo.insertChallenge(context, {
        challengeId,
        attemptId,
        phoneNormalized: invitation.phoneNormalized,
        otpDigest: digest.digest,
        digestKeyId: digest.keyId,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + this.#limits.otpTtlSeconds * 1000,
        resendNotBeforeMs: resendAtMs,
      });
      await this.limits.recordFailure(context, {
        bucketKey: sendBucket.bucketKey,
        limit: this.#limits.otpSendLimit,
        lockSeconds: this.#limits.otpSendWindowSeconds,
      });
      await this.#audit(context, meta, {
        action: ACTIVATION_AUDIT_ACTIONS.otpRequested,
        resourceType: RESOURCE_CHALLENGE,
        resourceId: challengeId,
        metadata: { attempt_id: attemptId, invitation_id: invitationId },
      });
      return value({ challengeId, phone: invitation.phoneNormalized, resendAtMs });
    });

    // Outside every transaction, at most once, with a hard timeout. Anything but a clear answer is UNKNOWN.
    const delivery = await this.#deliver(created.phone, otp, { challengeId: created.challengeId, ttlSeconds: this.#otpTtlSeconds });

    // txn2: only the challenge row (L9b). It is a subset of the lock order.
    return this.#run<Answer>(async (context) => {
      const challenge = await this.repo.lockChallenge(context, created.challengeId);
      const nowMs = await freshClockMs(context);
      if (challenge === undefined) {
        throw new TechnicalError('internal', 'Challenge is missing');
      }
      const resendAt = iso(created.resendAtMs);
      if (delivery.outcome === 'REJECTED') {
        const failed = await this.repo.failDelivery(context, { challengeId: challenge.challengeId, atMs: nowMs });
        await this.#audit(context, meta, {
          action: failed ? ACTIVATION_AUDIT_ACTIONS.otpDeliveryFailed : ACTIVATION_AUDIT_ACTIONS.anomaly,
          resourceType: RESOURCE_CHALLENGE,
          resourceId: challenge.challengeId,
          metadata: { attempt_id: challenge.attemptId, current_state: challenge.status },
        });
        return thenThrow(new TechnicalError('unavailable', 'OTP delivery was refused'));
      }
      // SMS gateway: QUEUED (and a timed-out hand-over, which may or may not have queued the job) leaves the challenge
      // PENDING_DELIVERY. The gateway's acknowledgement is the only thing that makes it verifiable; nothing is resent here.
      if (this.#asyncDelivery && (delivery.outcome === 'QUEUED' || delivery.outcome === 'UNKNOWN')) {
        if (delivery.outcome === 'UNKNOWN') {
          await this.#audit(context, meta, {
            action: ACTIVATION_AUDIT_ACTIONS.otpDeliveryUnknown,
            resourceType: RESOURCE_CHALLENGE,
            resourceId: challenge.challengeId,
            metadata: { attempt_id: challenge.attemptId },
          });
        }
        return value({ status: 202, body: { data: { resend_at: resendAt, delivery: 'SUBMITTED' } } });
      }
      const promoted = await this.repo.promoteChallenge(context, challenge.challengeId);
      if (!promoted) {
        // The challenge changed meanwhile (promoted by a verify, or replaced): never overwrite it.
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.anomaly,
          resourceType: RESOURCE_CHALLENGE,
          resourceId: challenge.challengeId,
          metadata: { attempt_id: challenge.attemptId, current_state: challenge.status },
        });
      } else if (delivery.outcome === 'UNKNOWN') {
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.otpDeliveryUnknown,
          resourceType: RESOURCE_CHALLENGE,
          resourceId: challenge.challengeId,
          metadata: { attempt_id: challenge.attemptId },
        });
      }
      const body: JsonObject = { data: { resend_at: resendAt, delivery: 'SUBMITTED' } };
      if (delivery.displayedCode !== undefined) {
        (body.data as JsonObject).displayed_code = delivery.displayedCode;
      }
      return value({ status: 202, body });
    });
  }

  // ===== POST /otp/verify (10.3) =============================================================================

  async verifyOtp(cookieToken: string | undefined, csrfHeader: unknown, code: string, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    if (snapshot.attempt.phoneVerificationMode === 'DISABLED_TEST' || snapshot.attempt.status !== 'STARTED') {
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;

    return this.#run<Answer>(async (context) => {
      const invitation = await this.reader.lockShared(context, invitationId);
      const attempt = await this.repo.lockAttempt(context, attemptId);
      const newest = attempt === undefined ? undefined : await this.repo.lockNewestChallenge(context, attemptId);
      const nowMs = await freshClockMs(context);
      if (attempt === undefined || nowMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      if (attempt.status !== 'STARTED') {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      const step = (currentChallenge: ChallengeRow | undefined): ActivationStateError =>
        this.#stepInvalid({ attempt, newestChallenge: currentChallenge, invitation, nowMs });

      if (newest === undefined) {
        throw step(undefined);
      }
      let challenge = newest;
      if (challenge.status === 'PENDING_DELIVERY') {
        // SMS gateway: a challenge whose SMS has not been reported is never promoted by waiting (the gateway does it).
        if (this.#asyncDelivery || nowMs < challenge.createdAtMs + this.#promoteGraceMs) {
          throw step(challenge);
        }
        // The delivery outcome never came back (txn2 lost): the SMS may well have been sent. Promote and compare.
        if (!(await this.repo.promoteChallenge(context, challenge.challengeId))) {
          throw new TechnicalError('internal', 'Challenge could not be promoted');
        }
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.otpDeliveryPromoted,
          resourceType: RESOURCE_CHALLENGE,
          resourceId: challenge.challengeId,
          metadata: { attempt_id: attemptId },
        });
        challenge = { ...challenge, status: 'PENDING' };
      }
      switch (challenge.status) {
        case 'LOCKED':
          throw new AppError('OTP_RATE_LIMITED');
        case 'DELIVERY_FAILED':
        case 'INVALIDATED':
          throw step(challenge);
        case 'PENDING':
          break;
        default:
          throw new TechnicalError('internal', 'Unexpected challenge state');
      }
      if (nowMs >= challenge.expiresAtMs) {
        throw new AppError('OTP_EXPIRED');
      }
      const matches = this.crypto.activationOtpMatches({
        keyId: challenge.digestKeyId,
        challengeId: challenge.challengeId,
        phoneNormalized: challenge.phoneNormalized,
        otp: code,
        stored: challenge.otpDigest,
      });
      if (!matches) {
        const wrong = await this.repo.recordWrongOtp(context, { challengeId: challenge.challengeId, atMs: nowMs, limit: OTP_WRONG_LIMIT });
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.otpWrong,
          outcome: 'DENIED',
          reasonCode: wrong.locked ? 'OTP_LOCKED' : 'OTP_INVALID',
          resourceType: RESOURCE_CHALLENGE,
          resourceId: challenge.challengeId,
          metadata: { attempt_id: attemptId, wrong_count: wrong.count },
        });
        return thenThrow(new AppError(wrong.locked ? 'OTP_RATE_LIMITED' : 'OTP_INVALID'));
      }
      await this.repo.verifyChallenge(context, { challengeId: challenge.challengeId, atMs: nowMs });
      await this.repo.markOtpVerified(context, { attemptId, atMs: nowMs });
      await this.#audit(context, meta, {
        action: ACTIVATION_AUDIT_ACTIONS.otpVerified,
        resourceType: RESOURCE_ATTEMPT,
        resourceId: attemptId,
        metadata: { challenge_id: challenge.challengeId, from_state: 'STARTED', to_state: 'OTP_VERIFIED' },
      });
      return value({ status: 200, body: { data: { state: 'OTP_VERIFIED' } } });
    });
  }

  // ===== POST /password (10.4) ===============================================================================

  async setPassword(cookieToken: string | undefined, csrfHeader: unknown, password: string, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    // The mode of the process and of the attempt both decide the step the password may come from: REQUIRED goes through the
    // OTP (OTP_VERIFIED), DISABLED_TEST has none (STARTED). #precheck already refused a live attempt of another mode.
    const direct = snapshot.attempt.phoneVerificationMode === 'DISABLED_TEST';
    const from = direct ? 'STARTED' : 'OTP_VERIFIED';
    const windowMs = this.#limits.passwordDeadlineSeconds * 1000;
    if (snapshot.attempt.status !== from) {
      // 10.4: the gate runs before the (expensive) hashing; a failed gate costs no hash.
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    const deadline = passwordDeadlineMs(snapshot.attempt, windowMs);
    if (deadline === null || snapshot.nowMs > deadline) {
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    if (direct) {
      // No OTP step to have noticed it: the invitation and the phone are checked here, still before the hash.
      if (snapshot.invitation.status !== 'PENDING' || snapshot.nowMs >= snapshot.invitation.expiresAtMs) {
        throw linkInvalid();
      }
      if (await this.#phoneTakenByInvitation(snapshot.attempt.invitationId)) {
        throw new AppError('ADMIN_PHONE_CONFLICT');
      }
    }
    const passwordHash = await this.passwords.hash(password);
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;

    return this.#run<Answer>(async (context) => {
      const invitation = await this.reader.lockShared(context, invitationId);
      const attempt = await this.repo.lockAttempt(context, attemptId);
      const nowMs = await freshClockMs(context);
      if (attempt === undefined || nowMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      // Process mode and attempt mode again under the lock: a mismatch is never continued, in either direction.
      if (!this.#modeMatches(attempt) || attempt.phoneVerificationMode !== snapshot.attempt.phoneVerificationMode) {
        throw sessionInvalid();
      }
      if (attempt.status !== from) {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      const lockedDeadline = passwordDeadlineMs(attempt, windowMs);
      if (lockedDeadline === null || nowMs > lockedDeadline) {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      if (direct && (await this.#phoneTaken(context, invitation.phoneNormalized))) {
        // Nothing is written; the invitation is closed by the next start / restart / complete, which hold the right locks.
        throw new AppError('ADMIN_PHONE_CONFLICT');
      }
      await this.repo.markPasswordSet(context, { attemptId, passwordHash, atMs: nowMs, from });
      await this.#audit(context, meta, {
        action: ACTIVATION_AUDIT_ACTIONS.passwordSet,
        resourceType: RESOURCE_ATTEMPT,
        resourceId: attemptId,
        metadata: { from_state: from, to_state: 'PASSWORD_SET' },
      });
      return value({ status: 200, body: { data: { state: 'PASSWORD_SET' } } });
    });
  }

  // ===== POST /totp/enrollment (10.5) ========================================================================

  async issueTotp(cookieToken: string | undefined, csrfHeader: unknown, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    if (snapshot.attempt.status === 'COMPLETED' || snapshot.attempt.status === 'INVALIDATED') {
      throw this.#stepInvalid(this.#viewOf(snapshot));
    }
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;
    const fresh = this.crypto.newTotpSecret();

    return this.#run<Answer>(async (context) => {
      const invitation = await this.reader.lockShared(context, invitationId);
      const attempt = await this.repo.lockAttempt(context, attemptId);
      const nowMs = await freshClockMs(context);
      if (attempt === undefined || nowMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      if (attempt.status !== 'PASSWORD_SET' && attempt.status !== 'TOTP_ISSUED') {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      const binding = { userId: attempt.userId, factorId: attempt.factorId, factorVersion: 1 };
      let secret: Buffer;
      if (attempt.status === 'PASSWORD_SET') {
        secret = fresh;
        const sealed = this.crypto.sealTotpSecret(binding, secret);
        await this.repo.markTotpIssued(context, { attemptId, keyId: sealed.keyId, envelope: sealed.envelope, atMs: nowMs });
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.totpIssued,
          resourceType: RESOURCE_ATTEMPT,
          resourceId: attemptId,
          metadata: { from_state: 'PASSWORD_SET', to_state: 'TOTP_ISSUED' },
        });
      } else {
        // Replay: the SAME secret again; nothing is written, counted or audited.
        if (attempt.totpKeyId === null || attempt.totpEnvelope === null) {
          throw new TechnicalError('internal', 'Issued secret is missing');
        }
        secret = this.crypto.openTotpSecret(attempt.totpKeyId, binding, attempt.totpEnvelope);
      }
      const secretBase32 = base32Encode(secret);
      return value({
        status: 200,
        body: {
          data: {
            state: 'TOTP_ISSUED',
            otpauth_uri: buildOtpauthUri({ issuer: TOTP_ISSUER, label: invitation.phoneNormalized, secretBase32 }),
            secret: secretBase32,
          },
        },
      });
    });
  }

  // ===== POST /complete (10.6) ===============================================================================

  async complete(cookieToken: string | undefined, csrfHeader: unknown, code: string, meta: RequestMeta): Promise<Answer> {
    const snapshot = await this.#precheck(cookieToken, csrfHeader);
    // TX-P: terminal facts never change back, and the cookie was just checked against the database clock.
    if (snapshot.attempt.status === 'COMPLETED') {
      return this.#completedAnswer(snapshot);
    }
    if (snapshot.attempt.status === 'INVALIDATED') {
      throw snapshot.attempt.invalidatedReason === 'PHONE_CONFLICT'
        ? new AppError('ADMIN_PHONE_CONFLICT')
        : this.#stepInvalid(this.#viewOf(snapshot));
    }
    const attemptId = snapshot.attempt.attemptId;
    const invitationId = snapshot.attempt.invitationId;

    return this.#run<Answer>(async (context) => {
      const totpBucket = this.limiter.totpBucket(invitationId);
      const [bucket] = await this.limits.lockBuckets(context, [totpBucket], this.#limits.totpFailureWindowSeconds);
      if (bucket === undefined) {
        throw new TechnicalError('internal', 'Bucket is missing');
      }
      const phone = await this.repo.peekInvitationPhone(context, invitationId);
      if (phone === undefined) {
        throw sessionInvalid();
      }
      await lockPhone(context, this.limiterKey, phone);
      const invitation = await this.invitations.lock(context, invitationId);
      const attempt = await this.repo.lockAttempt(context, attemptId);
      const challenges = await this.#lockLiveChallenges(context, attempt === undefined ? [] : [attempt]); // L9b before `T`
      const nowMs = await freshClockMs(context);

      // The gates, in order. A refusal here ROLLS BACK: nothing is counted and the secret is not opened.
      if (attempt === undefined || nowMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      if (attempt.status === 'COMPLETED') {
        throw new ReplayAnswer(await this.#completedAnswerLocked(context, attempt));
      }
      if (isLive(attempt) && !this.#modeMatches(attempt)) {
        throw sessionInvalid();
      }
      if (attempt.status === 'INVALIDATED') {
        throw attempt.invalidatedReason === 'PHONE_CONFLICT'
          ? new AppError('ADMIN_PHONE_CONFLICT')
          : this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (attempt.status !== 'TOTP_ISSUED') {
        throw this.#stepInvalid(await this.#lockedView(context, attempt, invitation, nowMs));
      }
      if (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs || invitation.generationId !== attempt.generationId) {
        throw linkInvalid();
      }
      if (bucket.lockedRemainingSeconds > 0) {
        // A lock in force is reported, the (empty) transaction commits and nothing is counted.
        return thenThrow(new AdminAuthRateLimitError(bucket.lockedRemainingSeconds));
      }
      if (await this.#phoneTaken(context, invitation.phoneNormalized)) {
        return this.#phoneConflict(context, meta, invitation, [attempt], challenges, nowMs);
      }
      // REQUIRED has an OTP fact; DISABLED_TEST must not (nothing invents one).
      const otpFactOk = attempt.phoneVerificationMode === 'DISABLED_TEST' ? attempt.otpVerifiedAtMs === null : attempt.otpVerifiedAtMs !== null;
      if (attempt.totpKeyId === null || attempt.totpEnvelope === null || attempt.passwordHash === null || !otpFactOk) {
        throw new TechnicalError('internal', 'Attempt is incomplete');
      }

      // The gates are passed: only now is the secret opened. No factor exists yet, so there is no replay step.
      const secret = this.crypto.openTotpSecret(
        attempt.totpKeyId,
        { userId: attempt.userId, factorId: attempt.factorId, factorVersion: 1 },
        attempt.totpEnvelope,
      );
      const step = matchTotp(secret, code, nowMs / 1000, null);
      if (step === undefined) {
        const wrong = await this.repo.recordWrongTotp(context, { attemptId, atMs: nowMs, limit: TOTP_WRONG_LIMIT });
        const after = await this.limits.recordFailure(context, {
          bucketKey: totpBucket.bucketKey,
          limit: TOTP_FAILURE_LIMIT,
          lockSeconds: this.#limits.totpFailureLockSeconds,
        });
        await this.#audit(context, meta, {
          action: ACTIVATION_AUDIT_ACTIONS.totpWrong,
          outcome: 'DENIED',
          reasonCode: wrong.exhausted ? 'ATTEMPTS_EXHAUSTED' : 'TOTP_INVALID',
          resourceType: RESOURCE_ATTEMPT,
          resourceId: attemptId,
          metadata: { wrong_count: wrong.count, exhausted: wrong.exhausted },
        });
        return thenThrow(
          after.lockedRemainingSeconds > 0 ? new AdminAuthRateLimitError(after.lockedRemainingSeconds) : new AppError('ADMIN_TOTP_INVALID'),
        );
      }

      // Atomic activation: the fixed write order of 10.6. Any failure before COMMIT leaves no account.
      const inserted = await this.identities.insertProvisioned(context, {
        userId: attempt.userId,
        phoneNormalized: invitation.phoneNormalized,
        passwordHash: attempt.passwordHash,
      });
      // The INSERT above may have WAITED on users.phone_normalized behind a competing registration, so `T` is stale: the
      // clock is read again BEFORE the outcome is interpreted, and both expiries are re-checked first. An expired
      // attempt/invitation is refused whether the registration then rolled back or committed (no PHONE_CONFLICT closing,
      // no invalidation, no audit); the refusal rolls back every row made so far.
      const doneMs = await freshClockMs(context);
      if (doneMs >= attempt.expiresAtMs) {
        throw sessionInvalid();
      }
      if (doneMs >= invitation.expiresAtMs) {
        throw linkInvalid();
      }
      if (!inserted) {
        // Lost a race with /auth/register on the unique phone while still valid: the same closing path, the code is NOT counted.
        return this.#phoneConflict(context, meta, invitation, [attempt], challenges, doneMs);
      }
      await this.repo.insertMembership(context, { userId: attempt.userId, atMs: doneMs });
      await this.repo.insertProfile(context, {
        userId: attempt.userId,
        invitationId,
        phoneVerifiedAtMs: attempt.otpVerifiedAtMs,
        atMs: doneMs,
      });
      await this.repo.copyPermissions(context, { userId: attempt.userId, invitationId });
      await this.repo.insertActiveFactor(context, {
        userId: attempt.userId,
        factorId: attempt.factorId,
        keyId: attempt.totpKeyId,
        envelope: attempt.totpEnvelope,
        step,
        atMs: doneMs,
      });
      const accepted = await this.invitations.transition(context, invitationId, invitation.version, {
        to: 'ACCEPTED',
        acceptedUserId: attempt.userId,
      });
      if (accepted === undefined) {
        throw new TechnicalError('internal', 'Locked invitation could not be accepted');
      }
      await this.repo.completeAttempt(context, { attemptId, atMs: doneMs });
      await this.audit.append(context, {
        requestId: meta.requestId,
        actorType: ACTOR_USER,
        actorId: attempt.userId,
        action: ACTIVATION_AUDIT_ACTIONS.completed,
        resourceType: RESOURCE_INVITATION,
        resourceId: invitationId,
        resourceVersion: accepted,
        outcome: 'SUCCESS',
        metadata: { attempt_id: attemptId, from_state: 'TOTP_ISSUED', to_state: 'COMPLETED', accepted_step: step },
      });
      return value({ status: 200, body: { data: { state: 'COMPLETED', next: 'LOGIN' } } });
    });
  }

  // ===== shared steps ========================================================================================

  /**
   * One business transaction: lock_timeout first, then the caller's lock sequence. A returned `throw` outcome COMMITS and
   * then throws (the counters and the PHONE_CONFLICT closure); a thrown error rolls back. A ReplayAnswer rolls back and
   * answers. A lock_timeout (55P03) is the generic 503.
   */
  async #run<V>(work: (context: TransactionContext) => Promise<Outcome<V>>): Promise<V> {
    let outcome: Outcome<V>;
    try {
      outcome = await this.transactions.withTransaction(async (context) => {
        await setBusinessLockTimeout(context, this.#lockTimeoutMs);
        return work(context);
      });
    } catch (error) {
      if (error instanceof ReplayAnswer) {
        return error.answer as V;
      }
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '55P03') {
        throw new TechnicalError('unavailable', 'Lock wait timed out');
      }
      throw error;
    }
    if (outcome.kind === 'throw') {
      throw outcome.error;
    }
    return outcome.value;
  }

  /**
   * R0 for every cookie route: the attempt of the cookie by its digest, in one read-only statement together with the
   * database clock. Cookie validity (section 6.1.1) is decided with THAT clock: missing, unknown or `T >= expires_at`
   * is a 401 in every state, and only then is the CSRF token recomputed from the IMMUTABLE columns (403).
   */
  async #precheck(cookieToken: string | undefined, csrfHeader: unknown): Promise<AttemptSnapshot> {
    if (cookieToken === undefined) {
      throw sessionInvalid();
    }
    const snapshot = await this.transactions.withTransaction((context) => this.repo.readSnapshot(context, digestToken(cookieToken)));
    if (snapshot === undefined || snapshot.nowMs >= snapshot.attempt.expiresAtMs) {
      throw sessionInvalid();
    }
    const matches = this.crypto.csrfMatches(
      { type: 'ACTIVATION', credentialId: snapshot.attempt.attemptId, nonce: snapshot.attempt.csrfNonce, keyId: snapshot.attempt.csrfKeyId },
      csrfHeader,
    );
    if (!matches) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    // A live attempt made under the other phone verification mode is not continued (the person opens the link again).
    if (isLive(snapshot.attempt) && !this.#modeMatches(snapshot.attempt)) {
      throw sessionInvalid();
    }
    return snapshot;
  }

  #csrfOf(attempt: AttemptRow): string {
    return this.crypto.csrfToken({ type: 'ACTIVATION', credentialId: attempt.attemptId, nonce: attempt.csrfNonce, keyId: attempt.csrfKeyId });
  }

  #viewOf(snapshot: AttemptSnapshot): ViewInput {
    return { attempt: snapshot.attempt, newestChallenge: snapshot.newestChallenge, invitation: snapshot.invitation, nowMs: snapshot.nowMs };
  }

  async #lockedView(
    context: TransactionContext,
    attempt: AttemptRow,
    invitation: { readonly status: string; readonly expiresAtMs: number } | undefined,
    nowMs: number,
  ): Promise<ViewInput> {
    return {
      attempt,
      newestChallenge: await this.repo.peekNewestChallenge(context, attempt.attemptId),
      invitation: invitation ?? { status: 'UNKNOWN', expiresAtMs: 0 },
      nowMs,
    };
  }

  #stepInvalid(view: ViewInput): ActivationStateError {
    return new ActivationStateError(stateBody(view, undefined, this.#limits.passwordDeadlineSeconds * 1000) as ActivationErrorDetails);
  }

  /** 200 body of a state read, enveloped like every other success. */
  #stateEnvelope(view: ViewInput, csrf: string): JsonObject {
    return { data: stateBody(view, csrf, this.#limits.passwordDeadlineSeconds * 1000) as JsonObject };
  }

  #completedAnswer(snapshot: AttemptSnapshot): Answer {
    const { attempt, invitation } = snapshot;
    if (invitation.status !== 'ACCEPTED' || invitation.acceptedUserId !== attempt.userId) {
      // Impossible: COMPLETED and ACCEPTED are written in one transaction (1A trigger). Never report COMPLETED then.
      throw new TechnicalError('internal', 'Completed attempt without an accepted invitation');
    }
    return { status: 200, body: { data: { state: 'COMPLETED', next: 'LOGIN' } } };
  }

  async #completedAnswerLocked(context: TransactionContext, attempt: AttemptRow): Promise<Answer> {
    const snapshot = await this.repo.readSnapshotById(context, attempt.attemptId);
    if (snapshot === undefined) {
      throw new TechnicalError('internal', 'Attempt is missing');
    }
    return this.#completedAnswer(snapshot);
  }

  #resumable(attempt: AttemptRow, nowMs: number): boolean {
    if (!isLive(attempt) || nowMs >= attempt.expiresAtMs) {
      return false;
    }
    const windowMs = this.#limits.passwordDeadlineSeconds * 1000;
    if (attempt.status === 'OTP_VERIFIED') {
      return attempt.otpVerifiedAtMs !== null && nowMs <= attempt.otpVerifiedAtMs + windowMs;
    }
    if (attempt.status === 'STARTED' && attempt.phoneVerificationMode === 'DISABLED_TEST') {
      // STARTED is the password step here: it resumes only while that window is open (like OTP_VERIFIED).
      const deadline = passwordDeadlineMs(attempt, windowMs);
      return deadline !== null && nowMs <= deadline;
    }
    return true;
  }

  /** A live attempt is only continued by a process of the SAME phone verification mode (never bypassed, never stranded). */
  #modeMatches(attempt: AttemptRow): boolean {
    return attempt.phoneVerificationMode === this.#phoneMode;
  }

  /** Read-only: is the phone of this invitation already an account? (a hint before the expensive hash) */
  async #phoneTakenByInvitation(invitationId: string): Promise<boolean> {
    return this.transactions.withTransaction(async (context) => {
      const phone = await this.repo.peekInvitationPhone(context, invitationId);
      return phone !== undefined && (await this.#phoneTaken(context, phone));
    });
  }

  async #phoneTaken(context: TransactionContext, phoneNormalized: string): Promise<boolean> {
    return (await this.identities.findByPhone(context, phoneNormalized)) !== undefined;
  }

  /** Live attempts of the invitation -> INVALIDATED(SUPERSEDED), each with its live challenge (L9b after L9a). */
  /**
   * L9b for every LIVE attempt, in `attempt_id` order, taken before `T` is read. The mutation helpers below take NO lock:
   * they are handed the rows locked here, so no wait can happen between `T` and the writes that use it.
   */
  async #lockLiveChallenges(context: TransactionContext, attempts: readonly AttemptRow[]): Promise<ReadonlyMap<string, ChallengeRow>> {
    const held = new Map<string, ChallengeRow>();
    for (const attempt of attempts.filter(isLive)) {
      const challenge = await this.repo.lockLiveChallenge(context, attempt.attemptId);
      if (challenge !== undefined) {
        held.set(attempt.attemptId, challenge);
      }
    }
    return held;
  }

  async #supersede(
    context: TransactionContext,
    meta: RequestMeta,
    attempts: readonly AttemptRow[],
    challenges: ReadonlyMap<string, ChallengeRow>,
    nowMs: number,
  ): Promise<void> {
    for (const attempt of attempts) {
      const challenge = challenges.get(attempt.attemptId);
      if (challenge !== undefined) {
        await this.repo.invalidateChallenge(context, { challengeId: challenge.challengeId, atMs: nowMs });
      }
      await this.repo.invalidateAttempt(context, { attemptId: attempt.attemptId, reason: 'SUPERSEDED', atMs: nowMs });
      await this.#audit(context, meta, {
        action: ACTIVATION_AUDIT_ACTIONS.attemptSuperseded,
        resourceType: RESOURCE_ATTEMPT,
        resourceId: attempt.attemptId,
        metadata: { from_state: attempt.status, to_state: 'INVALIDATED', reason: 'SUPERSEDED' },
      });
    }
  }

  /** A fresh STARTED attempt (L10) with a new cookie secret, CSRF nonce and pre-allocated user / factor ids. */
  async #newAttempt(
    context: TransactionContext,
    meta: RequestMeta,
    invitation: InvitationRow | InvitationDetail,
    nowMs: number,
    action: string,
  ): Promise<Answer> {
    const cookieToken = this.crypto.randomBytes(32).toString('base64url');
    const csrf = this.crypto.newCsrf();
    const attemptId = randomUUID();
    const expiresAtMs = Math.min(nowMs + this.#limits.attemptTtlSeconds * 1000, invitation.expiresAtMs);
    await this.repo.insertAttempt(context, {
      attemptId,
      invitationId: invitation.invitationId,
      generationId: invitation.generationId,
      userId: randomUUID(),
      factorId: randomUUID(),
      tokenDigest: digestToken(cookieToken),
      csrfNonce: csrf.nonce,
      csrfKeyId: csrf.keyId,
      phoneVerificationMode: this.#phoneMode,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    await this.#audit(context, meta, {
      action,
      resourceType: RESOURCE_ATTEMPT,
      resourceId: attemptId,
      metadata: { invitation_id: invitation.invitationId, to_state: 'STARTED' },
    });
    const csrfToken = this.crypto.csrfToken({ type: 'ACTIVATION', credentialId: attemptId, nonce: csrf.nonce, keyId: csrf.keyId });
    return {
      status: 201,
      body: { data: { state: 'STARTED', csrf_token: csrfToken, expires_at: iso(expiresAtMs), phone_verification_mode: this.#phoneMode } },
      cookie: { token: cookieToken, maxAgeSeconds: Math.max(1, Math.floor((expiresAtMs - nowMs) / 1000)) },
    };
  }

  /**
   * Section 14: the invitation becomes PHONE_CONFLICT, the live attempt(s) INVALIDATED(PHONE_CONFLICT) and their live
   * challenge INVALIDATED, with one audit - in ONE transaction that COMMITS, and only then 409. The invitation lock is
   * already held in X (taken right after L3), so nothing is upgraded.
   */
  async #phoneConflict(
    context: TransactionContext,
    meta: RequestMeta,
    invitation: InvitationRow,
    attempts: readonly AttemptRow[],
    challenges: ReadonlyMap<string, ChallengeRow>,
    nowMs: number,
  ): Promise<Outcome<never>> {
    const version = await this.invitations.transition(context, invitation.invitationId, invitation.version, { to: 'PHONE_CONFLICT' });
    if (version === undefined) {
      throw new TechnicalError('internal', 'Locked invitation could not be closed');
    }
    for (const attempt of attempts.filter(isLive)) {
      const challenge = challenges.get(attempt.attemptId);
      if (challenge !== undefined) {
        await this.repo.invalidateChallenge(context, { challengeId: challenge.challengeId, atMs: nowMs });
      }
      await this.repo.invalidateAttempt(context, { attemptId: attempt.attemptId, reason: 'PHONE_CONFLICT', atMs: nowMs });
    }
    await this.#audit(context, meta, {
      action: ACTIVATION_AUDIT_ACTIONS.phoneConflict,
      outcome: 'DENIED',
      reasonCode: 'PHONE_CONFLICT',
      resourceType: RESOURCE_INVITATION,
      resourceId: invitation.invitationId,
      resourceVersion: version,
      metadata: { from_state: 'PENDING', to_state: 'PHONE_CONFLICT' },
    });
    return thenThrow(new AppError('ADMIN_PHONE_CONFLICT'));
  }

  /** The provider call: hard timeout, no retry, any exception or unreadable answer is UNKNOWN. */
  async #deliver(phoneNormalized: string, otp: string, context: ActivationOtpContext): Promise<ActivationOtpDelivery> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ActivationOtpDelivery>((resolve) => {
      timer = setTimeout(() => resolve({ outcome: 'UNKNOWN' }), this.#providerTimeoutMs);
    });
    try {
      if (this.otpProvider === undefined) {
        throw new TechnicalError('internal', 'Activation OTP provider is missing');
      }
      const answer = await Promise.race([this.otpProvider.send(phoneNormalized, otp, context), timeout]);
      const outcome = answer.outcome;
      if (outcome !== 'ACCEPTED' && outcome !== 'REJECTED' && outcome !== 'UNKNOWN' && outcome !== 'QUEUED') {
        return { outcome: 'UNKNOWN' };
      }
      return answer.displayedCode === undefined ? { outcome } : { outcome, displayedCode: answer.displayedCode };
    } catch {
      return { outcome: 'UNKNOWN' };
    } finally {
      clearTimeout(timer);
    }
  }

  async #audit(
    context: TransactionContext,
    meta: RequestMeta,
    entry: {
      action: string;
      resourceType: string;
      resourceId: string;
      resourceVersion?: number;
      outcome?: 'SUCCESS' | 'DENIED';
      reasonCode?: string;
      metadata: JsonObject;
    },
  ): Promise<void> {
    await this.audit.append(context, {
      requestId: meta.requestId,
      actorType: ACTOR_ANONYMOUS,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ...(entry.resourceVersion === undefined ? {} : { resourceVersion: entry.resourceVersion }),
      outcome: entry.outcome ?? 'SUCCESS',
      ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
      metadata: entry.metadata,
    });
  }
}

