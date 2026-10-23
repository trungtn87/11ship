import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG } from '../auth/auth-config.provider';
import { AuthConfig } from '../config/auth-config';
import { AppError } from '../common/app-errors';
import { TransactionManager } from '../transaction/transaction-manager';

/** Durable quota before Argon2: 30 attempts/minute per normalized phone, shared across instances.
 * Includes unknown accounts and retries. Client device IDs and app labels cannot reset the budget.
 * HMAC keys hide phone numbers in the quota table; refusals commit the reservation, not an account lock. */
@Injectable()
export class ClientLoginLimiter {
  constructor(private readonly transactions: TransactionManager, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  async reserve(phoneNormalized: string): Promise<void> {
    const bucket = this.config.otpHmacKey.hmacSha256Hex(JSON.stringify(['11ship.client-login.v1', phoneNormalized]));
    const allowed = await this.transactions.withTransaction(async (context) => {
      const result = await context.query<{ attempts: number }>(
        `INSERT INTO app.client_login_limits AS l (bucket_key, window_started_at, attempts)
         VALUES ($1, clock_timestamp(), 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
           attempts = CASE WHEN l.window_started_at + interval '1 minute' <= EXCLUDED.window_started_at
             THEN 1 ELSE LEAST(l.attempts + 1, 31) END,
           window_started_at = CASE WHEN l.window_started_at + interval '1 minute' <= EXCLUDED.window_started_at
             THEN EXCLUDED.window_started_at ELSE l.window_started_at END
         RETURNING attempts`, [bucket],
      );
      return (result.rows[0]?.attempts ?? 31) <= 30;
    });
    if (!allowed) throw new AppError('LOGIN_RATE_LIMITED');
  }
}
