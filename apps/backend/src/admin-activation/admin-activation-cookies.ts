import { ACTIVATION_COOKIE } from './admin-activation-constants';

// The activation-session cookie (contract section 6.1). __Host- requires Secure, Path=/ and no Domain; HttpOnly keeps it
// from scripts, SameSite=Strict from cross-site requests. It is NOT the login cookie and is never accepted in its place.

export function activationCookie(token: string, maxAgeSeconds: number): string {
  return `${ACTIVATION_COOKIE}=${token}; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

/** Expired cookie with the SAME attributes, which is how a browser matches and removes it. */
export function clearedActivationCookie(): string {
  return `${ACTIVATION_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=Strict`;
}
