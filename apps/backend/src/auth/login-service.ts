import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { TransactionManager } from '../transaction/transaction-manager';
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

    const outcome = await this.transactions.withTransaction(async (context): Promise<LoginOutcome> => {
      const locked = await this.users.lockById(context, user.userId);
      if (locked === undefined || locked.passwordHash !== user.passwordHash) {
        // The credentials that were just verified are no longer the current ones.
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
      const roles = await this.users.supportedRoles(context, locked.userId);
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
          available_roles: roles,
          active_role: null,
          onboarding_required: roles.length === 0,
          role_selection_required: roles.length > 0,
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
