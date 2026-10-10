import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { DriverOnboardingState, OwnerDriverEligibility } from '../driver/driver-types';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { OwnerShopEligibility, ShopOnboardingState } from '../shop/shop-types';
import { TransactionManager } from '../transaction/transaction-manager';
import { PhoneVerificationStatus } from './account-origin';
import { effectiveActiveRole, roleContext } from './available-roles';
import { AUDIT_ACTIONS, isSupportedRole } from './auth-constants';
import { actorOf, AuthPrincipal } from './auth-principal';
import { SessionAuthorizationParticipant } from './session-authorization-participant';
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
  /** Display only (M00-D2), from the LOCKED user row: VERIFIED or UNVERIFIED_TEST. */
  readonly phone_verification_status: PhoneVerificationStatus;
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
    private readonly sessionAuth: SessionAuthorizationParticipant,
  ) {}

  /**
   * One coherent projection (A2S review addendum, extended by A2D, then by the post-merge router repair). The user
   * row is taken FOR SHARE and then the CURRENT session row FOR SHARE (through the Auth-owned participant) before
   * the roles and the Shop and Driver eligibility are read. Shop completion, Driver creation, role selection and a
   * revocation hold those rows FOR UPDATE until they commit, so /me either runs entirely before such a writer or
   * waits for it and then reads everything after its commit: the session state, the role list and the profile
   * statuses are one coherent state, never separate READ COMMITTED snapshots.
   *
   * The active role is read from the LOCKED session row, not from the principal the guard built before this
   * transaction began, and is reported only while it is still an available role (effectiveActiveRole). The session
   * is validated again here (revoked, expired at the fresh database clock, user disabled), so a /me that waited
   * behind a revocation answers with the session error instead of stale data.
   *
   * FOR SHARE, not FOR UPDATE: any number of /me calls of one user run together, and nothing is written. The
   * locks are taken in the order user, session: the same as every mutation, so no reverse order exists.
   */
  async me(principal: AuthPrincipal): Promise<MeProjection> {
    const view = await this.transactions.withTransaction(async (context) => {
      const { activeRole, phoneVerificationStatus } = await this.sessionAuth.lockAuthorizedActorShared(
        context,
        actorOf(principal),
      );
      const held = await this.users.supportedRoles(context, principal.userId);
      const shop = await this.shops.ownerShopEligibility(context, principal.userId);
      const driver = await this.drivers.ownerDriverEligibility(context, principal.userId);
      return { held, shop, driver, activeRole, phoneVerificationStatus };
    });
    return {
      ...this.#shape(
        principal.userId,
        principal.phoneNormalized,
        view.held,
        view.shop,
        view.driver,
        view.activeRole,
      ),
      onboarding: { shop: view.shop.onboarding, driver: view.driver.onboarding },
      phone_verification_status: view.phoneVerificationStatus,
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
      // User FOR UPDATE, then the current session FOR UPDATE, a fresh database clock after both waits, and the
      // error precedence SESSION_REVOKED, SESSION_EXPIRED, ACCOUNT_DISABLED: the same participant onboarding uses.
      await this.sessionAuth.lockAuthorizedActor(context, actorOf(principal));
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
    // The same rule as login: see roleContext. `activeRole` is what the session row stores; what is REPORTED is the
    // effective role (stored AND still available), so a stale role is never shown and never routed into.
    const context = roleContext(held, shop, driver, activeRole);
    return {
      user_id: userId,
      phone_normalized: phone,
      available_roles: context.available_roles,
      active_role: effectiveActiveRole(context.available_roles, activeRole),
      onboarding_required: context.onboarding_required,
      role_selection_required: context.role_selection_required,
    };
  }
}
