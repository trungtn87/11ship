/**
 * The one rule for "is this credential expired" that every administration path uses before it accepts a preauth step or
 * a session (enrollment, verify, GET /state, GET /me).
 *
 * `nowMs` MUST be the PostgreSQL clock read (freshClockMs) AFTER the last lock of the request was granted, in the same
 * transaction. It must not come from a column computed inside the statement that takes the lock: such a value is
 * evaluated before the lock wait ends, so a credential that expired while the request was waiting would still look
 * valid. Both instants are epoch milliseconds and expires_at is millisecond-aligned, so equality means expired, exactly
 * like `expires_at <= clock_timestamp()`.
 */
export function isExpiredAt(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}
