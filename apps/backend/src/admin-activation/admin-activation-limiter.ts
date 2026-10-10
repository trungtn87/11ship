import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { LIMIT_KINDS } from '../admin-auth/admin-auth-constants';
import { ipLimiterIdentity } from '../admin-auth/client-ip';
import { AdminLimitsRepository, BucketRef } from '../admin-auth/admin-limits-repository';
import { AdminAuthRateLimitError } from '../common/app-errors';
import { AdminAuthConfig, AdminLimiterKey } from '../config/admin-auth-config';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ACTIVATION_REQUEST_LIMIT, ACTIVATION_REQUEST_WINDOW_SECONDS } from './admin-activation-constants';

/**
 * Bucket identities and the ingress quota of the activation (contract sections 7 and 8). The limiter key and the
 * bucket table are the ones of the administration login; only the four activation kinds are new. A bucket identity is an
 * address or an invitation id keyed with the limiter key - NEVER a phone number.
 */
@Injectable()
export class AdminActivationLimiter {
  readonly #key: AdminLimiterKey;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly limits: AdminLimitsRepository,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#key = config.limiter.key;
  }

  linkBucket(ip: string): BucketRef {
    return { bucketKey: this.#key.bucketKey(LIMIT_KINDS.activationLinkIp, ipLimiterIdentity(ip)), kind: LIMIT_KINDS.activationLinkIp };
  }

  otpSendBucket(invitationId: string): BucketRef {
    return { bucketKey: this.#key.bucketKey(LIMIT_KINDS.activationOtpSend, invitationId), kind: LIMIT_KINDS.activationOtpSend };
  }

  totpBucket(invitationId: string): BucketRef {
    return { bucketKey: this.#key.bucketKey(LIMIT_KINDS.activationTotp, invitationId), kind: LIMIT_KINDS.activationTotp };
  }

  /**
   * R0: the ingress quota of EVERY activation POST, in its own transaction that COMMITS before any business transaction
   * starts. The slot is never given back (a replay, a 401 and a 409 all count): it is a request quota.
   */
  async reserveRequest(ip: string): Promise<void> {
    const bucketKey = this.#key.bucketKey(LIMIT_KINDS.activationRequestIp, ipLimiterIdentity(ip));
    const reservation = await this.transactions.withTransaction((context: TransactionContext) =>
      this.limits.reserveRequest(context, {
        bucketKey,
        kind: LIMIT_KINDS.activationRequestIp,
        limit: ACTIVATION_REQUEST_LIMIT,
        windowSeconds: ACTIVATION_REQUEST_WINDOW_SECONDS,
      }),
    );
    if (!reservation.allowed) {
      throw new AdminAuthRateLimitError(reservation.retryAfterSeconds);
    }
  }
}
