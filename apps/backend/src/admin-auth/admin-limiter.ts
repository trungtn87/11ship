import { Inject, Injectable } from '@nestjs/common';
import { AdminAuthRateLimitError } from '../common/app-errors';
import { AdminLimiterKey } from '../config/admin-auth-config';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  LIMIT_KINDS,
  LOGIN_REQUEST_LIMIT,
  REQUEST_WINDOW_SECONDS,
  TOTP_REQUEST_LIMIT,
} from './admin-auth-constants';
import { AdminLimitsRepository, BucketRef, BucketState } from './admin-limits-repository';
import { ipLimiterIdentity } from './client-ip';

export const ADMIN_LIMITER_KEY = Symbol('ADMIN_LIMITER_KEY');

/** Builds bucket identities and reserves ingress quota. The failure budgets are driven by the login and TOTP services. */
@Injectable()
export class AdminLimiter {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly limits: AdminLimitsRepository,
    @Inject(ADMIN_LIMITER_KEY) private readonly key: AdminLimiterKey,
  ) {}

  phoneBucket(phoneNormalized: string): BucketRef {
    return { bucketKey: this.key.bucketKey(LIMIT_KINDS.loginPhone, phoneNormalized), kind: LIMIT_KINDS.loginPhone };
  }

  loginIpBucket(ip: string): BucketRef {
    return { bucketKey: this.key.bucketKey(LIMIT_KINDS.loginIp, ipLimiterIdentity(ip)), kind: LIMIT_KINDS.loginIp };
  }

  totpUserBucket(userId: string): BucketRef {
    return { bucketKey: this.key.bucketKey(LIMIT_KINDS.totpUser, userId), kind: LIMIT_KINDS.totpUser };
  }

  /** Quota of password-login requests per address: reserved BEFORE any password work, never given back. */
  async reserveLoginRequest(ip: string): Promise<void> {
    await this.#reserve(LIMIT_KINDS.loginRequestIp, ip, LOGIN_REQUEST_LIMIT);
  }

  /** Quota of every TOTP POST per address: reserved before the body, the cookie, the secret or the verifier is touched. */
  async reserveTotpRequest(ip: string): Promise<void> {
    await this.#reserve(LIMIT_KINDS.totpRequestIp, ip, TOTP_REQUEST_LIMIT);
  }

  async #reserve(kind: typeof LIMIT_KINDS.loginRequestIp | typeof LIMIT_KINDS.totpRequestIp, ip: string, limit: number): Promise<void> {
    const bucketKey = this.key.bucketKey(kind, ipLimiterIdentity(ip));
    const reservation = await this.transactions.withTransaction((context: TransactionContext) =>
      this.limits.reserveRequest(context, { bucketKey, kind, limit, windowSeconds: REQUEST_WINDOW_SECONDS }),
    );
    if (!reservation.allowed) {
      throw new AdminAuthRateLimitError(reservation.retryAfterSeconds);
    }
  }
}

/** The longest remaining lock among the buckets (0 when none is locked). */
export function longestLock(states: readonly BucketState[]): number {
  return states.reduce((max, state) => Math.max(max, state.lockedRemainingSeconds), 0);
}
