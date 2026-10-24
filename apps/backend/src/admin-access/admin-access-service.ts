import { Inject, Injectable } from '@nestjs/common';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { AdminAccountReadRepository, PermissionRow } from '../admin-accounts/admin-account-read-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { maskPhone } from '../admin-provisioning/admin-provisioning-views';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { UserRepository } from '../auth/user-repository';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { GRANTABLE_PERMISSIONS } from '../finance-access/finance-access-constants';
import { FinanceAccessRepository } from '../finance-access/finance-access-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminAccessRepository } from './admin-access-repository';
import { AppPermissionInput, ADMIN_APPS, PermissionsBody, permissionsFingerprint, RevokeBody, StatusBody } from './admin-access-validation';

export type AccessCommand = 'permissions' | 'lock' | 'unlock' | 'revoke-sessions';

const OPERATION: Readonly<Record<AccessCommand, string>> = {
  permissions: 'admin.access.permissions.update.v1',
  lock: 'admin.access.lock.v1',
  unlock: 'admin.access.unlock.v1',
  'revoke-sessions': 'admin.access.revoke_sessions.v1',
};
const RESOURCE = 'admin_access';
const LIST_LIMIT = 200;
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const toInput = (row: PermissionRow): AppPermissionInput => ({ app: row.app, canView: row.canView, canReviewProfile: row.canReviewProfile, canLock: row.canLock, canManageCatalog: row.canManageCatalog === true, canManageShops: row.canManageShops === true });
const permissionView = (row: AppPermissionInput): JsonObject => ({ app: row.app, can_view: row.canView, can_review_profile: row.canReviewProfile, can_lock: row.canLock, can_manage_catalog: row.canManageCatalog, can_manage_shops: row.canManageShops });

/**
 * M12-C: SYSTEM manages the ADMIN accounts - the application permissions, the function rights (finance, reports, audit: the existing grant routes), the lock
 * and the sessions. ADMIN has no route here at all: every method re-checks SYSTEM under the actor's locks after the database clock was read, so an administrator
 * can never raise their own rights or touch another, and SYSTEM itself is never a target (the target must be an ADMIN membership).
 *
 * A change is one transaction opened by the idempotency executor: record -> actor locks -> target user FOR UPDATE -> target membership FOR UPDATE -> optimistic
 * check (membership version, or the fingerprint of the permission rows the screen saw) -> write -> audit with before / after and the reason. A lock or a
 * permission change takes effect at the target's NEXT request: the permission rows are read live and a lock bumps the membership version the sessions are
 * bound to. The shipper's operating-area configuration is not part of any of this.
 */
