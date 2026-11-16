/** Shortest time an unattached upload is kept (OD-2 / #261: 24 hours). */
export const ORPHAN_MIN_RETENTION_SECONDS = 24 * 3600;
/** Gap between the upload row and its idempotency record that the retention must still cover. */
export const ORPHAN_REPLAY_MARGIN_SECONDS = 3600;

/**
 * How long an unattached upload (a menu picture, a complaint picture) is kept. Never shorter than the replay window of its upload
 * (IDEMPOTENCY_REPLAY_TTL_SECONDS, up to 7 days): a retry inside that window must not be answered with the metadata of a row the janitor already
 * deleted. The default replay window (900 s) keeps the 24-hour minimum.
 */
export function orphanRetentionSeconds(replayTtlSeconds: number, minimumSeconds: number = ORPHAN_MIN_RETENTION_SECONDS): number {
  return Math.max(minimumSeconds, replayTtlSeconds + ORPHAN_REPLAY_MARGIN_SECONDS);
}
