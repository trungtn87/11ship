import { Inject, Injectable } from '@nestjs/common';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { UserRepository } from '../auth/user-repository';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { GRANTABLE_FINANCE_PERMISSIONS } from './finance-access-constants';
import { FinanceAccessParticipant } from './finance-access-participant';
import { FinanceAccessRepository, FinanceGrantRow } from './finance-access-repository';
import { GrantBody } from './finance-access-validation';

export type GrantCommand = 'grant' | 'revoke';

const OPERATION: Readonly<Record<GrantCommand, string>> = { grant: 'admin.finance_access.grant.v1', revoke: 'admin.finance_access.revoke.v1' };
const RESOURCE = 'admin_finance_grant';
const EVENT_CHANGED = 'admin.finance_grant.changed.v1';
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Finance rights of the administration (M04-B2.2a). SYSTEM gives and takes back each right of an ADMIN one by one; an ADMIN has none by default
 * and can only read its own (and never change any, so nobody raises their own rights). Every call re-authorizes the actor UNDER the module's
 * locks (user, membership, factor, session), after the database clock was read: the cookie/CSRF precheck only filters early.
 *
 * A change is ONE transaction opened by the idempotency executor: record -> actor locks (SYSTEM only) -> target user FOR UPDATE -> target
 * membership FOR UPDATE -> the right's row FOR UPDATE -> version and state checks -> write -> audit -> outbox -> the executor's record. The target
 * user row is the root every writer of an administrator's rights takes first, and the participant that authorizes a finance command takes the
 * right's row FOR SHARE after the actor's own user lock, so a revocation and a command that is being authorized cannot interleave: the command is
 * either already past the check (and the revocation waits) or sees the revocation. A replay answers only after the SYSTEM actor was checked again.
 */
@Injectable()
export class FinanceAccessService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly users: UserRepository,
    private readonly memberships: AdminMembershipRepository,
    private readonly grants: FinanceAccessRepository,
    private readonly participant: FinanceAccessParticipant,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  /** The caller's own finance rights (any live administration session). Names the rights only: no PII, no other administrator. */
  async mine(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      this.actor.assertSessionLive(locked, await freshClockMs(context));
      const held = await this.participant.held(context, locked);
      return { role: locked.checked.membership.adminRole, implicit: held.implicit, permissions: [...held.permissions] };
    });
  }

  /** SYSTEM only: the rights of one ADMIN (every right that can be granted, with its state). */
  async ofAdmin(sessionToken: string | undefined, targetUserId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockSystem(context, known, 'read');
      const membership = await this.memberships.find(context, targetUserId);
      if (membership === undefined || membership.adminRole !== 'ADMIN') {
        throw new AppError('FINANCE_ADMIN_NOT_FOUND');
      }
      return view(targetUserId, await this.grants.listForUser(context, targetUserId));
    });
  }

  async change(
    command: GrantCommand,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    targetUserId: string,
    body: GrantBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION[command],
        idempotencyKey,
        logicalRequest: { target_user_id: targetUserId, permission_key: body.permissionKey, expected_version: body.expectedVersion },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#lockSystem(context, known, 'write');
            return true;
          },
        },
      },
      async (context) => {
        const locked = await this.#lockSystem(context, known, 'write');
        // The target: its USER row first (the root of every writer of its rights), then its membership; both FOR UPDATE.
        const user = await this.users.lockById(context, targetUserId);
        const membership = user === undefined ? undefined : await this.memberships.lock(context, targetUserId);
        // Only an ADMIN membership holds finance rights (SYSTEM has them implicitly). A right can only be GIVEN to an active one; taking it back
        // is allowed even when the administrator was disabled meanwhile.
        if (membership === undefined || membership.adminRole !== 'ADMIN' || (command === 'grant' && membership.status !== 'ACTIVE')) {
          throw new AppError('FINANCE_ADMIN_NOT_FOUND');
        }
        const current = await this.grants.lockForUpdate(context, targetUserId, body.permissionKey);
        if ((current?.version ?? 0) !== body.expectedVersion) {
          throw new AppError('FINANCE_VERSION_CONFLICT');
        }
        let after: FinanceGrantRow;
        if (command === 'grant') {
          if (current?.state === 'GRANTED') {
            throw new AppError('FINANCE_GRANT_STATE_CONFLICT');
          }
          after =
            current === undefined
              ? await this.grants.insertGranted(context, { userId: targetUserId, permissionKey: body.permissionKey, grantedBy: known.userId })
              : await this.grants.regrant(context, { userId: targetUserId, permissionKey: body.permissionKey, grantedBy: known.userId });
        } else {
          if (current?.state !== 'GRANTED') {
            throw new AppError('FINANCE_GRANT_STATE_CONFLICT');
          }
          after = await this.grants.revoke(context, { userId: targetUserId, permissionKey: body.permissionKey, revokedBy: known.userId });
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: OPERATION[command],
          resourceType: RESOURCE,
          resourceId: targetUserId,
          resourceVersion: after.version,
          outcome: 'SUCCESS',
          metadata: { permission_key: after.permissionKey, state: after.state },
        });
        await this.outbox.append(context, {
          eventType: EVENT_CHANGED,
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: targetUserId,
          resourceVersion: after.version,
          payload: { user_id: targetUserId, permission_key: after.permissionKey, state: after.state, version: after.version },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(targetUserId, await this.grants.listForUser(context, targetUserId)) };
      },
    );
  }

  /** The SYSTEM actor under the module's locks, the database clock read after them, then the SYSTEM requirement. */
  async #lockSystem(context: TransactionContext, known: SessionLookup, mode: 'read' | 'write'): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: mode, factor: 'read' });
    this.actor.assertLive(locked, await freshClockMs(context));
    return locked;
  }
}

function view(userId: string, rows: readonly FinanceGrantRow[]): JsonObject {
  const byKey = new Map(rows.map((row) => [row.permissionKey, row]));
  return {
    user_id: userId,
    permissions: GRANTABLE_FINANCE_PERMISSIONS.map((key) => {
      const row = byKey.get(key);
      return {
        permission_key: key,
        state: row?.state ?? 'NONE',
        version: row?.version ?? 0,
        granted_at: row === undefined || row.state !== 'GRANTED' ? null : iso(row.grantedAtMs),
        revoked_at: row?.revokedAtMs == null ? null : iso(row.revokedAtMs),
      };
    }),
  };
}
