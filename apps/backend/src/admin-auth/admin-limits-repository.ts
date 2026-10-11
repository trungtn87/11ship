import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';
import { LimitKind } from './admin-auth-constants';

/** One bucket as seen by a transaction that holds its row lock. */
export interface BucketState {
  readonly bucketKey: string;
  readonly failureCount: number;
  /** Whole seconds until the lock ends (>= 1), or 0 when the bucket is not locked. */
  readonly lockedRemainingSeconds: number;
}

export interface RequestReservation {
  readonly allowed: boolean;
  /** Seconds to the end of the current window (>= 1); meaningful when not allowed. */
  readonly retryAfterSeconds: number;
}

export interface BucketRef {
  readonly bucketKey: string;
  readonly kind: LimitKind;
}

interface RawState {
  bucket_key: string;
  failure_count: number;
  locked_remaining_ms: string | null;
}

function toState(row: RawState): BucketState {
  const remainingMs = row.locked_remaining_ms === null ? 0 : toSafeInteger(row.locked_remaining_ms);
  return {
    bucketKey: row.bucket_key,
    failureCount: row.failure_count,
    lockedRemainingSeconds: remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0,
  };
}

/**
 * SQL for app.admin_auth_limits. Every time value comes from the PostgreSQL clock, and every decision about a bucket is
 * made while the caller's transaction holds that bucket's row lock (or inside one atomic statement), so any number of
 * application instances share the same counters. Buckets are keyed digests (see AdminLimiterKey), never identities.
 */
@Injectable()
export class AdminLimitsRepository {
  /**
   * Atomic fixed-window reserve of one request slot. The window starts at the first request and is never extended by a
   * refused request (the counter is capped just above the limit). The slot is NOT given back when the business
   * request later fails: this is a request quota, not a failure budget.
   */
  async reserveRequest(
    context: TransactionContext,
    input: { bucketKey: string; kind: LimitKind; limit: number; windowSeconds: number },
  ): Promise<RequestReservation> {
    const result = await context.query<{ failure_count: number; start_ms: string; now_ms: string }>(
      `WITH clock AS (${CLOCK_CTE})
       INSERT INTO app.admin_auth_limits AS l (
         bucket_key, kind, window_started_at, failure_count, locked_until, updated_at
       )
       SELECT $1, $2, clock.t, 1, NULL, clock.t FROM clock
       ON CONFLICT (bucket_key) DO UPDATE SET
         window_started_at = CASE
           WHEN l.window_started_at + make_interval(secs => $3::double precision) <= EXCLUDED.window_started_at
             THEN EXCLUDED.window_started_at ELSE l.window_started_at END,
         failure_count = CASE
           WHEN l.window_started_at + make_interval(secs => $3::double precision) <= EXCLUDED.window_started_at
             THEN 1 ELSE LEAST(l.failure_count + 1, $4::int + 1) END,
         updated_at = EXCLUDED.updated_at
       RETURNING l.failure_count, ${epochMs('l.window_started_at')} AS start_ms, ${epochMs('l.updated_at')} AS now_ms`,
      [input.bucketKey, input.kind, input.windowSeconds, input.limit],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Rate-limit reservation was not written');
    }
    if (row.failure_count <= input.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const remainingMs = toSafeInteger(row.start_ms) + input.windowSeconds * 1000 - toSafeInteger(row.now_ms);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
  }

  /**
   * Creates the missing rows, locks all of them in ascending bucket_key order (the one global order, so two
   * transactions that need the same buckets can never deadlock), clears expired locks and expired failure windows,
   * and returns the current state of each. The caller then decides, records failures and commits.
   */
  async lockBuckets(
    context: TransactionContext,
    buckets: readonly BucketRef[],
    windowSeconds: number,
  ): Promise<BucketState[]> {
    const unique = [...new Map(buckets.map((bucket) => [bucket.bucketKey, bucket])).values()].sort((a, b) =>
      a.bucketKey < b.bucketKey ? -1 : 1,
    );
    const keys = unique.map((bucket) => bucket.bucketKey);
    const kinds = unique.map((bucket) => bucket.kind);

    await context.query(
      `INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, locked_until, updated_at)
       SELECT b.bucket_key, b.kind, clock.t, 0, NULL, clock.t
         FROM unnest($1::text[], $2::text[]) AS b(bucket_key, kind)
        CROSS JOIN (${CLOCK_CTE}) AS clock
       ON CONFLICT (bucket_key) DO NOTHING`,
      [keys, kinds],
    );
    await context.query(
      `SELECT bucket_key FROM app.admin_auth_limits
        WHERE bucket_key = ANY($1::text[])
        ORDER BY bucket_key
          FOR UPDATE`,
      [keys],
    );
    await context.query(
      `WITH clock AS (${CLOCK_CTE})
       UPDATE app.admin_auth_limits l
          SET failure_count = 0, locked_until = NULL, window_started_at = clock.t, updated_at = clock.t
         FROM clock
        WHERE l.bucket_key = ANY($1::text[])
          AND (
            (l.locked_until IS NOT NULL AND l.locked_until <= clock.t)
            OR (l.locked_until IS NULL AND l.failure_count > 0
                AND l.window_started_at + make_interval(secs => $2::double precision) <= clock.t)
          )`,
      [keys, windowSeconds],
    );
    return this.#states(context, keys);
  }

  /** The same view without locking or writing: an expired lock or window counts as clear. */
  async peek(context: TransactionContext, bucketKeys: readonly string[]): Promise<BucketState[]> {
    return this.#states(context, [...bucketKeys]);
  }

  async #states(context: TransactionContext, keys: string[]): Promise<BucketState[]> {
    const result = await context.query<RawState>(
      `SELECT bucket_key, failure_count,
              CASE WHEN locked_until IS NOT NULL
                   THEN ${epochMs('locked_until')} - ${epochMs('clock_timestamp()')} END AS locked_remaining_ms
         FROM app.admin_auth_limits
        WHERE bucket_key = ANY($1::text[])
        ORDER BY bucket_key`,
      [keys],
    );
    return result.rows.map(toState);
  }

  /**
   * One failure on a bucket this transaction holds locked and has just seen unlocked. The window starts at the first
   * failure; reaching the limit locks the bucket for lockSeconds from now. A locked bucket is never touched, so a lock
   * is not extended by anything that happens while it runs.
   */
  async recordFailure(
    context: TransactionContext,
    input: { bucketKey: string; limit: number; lockSeconds: number },
  ): Promise<BucketState> {
    const result = await context.query<RawState>(
      `WITH clock AS (${CLOCK_CTE})
       UPDATE app.admin_auth_limits l
          SET window_started_at = CASE WHEN l.failure_count = 0 THEN clock.t ELSE l.window_started_at END,
              failure_count = l.failure_count + 1,
              locked_until = CASE WHEN l.failure_count + 1 >= $2::int
                                  THEN clock.t + make_interval(secs => $3::double precision) END,
              updated_at = clock.t
         FROM clock
        WHERE l.bucket_key = $1 AND l.locked_until IS NULL
       RETURNING l.bucket_key, l.failure_count,
                 CASE WHEN l.locked_until IS NOT NULL
                      THEN ${epochMs('l.locked_until')} - ${epochMs('l.updated_at')} END AS locked_remaining_ms`,
      [input.bucketKey, input.limit, input.lockSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) {
      // The bucket was already locked: nothing changes, and the lock keeps its original end.
      const [state] = await this.#states(context, [input.bucketKey]);
      if (state === undefined) {
        throw new TechnicalError('internal', 'Rate-limit bucket is missing');
      }
      return state;
    }
    return toState(row);
  }
}
