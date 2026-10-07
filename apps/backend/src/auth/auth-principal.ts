/** The authenticated caller, derived by SessionAuthGuard from the database, never from the request body. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly activeRole: string | null;
  readonly phoneNormalized: string;
}

/** Minimal request shape the guard and the controller share (no Express typings needed). */
export interface AuthenticatedRequest {
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthPrincipal;
}
