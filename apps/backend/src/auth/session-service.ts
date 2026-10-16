import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { TransactionManager } from '../transaction/transaction-manager';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, standardAccountOriginPolicy } from './account-origin';
import { AuthPrincipal } from './auth-principal';
import { SessionRepository } from './session-repository';
import { digestToken, parseCanonicalToken } from './tokens';

const BEARER = /^Bearer ([A-Za-z0-9_-]+)$/i;

/**
 * Extracts the access token from the Authorization header value. Exactly one header, scheme "Bearer"
 * (case-insensitive), one space, then a canonical 32-byte base64url token. Anything else is undefined.
 * A token is never read from the query string or the body.
 */
export function bearerTokenFrom(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = BEARER.exec(header);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  return parseCanonicalToken(match[1]);
}

/** Bearer-session authentication (task section 10). Every protected request goes through here. */
@Injectable()
export class SessionService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly sessions: SessionRepository,
    // Without an explicit binding the standard policy applies: verified accounts only, never a fixture.
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy = standardAccountOriginPolicy(),
  ) {}

  /**
   * `allowLockedDriver` is set only by a route marked @AllowLockedDriver(): a locked account then passes the guard when its session wears the
   * DRIVER context, and nothing else changes (the revoked/expired precedence and every other check are the same). The transaction of the
   * route decides again under its locks.
   */
  async authenticate(authorization: string | string[] | undefined, options: { readonly allowLockedDriver?: boolean } = {}): Promise<AuthPrincipal> {
    const token = bearerTokenFrom(authorization);
    if (token === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    const digest = digestToken(token);
    const view = await this.transactions.withTransaction((context) =>
      this.sessions.findByDigest(context, digest),
    );
    if (view === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    // Account origin policy: an administration account has no application session, a fixture outside staging / fixture
    // mode / the allowlist, or a verified account while the fixture mode is on, is simply not a valid session. Decided
    // first, so the answer cannot reveal which of those it was.
    if (!this.policy.allows({ accountOrigin: view.accountOrigin, phoneNormalized: view.phoneNormalized })) {
      throw new AppError('SESSION_INVALID');
    }
    // Order matters only for which single error is reported: revoked, then expired, then disabled.
    if (view.revoked) {
      throw new AppError('SESSION_REVOKED');
    }
    if (view.expired) {
      throw new AppError('SESSION_EXPIRED');
    }
    if (view.userStatus !== 'ACTIVE' && !(options.allowLockedDriver === true && view.activeRole === 'DRIVER')) {
      throw new AppError('ACCOUNT_DISABLED');
    }
    return {
      userId: view.userId,
      sessionId: view.sessionId,
      activeRole: view.activeRole,
      phoneNormalized: view.phoneNormalized,
      platform: view.platform,
      app: view.app,
    };
  }
}
