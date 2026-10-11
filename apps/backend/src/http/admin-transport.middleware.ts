// Transport headers of the administration API prefixes /v1/admin-auth and /v1/admin (issue #49, follow-up
// docs/tasks/M01-D-ADMIN-BACKEND-transport-headers-followup.md).
//
// Module middleware (AdminAuthModule.configure) runs AFTER the framework's body parser, so a JSON syntax error or an
// oversized body, answered by the parser itself, used to leave the response without these headers. configureApp installs
// this function with app.use BEFORE the application initializes, which puts it in front of the parser. It sets headers
// only: it reads no body, checks no Origin/CSRF/session and changes no status, so the Auth/Origin/CSRF decisions stay
// exactly where they were (the controllers and services).

interface MiddlewareResponse {
  setHeader(name: string, value: string): unknown;
}

export const ADMIN_AUTH_ROUTE_PREFIX = 'admin-auth';
export const ADMIN_ROUTE_PREFIX = 'admin';

export function adminTransportMiddleware(_request: unknown, response: MiddlewareResponse, next: () => void): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
