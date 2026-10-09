import { Injectable } from '@nestjs/common';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../auth/admin-password-verifier';
import { LoginInput } from '../auth/auth-validation';
import { digestToken } from '../auth/tokens';
import { AuditWriter } from '../audit/audit-writer';
import { AdminAuthRateLimitError, AppError } from '../common/app-errors';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_PREAUTH_TTL_SECONDS,
  FAILURE_LOCK_SECONDS,
  PASSWORD_FAILURE_LIMIT,
  PASSWORD_FAILURE_WINDOW_SECONDS,
} from './admin-auth-constants';
import { AdminChallengeRepository } from './admin-challenge-repository';
import { AdminCrypto } from './admin-crypto';
import { AdminFactorRepository } from './admin-factor-repository';
import { AdminLimiter, longestLock } from './admin-limiter';
import { AdminLimitsRepository, BucketState } from './admin-limits-repository';
import { AdminMembershipRepository } from './admin-membership-repository';

export interface PreauthIssued {
  /** Plaintext cookie value: handed to the controller once, never stored or logged. */
  readonly preauthToken: string;
  readonly csrfToken: string;
  readonly nextStep: 'ENROLL_TOTP' | 'VERIFY_TOTP';
  readonly expiresAtMs: number;
}

type LoginOutcome =
  | { readonly kind: 'ok'; readonly issued: PreauthIssued }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'invalid'; readonly retryAfterSeconds: number }
  | { readonly kind: 'changed' };

/**
 * Step 1 of the administration login: phone + password -> a preauth step (cookie), never a session.
 *
 * Order: request quota per address (before any password work) -> read-only lock precheck (a locked phone or address
 * costs no hashing) -> Argon2id OUTSIDE any transaction (a dummy verification when there is no usable account, so the
 * time does not tell) -> one transaction that takes the phone and address bucket locks FIRST (ascending bucket_key),
 * re-checks them, records a failure or, for a correct password, re-checks the account and the membership under their
 * locks, supersedes older preauth steps and issues the new one with its audit row. Counters of a failed credential are
 * committed (the transaction returns an outcome; the refusal is thrown afterwards).
 *
 * Login does not read the TOTP failure bucket at all: the second-factor lock is enforced where the code is verified.
 */
