import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { DriverOnboardingState, OwnerDriverEligibility } from '../driver/driver-types';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { OwnerShopEligibility, ShopOnboardingState } from '../shop/shop-types';
import { TransactionManager } from '../transaction/transaction-manager';
import { roleContext } from './available-roles';
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

/**
 * How far each onboarding got (M01-A2S, M01-A2D). Both come from the owner modules' read-only ports, never from
 * SQL of Auth. Nothing about approval details, wallet or bank is invented: `driver` only names the status of
 * the profile.
 */
export interface OnboardingProjection {
  readonly shop: ShopOnboardingState;
  readonly driver: DriverOnboardingState;
}

export interface MeProjection extends MeResult {
  readonly onboarding: OnboardingProjection;
}

/** /me and role selection (task sections 12 and 13). */
@Injectable()
export class RoleContextService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly shops: ShopEligibilityReader,
    private readonly drivers: DriverEligibilityReader,
  ) {}

  /**
   * One coherent projection (A2S review addendum, extended by A2D). The user row is taken FOR SHARE before the
   * roles and the Shop and Driver eligibility are read. Shop completion, Driver creation (and every other
   * writer of a user's roles or profile status) holds that row FOR UPDATE until it commits, so /me either runs
   * entirely before such a writer or waits for it and then reads everything after its commit. Without the lock
   * the reads are separate READ COMMITTED snapshots and a creation committing between them could show a PENDING
   * driver next to a role list without DRIVER.
   *
   * FOR SHARE, not FOR UPDATE: any number of /me calls of one user run together, and nothing is written. Only
   * this one lock is taken, at the root of the A2 lock order, so the order of the mutations is unchanged.
   */
  async me(principal: AuthPrincipal): Promise<MeProjection> {
    const view = await this.transactions.withTransaction(async (context) => {
      const user = await this.users.lockByIdForShare(context, principal.userId);
      if (user === undefined) {
        throw new AppError('SESSION_INVALID');
      }
      // Re-check after the lock: the guard read the status before this transaction began.
      if (user.status !== 'ACTIVE') {
        throw new AppError('ACCOUNT_DISABLED');
      }
      const held = await this.users.supportedRoles(context, principal.userId);
      const shop = await this.shops.ownerShopEligibility(context, principal.userId);
      const driver = await this.drivers.ownerDriverEligibility(context, principal.userId);
      return { held, shop, driver };
    });
    return {
      ...this.#shape(
        principal.userId,
        principal.phoneNormalized,
        view.held,
        view.shop,
        view.driver,
        principal.activeRole,
      ),
      onboarding: { shop: view.shop.onboarding, driver: view.driver.onboarding },
    };
  }

  /**
   * Lock order: user, then current session, then role membership. The user lock serializes every role
   * selection of one user, so two SHOP selections on two sessions run one after the other and the later one
   * revokes the earlier. The partial unique index is only the final safety net.
   *
   * SHOP is selectable only when the user holds the SHOP role AND owns an ACTIVE shop. DRIVER is selectable only
   * when the user holds the DRIVER role AND has a Driver profile that is not CLOSED (PENDING, SUSPENDED and
   * CLOSING stay selectable). Both are read through the owners' eligibility ports while the user lock is held;
   * every writer of a shop or driver takes that lock first, so the answer is stable for the rest of this
   * transaction.
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
      const shop = await this.shops.ownerShopEligibility(context, principal.userId);
      const driver = await this.drivers.ownerDriverEligibility(context, principal.userId);
      if (role === 'SHOP' && !shop.selectable) {
        // A stray SHOP role without an ACTIVE owned shop: same answer as a role the user does not hold.
        throw new AppError('ROLE_NOT_AVAILABLE');
      }
      if (role === 'DRIVER' && !driver.selectable) {
        // A stray DRIVER role without a Driver profile, or with a CLOSED one: the same answer.
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

      const held = await this.users.supportedRoles(context, principal.userId);
      return this.#shape(principal.userId, principal.phoneNormalized, held, shop, driver, role);
    });
  }

  #shape(
    userId: string,
    phone: string,
    held: readonly string[],
    shop: OwnerShopEligibility,
    driver: OwnerDriverEligibility,
    activeRole: string | null,
  ): MeResult {
    // The same rule as login: see roleContext.
    const context = roleContext(held, shop, driver, activeRole);
    return {
      user_id: userId,
      phone_normalized: phone,
      available_roles: context.available_roles,
      active_role: activeRole,
      onboarding_required: context.onboarding_required,
      role_selection_required: context.role_selection_required,
    };
  }
}
