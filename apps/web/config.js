// Public runtime configuration of the web client. This file is served as-is (no build step) so a host can replace it.
// It is PUBLIC: never put a password, token, phone number, allowlist, operator credential or database URL in it.
window.SHIP_WEB_CONFIG = Object.freeze({
  // '' means same origin: the host serves this folder and forwards /v1/* to the backend (see scripts/web-dev-server.mjs).
  // The backend has no CORS, so a cross-origin value only works once the host adds a CORS allowlist (not in this slice).
  apiBaseUrl: '',
  requestTimeoutMs: 15000,
  // Shown as a permanent strip. This is the staging/test build of the client.
  environmentLabel: 'Môi trường thử nghiệm',
  // Registration and OTP are closed in staging (M00-D2 fixture mode): the client hides them. There is no SMS bypass.
  registrationEnabled: false,
});