@Injectable()
export class AdminAccessService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly users: UserRepository,
    private readonly memberships: AdminMembershipRepository,
    private readonly sessions: AdminSessionRepository,
    private readonly reader: AdminAccountReadRepository,
    private readonly access: AdminAccessRepository,
    private readonly grants: FinanceAccessRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  /** The matrix: every ADMIN with the application permissions, the function rights and the tokens a change must echo. SYSTEM only. */
  async matrix(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockSystem(context, known, 'read');
      const rows = await this.access.listAdministrators(context, LIST_LIMIT + 1);
      const page = rows.slice(0, LIST_LIMIT);
      const permissions = await this.reader.permissionsOf(context, page.map((row) => row.userId));
      const items: JsonObject[] = [];
      for (const row of page) {
        const apps = (permissions.get(row.userId) ?? []).map(toInput);
        const held = new Map((await this.grants.listForUser(context, row.userId)).map((grant) => [grant.permissionKey, grant]));
        items.push({
          user_id: row.userId,
          full_name: row.fullName,
          phone_masked: maskPhone(row.phoneNormalized),
          // The account is usable only when the membership AND the user account are active.
          status: row.membershipStatus === 'ACTIVE' && row.accountStatus === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
          membership_status: row.membershipStatus,
          membership_version: row.membershipVersion,
          created_at: iso(row.createdAtMs),
          live_sessions: row.liveSessions,
          last_login_at: iso(row.lastSessionMs),
          permissions: apps.map(permissionView),
          permissions_fingerprint: permissionsFingerprint(apps),
          rights: GRANTABLE_PERMISSIONS.map((key) => ({ permission_key: key, state: held.get(key)?.state ?? 'NONE', version: held.get(key)?.version ?? 0 })),
        });
      }
      return { items, truncated: rows.length > LIST_LIMIT, apps: [...ADMIN_APPS], rights: [...GRANTABLE_PERMISSIONS] };
    });
  }

  updatePermissions(sessionToken: string | undefined, csrf: unknown, targetId: string, body: PermissionsBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#change('permissions', sessionToken, csrf, targetId, key, meta, { target_user_id: targetId, permissions: body.permissions.map(permissionView), expected_fingerprint: body.expectedFingerprint, reason: body.reason }, async (context, locked, membership) => {
      const before = (await this.reader.permissionsOf(context, [targetId])).get(targetId)?.map(toInput) ?? [];
      if (permissionsFingerprint(before) !== body.expectedFingerprint) {
        throw new AppError('ADMIN_ACCESS_VERSION_CONFLICT');
      }
      await this.access.replacePermissions(context, targetId, body.permissions);
      return { version: membership.version, metadata: { reason: body.reason, before: before.map(permissionView), after: body.permissions.map(permissionView) } };
    });
  }

  setStatus(command: 'lock' | 'unlock', sessionToken: string | undefined, csrf: unknown, targetId: string, body: StatusBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#change(command, sessionToken, csrf, targetId, key, meta, { target_user_id: targetId, expected_version: body.expectedVersion, reason: body.reason }, async (context, _locked, membership) => {
      if (membership.version !== body.expectedVersion) {
        throw new AppError('ADMIN_ACCESS_VERSION_CONFLICT');
      }
      const next = command === 'lock' ? 'DISABLED' : 'ACTIVE';
      if (membership.status === next) {
        throw new AppError('ADMIN_ACCESS_STATE_CONFLICT');
      }
      if (!(await this.memberships.setStatus(context, targetId, membership.version, next))) {
        throw new AppError('ADMIN_ACCESS_VERSION_CONFLICT');
      }
      // Locking ends every session now; unlocking never revives one (the administrator signs in again, password and Authenticator).
      if (command === 'lock') {
        await this.sessions.revokeAllForUser(context, targetId);
      }
      return { version: membership.version + 1, metadata: { reason: body.reason, before: { status: membership.status }, after: { status: next } } };
    });
  }

  revokeSessions(sessionToken: string | undefined, csrf: unknown, targetId: string, body: RevokeBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#change('revoke-sessions', sessionToken, csrf, targetId, key, meta, { target_user_id: targetId, reason: body.reason }, async (context, _locked, membership) => {
      await this.sessions.revokeAllForUser(context, targetId);
      return { version: membership.version, metadata: { reason: body.reason } };
    });
  }

  async #change(
    command: AccessCommand,
    sessionToken: string | undefined,
    csrf: unknown,
    targetId: string,
    key: string | readonly string[] | undefined,
    meta: { requestId: string },
    logicalRequest: JsonObject,
    apply: (context: TransactionContext, locked: LockedActor, membership: { version: number; status: 'ACTIVE' | 'DISABLED' }) => Promise<{ version: number; metadata: JsonObject }>,
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION[command],
        idempotencyKey: key,
        logicalRequest,
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
        const user = await this.users.lockById(context, targetId);
        const membership = user === undefined ? undefined : await this.memberships.lock(context, targetId);
        // Only an ADMIN membership can be managed: SYSTEM is never a target, and an unknown id looks like any other missing administrator.
        if (membership === undefined || membership.adminRole !== 'ADMIN') {
          throw new AppError('ADMIN_ACCESS_NOT_FOUND');
        }
        const done = await apply(context, locked, { version: membership.version, status: membership.status });
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: 'SYSTEM',
          actorId: known.userId,
          action: OPERATION[command],
          resourceType: RESOURCE,
          resourceId: targetId,
          resourceVersion: done.version,
          outcome: 'SUCCESS',
          metadata: done.metadata,
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { user_id: targetId, command, membership_version: done.version } };
      },
    );
  }

  async #lockSystem(context: TransactionContext, known: SessionLookup, mode: 'read' | 'write'): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: mode, factor: 'read' });
    this.actor.assertLive(locked, await freshClockMs(context));
    return locked;
  }
}
