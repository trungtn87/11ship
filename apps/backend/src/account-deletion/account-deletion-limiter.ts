import { Inject, Injectable } from '@nestjs/common';
import { requireAuthConfig } from '../auth/auth-config.provider';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccountDeletionQuota, DEFAULT_ACCOUNT_DELETION_CONFIG } from '../config/account-deletion-config';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

/**
 * The quota of POST /v1/account-deletion/confirm (P5-6a, OD-26). It is its own table (app.account_delete_limits) and its own key space, so it
 * shares NOTHING with the login quota (client_login_limits) or the OTP quotas: a burst here cannot lock anyone out of login, and a login or
 * OTP burst cannot spend this budget.
 *
 * Two buckets are counted for EVERY request, BEFORE any account is looked up and before Argon2 runs: the client address and the normalized
 * phone number. A phone that does not exist and one that does cost exactly the same counter writes, so neither the answer nor the counters
 * reveal whether an account exists. A refusal commits the reservation (the attempt is counted). A wrong password only spends budget: nothing
 * here ever locks, flags or changes an account.
 *
 * The phone bucket is the main layer. The address bucket is only as precise as the proxy configuration (OtpClientIp: X-Forwarded-For is trusted
 * only from the configured proxy addresses); behind an unlisted proxy every client shares one address.
 *
 * HMAC keys hide both values in the table; limits and windows come from the validated configuration.
 */
@Injectable()
export class AccountDeletionLimiter {
  constructor(
    private readonly transactions: TransactionManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reserve(clientIdentity: string, phoneNormalized: string): Promise<void> {
    const quotas = this.config.accountDeletion ?? DEFAULT_ACCOUNT_DELETION_CONFIG;
    const ipKey = this.#key('ip', clientIdentity);
    const phoneKey = this.#key('phone', phoneNormalized);
    const allowed = await this.transactions.withTransaction(async (context) => {
      // Always the address first, then the phone: one fixed order, so two requests can never wait for each other.
      const byIp = await bump(context, ipKey, quotas.ip);
      const byPhone = await bump(context, phoneKey, quotas.phone);
      return byIp <= quotas.ip.limit && byPhone <= quotas.phone.limit;
    });
    if (!allowed) {
      throw new AppError('ACCOUNT_DELETE_RATE_LIMITED');
    }
  }

  #key(kind: 'ip' | 'phone', value: string): string {
    return requireAuthConfig(this.config).otpHmacKey.hmacSha256Hex(JSON.stringify(['11ship.account-delete.v1', kind, value]));
  }
}

/** Counts one attempt in the bucket's current window and returns the attempts so far (capped at limit + 1: the counter never grows without bound). */
async function bump(context: TransactionContext, bucketKey: string, quota: AccountDeletionQuota): Promise<number> {
  const result = await context.query<{ attempts: number }>(
    `INSERT INTO app.account_delete_limits AS l (bucket_key, window_started_at, attempts)
     VALUES ($1, clock_timestamp(), 1)
     ON CONFLICT (bucket_key) DO UPDATE SET
       attempts = CASE WHEN l.window_started_at + make_interval(secs => $2::int) <= EXCLUDED.window_started_at
         THEN 1 ELSE LEAST(l.attempts + 1, $3::int + 1) END,
       window_started_at = CASE WHEN l.window_started_at + make_interval(secs => $2::int) <= EXCLUDED.window_started_at
         THEN EXCLUDED.window_started_at ELSE l.window_started_at END
     RETURNING attempts`,
    [bucketKey, quota.windowSeconds, quota.limit],
  );
  return result.rows[0]?.attempts ?? quota.limit + 1;
}