@Injectable()
export class AdminLoginService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly limiter: AdminLimiter,
    private readonly limits: AdminLimitsRepository,
    private readonly identities: AdminIdentityParticipant,
    private readonly memberships: AdminMembershipRepository,
    private readonly factors: AdminFactorRepository,
    private readonly challenges: AdminChallengeRepository,
    private readonly verifier: AdminPasswordVerifier,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
  ) {}

  async login(input: LoginInput, meta: { ip: string; requestId: string }): Promise<PreauthIssued> {
    await this.limiter.reserveLoginRequest(meta.ip);

    const phoneBucket = this.limiter.phoneBucket(input.phoneNormalized);
    const ipBucket = this.limiter.loginIpBucket(meta.ip);
    const buckets = [phoneBucket, ipBucket];

    // Locked already? Refuse before spending any hashing work. Nothing is written, so a lock is never extended.
    const early = longestLock(
      await this.transactions.withTransaction((context) =>
        this.limits.peek(context, buckets.map((bucket) => bucket.bucketKey)),
      ),
    );
    if (early > 0) {
      throw new AdminAuthRateLimitError(early);
    }

    const snapshot = await this.transactions.withTransaction(async (context) => {
      const identity = await this.identities.findByPhone(context, input.phoneNormalized);
      const membership = identity === undefined ? undefined : await this.memberships.find(context, identity.userId);
      return { identity, membership };
    });
    const usable =
      snapshot.identity !== undefined &&
      snapshot.identity.status === 'ACTIVE' &&
      snapshot.membership !== undefined &&
      snapshot.membership.status === 'ACTIVE';
    let passwordOk = false;
    if (usable && snapshot.identity !== undefined) {
      passwordOk = await this.verifier.verify(snapshot.identity.passwordHash, input.password);
    } else {
      await this.verifier.verifyAgainstDummy(input.password);
    }

    const outcome = await this.transactions.withTransaction(async (context): Promise<LoginOutcome> => {
      const states = await this.limits.lockBuckets(context, buckets, PASSWORD_FAILURE_WINDOW_SECONDS);
      const locked = longestLock(states);
      if (locked > 0) {
        return { kind: 'limited', retryAfterSeconds: locked };
      }

      if (!passwordOk || snapshot.identity === undefined) {
        const after: BucketState[] = [];
        for (const bucket of buckets) {
          after.push(
            await this.limits.recordFailure(context, {
              bucketKey: bucket.bucketKey,
              limit: PASSWORD_FAILURE_LIMIT,
              lockSeconds: FAILURE_LOCK_SECONDS,
            }),
          );
        }
        return { kind: 'invalid', retryAfterSeconds: longestLock(after) };
      }

      // Correct password: re-check, under their locks, that the verified credentials are still the current ones.
      const user = await this.identities.lockById(context, snapshot.identity.userId);
      if (user === undefined || user.status !== 'ACTIVE' || user.passwordHash !== snapshot.identity.passwordHash) {
        return { kind: 'changed' };
      }
      const membership = await this.memberships.lock(context, user.userId);
      if (membership === undefined || membership.status !== 'ACTIVE') {
        return { kind: 'changed' };
      }
      let factor = await this.factors.lock(context, user.userId);
      await this.challenges.supersedeUnconsumed(context, user.userId);
      if (factor !== undefined && factor.state === 'PENDING') {
        // The pending generation belonged to a superseded step: it is replaced, never reused.
        await this.factors.deletePending(context, user.userId);
        factor = undefined;
      }

      const token = this.crypto.randomBytes(32).toString('base64url');
      const csrf = this.crypto.newCsrf();
      const binding = this.crypto.newPasswordBinding(user.userId, user.passwordHash);
      const created = await this.challenges.insert(context, {
        userId: user.userId,
        tokenDigest: digestToken(token),
        csrfNonce: csrf.nonce,
        csrfKeyId: csrf.keyId,
        passwordBinding: binding.binding,
        passwordKeyId: binding.keyId,
        membershipVersion: membership.version,
        factorId: factor?.factorId ?? null,
        factorVersion: factor?.version ?? null,
        deviceId: input.device.deviceId,
        ttlSeconds: ADMIN_PREAUTH_TTL_SECONDS,
      });
      const csrfToken = this.crypto.csrfToken({
        type: 'PREAUTH',
        credentialId: created.challengeId,
        nonce: csrf.nonce,
        keyId: csrf.keyId,
      });
      await this.audit.append(context, {
        requestId: meta.requestId,
        actorType: 'USER',
        actorId: user.userId,
        action: ADMIN_AUDIT_ACTIONS.loginPreauth,
        resourceType: 'admin_challenge',
        resourceId: created.challengeId,
        outcome: 'SUCCESS',
        metadata: {
          challenge_id: created.challengeId,
          membership_version: membership.version,
          ...(factor === undefined ? {} : { factor_id: factor.factorId, factor_version: factor.version }),
        },
      });
      return {
        kind: 'ok',
        issued: {
          preauthToken: token,
          csrfToken,
          nextStep: factor === undefined ? 'ENROLL_TOTP' : 'VERIFY_TOTP',
          expiresAtMs: created.expiresAtMs,
        },
      };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.issued;
      case 'limited':
        throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
      case 'invalid':
        // The failure that reached the threshold already locks the buckets and says so.
        if (outcome.retryAfterSeconds > 0) {
          throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
        }
        throw new AppError('INVALID_CREDENTIALS');
      case 'changed':
        throw new AppError('INVALID_CREDENTIALS');
    }
  }
}
