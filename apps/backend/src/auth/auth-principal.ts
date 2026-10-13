/** The authenticated caller, derived by SessionAuthGuard from the database, never from the request body. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly activeRole: string | null;
  readonly phoneNormalized: string;
  /** The platform and app recorded on the session (immutable); a native session is ANDROID + FOOD/SHIP. */
  readonly platform?: string;
  readonly app?: string;
}

/** Minimal request shape the guard and the controller share (no Express typings needed). */
export interface AuthenticatedRequest {
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthPrincipal;
  method?: string;
  /** Exact request target as received (path and query), for the native request proof. */
  originalUrl?: string;
  /** The exact body bytes as received, captured by the JSON parser before it parsed them (native request proof). */
  rawBody?: Buffer;
}

/**
 * The two server-authenticated identifiers a command needs to authorize itself again inside its transaction.
 * Only these two cross into a coordinator: no token, no phone number, no cached role.
 */
export function actorOf(principal: AuthPrincipal): { readonly userId: string; readonly sessionId: string } {
  return { userId: principal.userId, sessionId: principal.sessionId };
}
