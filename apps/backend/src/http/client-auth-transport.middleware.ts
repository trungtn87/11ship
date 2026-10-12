// Transport headers of /v1/client-auth (M01.03): every response carries credentials or a session token, so none may be
// cached or referred. Installed by configureApp with app.use BEFORE init, i.e. in front of the body parser, so that a JSON
// syntax error or an oversized body also carries them. Headers only: no body, no decision.

interface MiddlewareResponse {
  setHeader(name: string, value: string): unknown;
}

export const CLIENT_AUTH_ROUTE_PREFIX = 'client-auth';

export function clientAuthTransportMiddleware(_request: unknown, response: MiddlewareResponse, next: () => void): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
