import { TechnicalError } from '../common/app-errors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { BindingInfo } from '../client-device/client-device-binding-participant';
import { ClientIdentity } from './client-identity-reader';

// The success body shared by the client-auth endpoints (contract10 section 4, contract11 sections 3 and 5). Register and
// login answer identity + access_token + session; me and context answer identity + session (no token, ever).

/** What an idempotency record of register/login stores (encrypted): ONLY the secret and the instant, never a snapshot of rights. */
export interface StoredResult {
  readonly accessToken: string;
  readonly expiresAt: string;
}

/** The CURRENT identity read inside the transaction of the first execution or of the replay authorization. */
export interface IdentityCapture {
  identity: ClientIdentity | undefined;
  /** Native only: the device binding the session was issued to (exposed as response headers, never in the body). */
  binding?: BindingInfo | undefined;
}

export function storedResultOf(payload: unknown): StoredResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TechnicalError('internal', 'Invalid stored authentication result');
  }
  const { access_token: accessToken, expires_at: expiresAt } = payload as Record<string, unknown>;
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'string') {
    throw new TechnicalError('internal', 'Invalid stored authentication result');
  }
  return { accessToken, expiresAt };
}

/** The identity block, field for field, in the contract order. */
function identityBlockOf(identity: ClientIdentity): JsonObject {
  return {
    user_id: identity.user_id,
    phone_normalized: identity.phone_normalized,
    available_roles: identity.available_roles,
    active_role: identity.active_role,
    profile: { full_name: identity.profile.full_name, version: identity.profile.version },
    capabilities: { ...identity.capabilities },
    onboarding: { ...identity.onboarding },
    onboarding_required: identity.onboarding_required,
    role_selection_required: identity.role_selection_required,
  };
}

/** Identity + access_token + session{expires_at}: the success `data` of register and login. */
export function responseOf(identity: ClientIdentity, stored: StoredResult): JsonObject {
  return {
    ...identityBlockOf(identity),
    access_token: stored.accessToken,
    session: { expires_at: stored.expiresAt },
  };
}

/** Identity + session{expires_at}, with NO token: the success `data` of me and context. */
export function sessionResponseOf(identity: ClientIdentity, expiresAtMs: number): JsonObject {
  return {
    ...identityBlockOf(identity),
    session: { expires_at: new Date(expiresAtMs).toISOString() },
  };
}

export function requireIdentity(capture: IdentityCapture): ClientIdentity {
  if (capture.identity === undefined) {
    // Unreachable: both paths fill it before the executor returns. Fail closed rather than answer without an identity.
    throw new TechnicalError('internal', 'The authentication identity was not read');
  }
  return capture.identity;
}
