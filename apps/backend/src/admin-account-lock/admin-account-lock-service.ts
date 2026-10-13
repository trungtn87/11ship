import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminAccountReadRepository, PermissionRow } from '../admin-accounts/admin-account-read-repository';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { AdminUserAccountParticipant, OrdinaryAccount } from '../auth/admin-user-account-participant';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { lockEligibility } from './admin-account-lock-policy';
import { LockBody } from './admin-account-lock-validation';

export type LockKind = 'lock' | 'unlock';

const OPERATION_IDS: Readonly<Record<LockKind, string>> = { lock: 'admin.user.lock.v1', unlock: 'admin.user.unlock.v1' };
const AUDIT_ACTIONS: Readonly<Record<LockKind, string>> = { lock: 'admin.user.lock.v1', unlock: 'admin.user.unlock.v1' };
const EVENT_TYPES: Readonly<Record<LockKind, string>> = { lock: 'user.account.locked.v1', unlock: 'user.account.unlocked.v1' };
const RESOURCE_USER = 'user';

interface Authorized {
  readonly actorId: string;
  readonly role: AdminRole;
  readonly target: OrdinaryAccount;
}

/**
 * Lock / unlock of an ordinary USER account by SYSTEM or a covered ADMIN (M01-ADMIN, D15). One transaction opened by the
 * idempotency executor: idempotency record -> actor user S -> membership S -> factor S -> session S -> target user X ->
 * target roles -> database clock -> permissions and gate -> version/state -> users UPDATE (+ every unrevoked session of the
 * target revoked, in session_id order) -> audit -> outbox -> the executor's record -> COMMIT. Any refusal rolls everything back.
 *
 * A replay is answered from the stored acknowledgement only after the CURRENT actor, session, permissions, target shape and
 * full role set were checked again under locks (the sensitive replay hook); it never re-runs the version check, the update,
 * the revocation, the audit or the outbox.
 */
@Injectable()
export class AdminAccountLockService {
  readonly #gateOpen: boolean;

  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly accounts: AdminUserAccountParticipant,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#gateOpen = appConfig.adminUserAccountMutations?.enabled === true;
  }

  async change(
    kind: LockKind,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    userId: string,
    body: LockBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION_IDS[kind],
        idempotencyKey,
        // Everything that decides the effect; the reason is only fingerprinted by the executor, never stored in the record.
        logicalRequest: { user_id: userId, expected_version: body.expectedVersion, reason: body.reason },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, kind) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, userId, 'write');
        const wanted = kind === 'lock' ? 'DISABLED' : 'ACTIVE';
        if (auth.target.version !== body.expectedVersion) {
          throw new AppError('USER_ACCOUNT_VERSION_CONFLICT');
        }
        if (auth.target.status === wanted) {
          throw new AppError('USER_ACCOUNT_ALREADY_IN_STATE');
        }
        let revokedSessions = 0;
        let changed: { version: number; changedAtMs: number } | undefined;
        if (kind === 'lock') {
          const disabled = await this.accounts.disable(context, auth.target, body.expectedVersion);
          changed = disabled;
          revokedSessions = disabled?.revokedSessions ?? 0;
        } else {
          changed = await this.accounts.enable(context, auth.target, body.expectedVersion);
        }
        if (changed === undefined) {
          // The row is locked FOR UPDATE and was read in this transaction, so this cannot be a race: refuse rather than guess.
          throw new TechnicalError('internal', 'Locked account could not be updated');
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: auth.role,
          actorId: auth.actorId,
          action: AUDIT_ACTIONS[kind],
          resourceType: RESOURCE_USER,
          resourceId: userId,
          resourceVersion: changed.version,
          outcome: 'SUCCESS',
          metadata: {
            target_user_id: userId,
            from_status: auth.target.status,
            to_status: wanted,
            version: changed.version,
            reason: body.reason,
            ...(kind === 'lock' ? { revoked_sessions: revokedSessions } : {}),
          },
        });
        await this.outbox.append(context, {
          eventType: EVENT_TYPES[kind],
          eventSchemaVersion: 1,
          resourceType: RESOURCE_USER,
          resourceId: userId,
          resourceVersion: changed.version,
          payload: { user_id: userId, account_status: wanted, version: changed.version },
        });
        return {
          status: 200,
          replayGuard: { actor_user_id: auth.actorId, user_id: userId, kind },
          payload: {
            command_id: randomUUID(),
            user_id: userId,
            account_status: wanted,
            version: changed.version,
            changed_at: new Date(changed.changedAtMs).toISOString(),
          },
        };
      },
    );
  }

  /**
   * The shared authorization, under locks, in the module order. `mode` is the target lock: FOR UPDATE for the command, FOR
   * SHARE for the read-only replay check. The clock is read after the last lock; the permissions are read after the actor's
   * membership lock; nothing here trusts a projection of roles or a value from the client.
   */
  async #authorize(context: TransactionContext, known: SessionLookup, userId: string, mode: 'write' | 'read'): Promise<Authorized> {
    const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const target = await this.accounts.lockOrdinary(context, userId, mode);
    const role = actor.checked.membership.adminRole;
    const rows: readonly PermissionRow[] = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(actor, nowMs);
    if (role === 'ADMIN' && !rows.some((row) => row.canView)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    if (target === undefined) {
      throw new AppError('USER_NOT_AVAILABLE');
    }
    const eligibility = lockEligibility({ role, permissions: rows }, target.roles);
    if (eligibility === 'NOT_AVAILABLE') {
      throw new AppError('USER_NOT_AVAILABLE');
    }
    if (eligibility === 'FORBIDDEN') {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    if (!this.#gateOpen) {
      throw new AppError('USER_ACCOUNT_IMPACT_REVIEW_REQUIRED');
    }
    return { actorId: known.userId, role, target };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, kind: LockKind): Promise<true> {
    const userId = guard.user_id;
    if (guard.actor_user_id !== known.userId || guard.kind !== kind || !isCanonicalUuid(userId)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, userId, 'read');
    return true;
  }
}

