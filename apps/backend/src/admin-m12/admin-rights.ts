import { Injectable } from '@nestjs/common';
import { AdminAccountReadRepository, AdminApp, PermissionRow } from '../admin-accounts/admin-account-read-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError } from '../common/app-errors';
import { FinanceAccessRepository } from '../finance-access/finance-access-repository';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * What an administrator may do RIGHT NOW (M12). SYSTEM may do everything M12 shows. An ADMIN has only what the CURRENT rows say: the M01 app permissions
 * (view / review / lock per app) and the function grants SYSTEM gave one by one (admin_finance_grants, whose keys are format-only: wallet.read, report.read,
 * audit.read ...). Nothing is derived from another right "because they are in the same group".
 */
export class AdminRights {
  constructor(
    readonly role: AdminRole,
    readonly actorId: string,
    /** The PostgreSQL clock read after the actor's locks. */
    readonly nowMs: number,
    private readonly apps: ReadonlyMap<AdminApp, PermissionRow>,
    private readonly grants: ReadonlySet<string>,
  ) {}

  get isSystem(): boolean {
    return this.role === 'SYSTEM';
  }

  /** VIEW of an app (M01). */
  canViewApp(app: AdminApp): boolean {
    return this.isSystem || (this.apps.get(app)?.canView ?? false);
  }

  /** The delivery list and detail: VIEW on the SHOP or the DRIVER app, exactly as M07.07 decides it. */
  get canViewDeliveries(): boolean {
    return this.canViewApp('SHOP') || this.canViewApp('DRIVER');
  }

  /** Reading a recipient's contact and settling goods: VIEW and the review right on DRIVER. */
  get canReviewDeliveries(): boolean {
    return this.isSystem || ((this.apps.get('DRIVER')?.canView ?? false) && (this.apps.get('DRIVER')?.canReviewProfile ?? false));
  }

  get canLockDeliveries(): boolean {
    return this.isSystem || ((this.apps.get('DRIVER')?.canView ?? false) && (this.apps.get('DRIVER')?.canLock ?? false));
  }

  /** Shipper profiles waiting for review: VIEW and the review right on DRIVER. */
  get canReviewShippers(): boolean {
    return this.canReviewDeliveries;
  }

  /** A function grant (dotted key). SYSTEM holds every one. */
  has(key: string): boolean {
    return this.isSystem || this.grants.has(key);
  }

  require(key: string): void {
    if (!this.has(key)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
  }

  /** The grants this administrator holds, for the caller's own read. */
  heldGrants(): readonly string[] {
    return [...this.grants].sort();
  }
}

/**
 * Reads the actor's rights INSIDE a transaction, in the module's lock order: user, membership, factor, session (shared), then the database clock, then the
 * permission rows. A revoked right is therefore seen by the very next call of the actor: nothing is cached between calls.
 */
@Injectable()
export class AdminRightsReader {
  constructor(
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly grants: FinanceAccessRepository,
  ) {}

  async read(context: TransactionContext, known: SessionLookup): Promise<AdminRights> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      return new AdminRights(role, known.userId, nowMs, new Map(), new Set());
    }
    const rows = await this.permissions.permissions(context, known.userId);
    const held = (await this.grants.listForUser(context, known.userId)).filter((row) => row.state === 'GRANTED').map((row) => row.permissionKey);
    return new AdminRights(role, known.userId, nowMs, new Map(rows.map((row) => [row.app, row])), new Set(held));
  }
}
