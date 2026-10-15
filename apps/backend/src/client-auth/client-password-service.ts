import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { SessionRepository } from '../auth/session-repository';
import { UserRepository } from '../auth/user-repository';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { TransactionManager } from '../transaction/transaction-manager';
import { ClientSessionAuthority } from './client-session-authority';
import { ClientPasswordInput } from './client-auth-validation';

/** Reuses the password mutation from PR #115 (9efdf95), extended to Ship.
 * Own-password change: native guard outside, current user/session locks inside, no role or phone supplied by the client. */
@Injectable()
export class ClientPasswordService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async change(principal: AuthPrincipal, input: ClientPasswordInput, idempotencyKey: string | readonly string[] | undefined, requestId: string) {
    parseIdempotencyKey(idempotencyKey);
    // Expensive password work outside row locks. The exact hash is compared again under the write lock, so a concurrent reset
    // or change cannot be overwritten by a request verified against an obsolete password.
    const before = await this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      if (actor.app !== 'FOOD' && actor.app !== 'SHIP') throw new AppError('ROLE_NOT_AVAILABLE');
      return this.users.findById(context, actor.userId);
    });
    const matches = before !== undefined && await this.hasher.verify(before.passwordHash, input.currentPassword);
    const passwordHash = matches ? await this.hasher.hash(input.newPassword) : undefined;
    const outcome = await this.executor.execute({
      scopeType: 'client_password_session', scopeId: principal.sessionId, operationId: 'client.password.change',
      idempotencyKey, logicalRequest: { current_password: input.currentPassword, new_password: input.newPassword },
      replay: { kind: 'sensitive', authorize: async (context) => { await this.authority.lock(context, principal, 'share'); return true; } },
    }, async (context) => {
      const actor = await this.authority.lock(context, principal, 'update');
      if (actor.app !== 'FOOD' && actor.app !== 'SHIP') throw new AppError('ROLE_NOT_AVAILABLE');
      const current = await this.users.findById(context, actor.userId);
      if (!matches || passwordHash === undefined || before === undefined || current?.passwordHash !== before.passwordHash) {
        throw new AppError('CURRENT_PASSWORD_INVALID');
      }
      const version = await this.users.setPasswordHash(context, { userId: actor.userId, passwordHash });
      if (version === undefined) throw new TechnicalError('internal', 'Locked account could not be updated');
      // Keep the authenticated device session for an idempotent retry; revoke every other app session.
      const revoked = await this.sessions.revokeOthersForUser(context, actor.userId, actor.sessionId);
      await this.audit.append(context, { requestId, actorType: 'USER', actorId: actor.userId, action: 'client.auth.password.change.v1', resourceType: 'user', resourceId: actor.userId, resourceVersion: version, outcome: 'SUCCESS', metadata: { revoked_app_sessions: revoked } });
      return { status: 200, payload: { changed: true }, replayGuard: { user_id: actor.userId, session_id: actor.sessionId } };
    });
    return { data: outcome.payload };
  }
}
