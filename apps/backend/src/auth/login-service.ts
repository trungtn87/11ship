import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  ACCOUNT_ORIGIN_POLICY,
  AccountOriginPolicy,
  PhoneVerificationStatus,
  phoneVerificationStatusOf,
  standardAccountOriginPolicy,
} from './account-origin';
import { roleContext } from './available-roles';
import { AUDIT_ACTIONS } from './auth-constants';
import { AUTH_CONFIG } from './auth-config.provider';
import { LoginInput } from './auth-validation';
import { PASSWORD_HASHER, PasswordHasher } from './password-hasher';
import { SessionRepository } from './session-repository';
import { UserRepository } from './user-repository';

export interface LoginResult {
  readonly user_id: string;
  readonly available_roles: string[];
  readonly active_role: null;
  readonly onboarding_required: boolean;
  readonly role_selection_required: boolean;
  /** Display only (M00-D2): VERIFIED for a registered account, UNVERIFIED_TEST for a staging fixture. */
  readonly phone_verification_status: PhoneVerificationStatus;
  readonly access_token: string;
}

type LoginOutcome =
  | { readonly kind: 'ok'; readonly result: LoginResult }
  | { readonly kind: 'disabled'; readonly userId: string }
  | { readonly kind: 'changed' };

/**
 * Login (task section 11). Argon2 verification runs OUTSIDE any transaction; a short transaction then locks
 * the user, re-checks that it is still ACTIVE and that the password hash is the one that was verified, and
 * creates a roleless session. Login never selects a role.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly recorder: StandaloneAuditRecorder,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly shops: ShopEligibilityReader,
    private readonly drivers: DriverEligibilityReader,
    // Without an explicit binding the standard policy applies: verified accounts only, never a fixture.
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy = standardAccountOriginPolicy(),
  ) {}

  async login(input: LoginInput, requestId: string): Promise<LoginResult> {
    const user = await this.transactions.withTransaction((context) =>
      this.users.findByPhone(context, input.phoneNormalized),
    );
    if (user === undefined) {
      // Same work as a real verification, same answer as a wrong password.
      await this.hasher.verifyAgainstDummy(input.password);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    // Account origin policy (M00-D2), only AFTER the password was verified, so nothing about an account's origin is
    // disclosed to someone who does not hold its credentials. A denial is indistinguishable from a wrong password.
    if (!this.policy.allows(user)) {
      throw new AppError('INVALID_CREDENTIALS');
    }

    const outcome = await this.transactions.withTransaction(async (context): Promise<LoginOutcome> => {
      const locked = await this.users.lockById(context, user.userId);
      if (locked === undefined || locked.passwordHash !== user.passwordHash) {
        // The credentials that were just verified are no longer the current ones.
        return { kind: 'changed' };
      }
      // The policy again, on the LOCKED row and before any session exists: the mode, the allowlist or the account
      // may have changed while the password was being verified. Same answer as a wrong password.
      if (!this.policy.allows(locked)) {
        return { kind: 'changed' };
      }
      if (locked.status !== 'ACTIVE') {
        return { kind: 'disabled', userId: locked.userId };
      }
      const session = await this.sessions.create(context, {
        userId: locked.userId,
        device: input.device,
        ttlSeconds: this.config.sessionTtlSeconds,
      });
      // The roles the user can actually select (SHOP only with an ACTIVE owned shop, DRIVER only with a Driver
      // profile that is not CLOSED) and the two flags, from the same rule /me uses (see roleContext). A new
      // session has no active role.
      const held = await this.users.supportedRoles(context, locked.userId);
      const roles = roleContext(
        held,
        await this.shops.ownerShopEligibility(context, locked.userId),
        await this.drivers.ownerDriverEligibility(context, locked.userId),
        null,
      );
      await this.audit.append(context, {
        requestId,
        actorType: 'USER',
        actorId: locked.userId,
        action: AUDIT_ACTIONS.login,
        resourceType: 'user',
        resourceId: locked.userId,
        outcome: 'SUCCESS',
        metadata: { session_id: session.sessionId },
      });
      return {
        kind: 'ok',
        result: {
          user_id: locked.userId,
          available_roles: roles.available_roles,
          active_role: null,
          onboarding_required: roles.onboarding_required,
          role_selection_required: roles.role_selection_required,
          phone_verification_status: phoneVerificationStatusOf(locked.accountOrigin),
          access_token: session.accessToken,
        },
      };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.result;
      case 'changed':
        throw new AppError('INVALID_CREDENTIALS');
      case 'disabled':
        await this.recorder.recordBestEffort({
          requestId,
          actorType: 'USER',
          actorId: outcome.userId,
          action: AUDIT_ACTIONS.login,
          resourceType: 'user',
          resourceId: outcome.userId,
          outcome: 'DENIED',
          reasonCode: 'ACCOUNT_DISABLED',
        });
        throw new AppError('ACCOUNT_DISABLED');
    }
  }
}
