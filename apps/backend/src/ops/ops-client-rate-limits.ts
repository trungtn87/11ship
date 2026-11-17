/**
 * Per-client-address backstops for the two M13 routes that had no limit in the backend (P5-7j). They are backstops behind nginx, not
 * product quotas: the reference numbers are the nginx zones in ops/vinahost/nginx-11ship-staging.conf (ship11_app_download 30 r/min,
 * ship11_ops_ingest 60 r/min), and nginx is the first line. Change them only together with the runbook and that nginx file.
 * Identity: OtpClientIp (the socket address, or X-Forwarded-For only from a configured trusted proxy). Memory is bounded by the shared
 * PublicRateLimiter (fixed one-minute window, hard cap on tracked addresses).
 */

/** GET /v1/app-updates/download/:release_id, per client address and minute. A device downloads one APK at a time; 30 is well above that. */
export const APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE = 30;

/** Every POST /v1/ops/ingest/* route (probe, backup, deploy) together, per client address and minute. */
export const OPS_INGEST_LIMIT_PER_MINUTE = 60;
