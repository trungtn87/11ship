/**
 * Deterministic retry delay of ADR-003 §13.6: min(cap, base * 2^(attempt_count - 1)). No jitter.
 * `attemptCount` is the number of the attempt that just failed (1 for the first). Pure: no clock, no random.
 */
export function backoffDelayMs(attemptCount: number, baseMs: number, capMs: number): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError('attemptCount must be a positive integer');
  }
  if (!Number.isSafeInteger(baseMs) || baseMs < 1 || !Number.isSafeInteger(capMs) || capMs < 1) {
    throw new RangeError('backoff base and cap must be positive integers');
  }
  // 2 ** 40 * base stays far below 2 ** 53, and the cap (<= 300000 ms) is reached long before that, so
  // clamping the exponent never changes the result for any valid configuration.
  const exponent = Math.min(attemptCount - 1, 40);
  return Math.min(capMs, baseMs * 2 ** exponent);
}
