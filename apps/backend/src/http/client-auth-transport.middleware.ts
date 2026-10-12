// Transport headers of /v1/client-auth (M01.03): every response carries credentials or a session token, so none may be
// cached or referred. Installed by configureApp with app.use BEFORE init, i.e. in front of the body parser, so that a JSON
// syntax error or an oversized body also carries them. Headers only: no body, no decision.

interface MiddlewareResponse {
  setHeader(name: string, value: string): unknown;
}

export const CLIENT_AUTH_ROUTE_PREFIX = 'client-auth';

/**
 * The own-profile routes (M01.05) answer personal data of the caller, so every response of them, errors included, takes the
 * same transport headers. Each is a whole-segment prefix: '/v1/driver/me' does not cover any other '/v1/driver/...' route.
 */
export const CLIENT_PROFILE_ROUTE_PREFIXES: readonly string[] = ['customer/me/profile', 'driver/me'];

export function clientAuthTransportMiddleware(_request: unknown, response: MiddlewareResponse, next: () => void): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
