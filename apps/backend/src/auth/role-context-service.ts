import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionManager } from '../transaction/transaction-manager';
import { AUDIT_ACTIONS, isSupportedRole } from './auth-constants';
import { AuthPrincipal } from './auth-principal';
import { SessionRepository } from './session-repository';
import { UserRepository } from './user-repository';

export interface MeResult {
  readonly user_id: string;
  readonly phone_normalized: string;
  readonly available_roles: string[];
  readonly active_role: string | null;
  readonly onboarding_required: boolean;
  readonly role_selection_required: boolean;
}

/** /me and role selection (task sections 12 and 13). */
@Injectable()
export class RoleContextService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
  ) {}

  async me(principal: AuthPrincipal): Promise<MeResult> {
    const roles = await this.transactions.withTransaction((context) =>
      this.users.supportedRoles(context, principal.userId),
    );
    return this.#shape(principal.userId, principal.phoneNormalized, roles, principal.activeRole);
  }

  /**
   * Lock order: user, then current session, then role membership. The user lock serializes every role
   * selection of one user, so two SHOP selections on two sessions run one after the other and the later one
   * revokes the earlier. The partial unique index is only the final safety net.
   */
  async selectRole(principal: AuthPrincipal, role: string, requestId: string): Promise<MeResult> {
    if (!isSupportedRole(role)) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }

    return this.transactions.withTransaction(async (context) => {
      const user = await this.users.lockById(context, principal.userId);
      if (user === undefined) {
        throw new AppError('SESSION_INVALID');
      }
      const session = await this.sessions.lockById(context, principal.sessionId);
      if (session === undefined || session.userId !== principal.userId) {
        throw new AppError('SESSION_INVALID');
      }
      // Re-check inside the transaction, with the clock read after the locks.
      if (session.revoked) {
        throw new AppError('SESSION_REVOKED');
      }
      const nowMs = await freshClockMs(context);
      if (session.expiresAtMs <= nowMs) {
        throw new AppError('SESSION_EXPIRED');
      }
      if (user.status !== 'ACTIVE') {
        throw new AppError('ACCOUNT_DISABLED');
      }
      if (!(await this.users.hasRole(context, principal.userId, role))) {
        throw new AppError('ROLE_NOT_AVAILABLE');
      }

      let revoked: string[] = [];
      if (role === 'SHOP') {
        revoked = await this.sessions.revokeOtherShopSessions(context, principal.userId, principal.sessionId);
      }
      await this.sessions.setActiveRole(context, principal.sessionId, role);

      for (const revokedSessionId of revoked) {
        await this.audit.append(context, {
          requestId,
          actorType: 'USER',
          actorId: principal.userId,
          action: AUDIT_ACTIONS.sessionRevoke,
          resourceType: 'session',
          resourceId: revokedSessionId,
          outcome: 'SUCCESS',
          metadata: { reason: 'SHOP_REPLACED' },
        });
      }
      await this.audit.append(context, {
        requestId,
        actorType: 'USER',
        actorId: principal.userId,
        action: AUDIT_ACTIONS.roleSelect,
        resourceType: 'session',
        resourceId: principal.sessionId,
        outcome: 'SUCCESS',
        metadata: { role, revoked_sessions: revoked.length },
      });

      const roles = await this.users.supportedRoles(context, principal.userId);
      return this.#shape(principal.userId, principal.phoneNormalized, roles, role);
    });
  }

  #shape(userId: string, phone: string, roles: string[], activeRole: string | null): MeResult {
    return {
      user_id: userId,
      phone_normalized: phone,
      available_roles: roles,
      active_role: activeRole,
      onboarding_required: roles.length === 0,
      role_selection_required: roles.length > 0 && activeRole === null,
    };
  }
}
