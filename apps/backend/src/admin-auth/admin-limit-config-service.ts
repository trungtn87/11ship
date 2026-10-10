import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AdminLimiterConfig } from '../config/admin-auth-config';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminCliError } from './admin-cli-errors';
import { AdminLimitConfigRepository, LimitConfigRow } from './admin-limit-config-repository';

export type LimitConfigState = 'MATCHES' | 'MISSING' | 'MISMATCH';

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function describe(row: LimitConfigRow | undefined, limiter: AdminLimiterConfig): LimitConfigState {
  if (row === undefined) {
    return 'MISSING';
  }
  const idEqual = sameText(row.limiterKeyId, limiter.keyId);
  const checkEqual = sameText(row.keyCheck, limiter.key.keyCheck());
  return idEqual && checkEqual ? 'MATCHES' : 'MISMATCH';
}

/**
 * The limiter configuration lifecycle. The row is created ONLY by initialize() (the operator command), under an
 * advisory lock, and is never updated: a different key or key id is refused, so counters and locks can never be
 * silently moved into a new namespace. The running application only ever calls check().
 */
@Injectable()
export class AdminLimitConfigService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repository: AdminLimitConfigRepository,
  ) {}

  /** Read-only comparison, inside the caller's transaction. */
  async checkIn(context: TransactionContext, limiter: AdminLimiterConfig): Promise<LimitConfigState> {
    return describe(await this.repository.read(context), limiter);
  }

  async check(limiter: AdminLimiterConfig): Promise<LimitConfigState> {
    return this.transactions.withTransaction((context) => this.checkIn(context, limiter));
  }

  /** CREATED, UNCHANGED for the same configuration, or an AdminCliError for a different one. Never an UPDATE. */
  async initialize(limiter: AdminLimiterConfig): Promise<'CREATED' | 'UNCHANGED'> {
    return this.transactions.withTransaction(async (context) => {
      await this.repository.lockInitialization(context);
      const state = await this.checkIn(context, limiter);
      if (state === 'MATCHES') {
        return 'UNCHANGED';
      }
      if (state === 'MISMATCH') {
        throw new AdminCliError('LIMIT_CONFIG_MISMATCH');
      }
      const written = await this.repository.insert(context, {
        limiterKeyId: limiter.keyId,
        keyCheck: limiter.key.keyCheck(),
      });
      if (!written) {
        throw new AdminCliError('LIMIT_CONFIG_MISMATCH');
      }
      return 'CREATED';
    });
  }
}
