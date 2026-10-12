import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  CUSTOMER_PROFILE_MAX_VERSION,
  CUSTOMER_PROFILE_RESOURCE_TYPE,
  CUSTOMER_PROFILE_SCOPE_TYPE,
  CUSTOMER_PROFILE_UPDATE_AUDIT_ACTION,
  CUSTOMER_PROFILE_UPDATE_OPERATION_ID,
} from './customer-profile-constants';
import { CustomerProfileUpdateInput } from './customer-profile-validation';

/** The `data` of GET and PUT /v1/customer/me/profile. */
export type CustomerProfileView = { user_id: string; full_name: string | null; version: number };

/**
 * Own customer profile (M01.05): GET and PUT /v1/customer/me/profile.
 *
 * The caller is the authenticated principal and nothing else: no user id, selector or role comes from the request. Every
 * authorization that counts runs INSIDE the transaction through ClientSessionAuthority (the M01.04 primitive: user row, the
 * CURRENT session row, fresh database clock, client-session and platform gates, ordinary account), then the account must hold
 * the CUSTOMER role. Either app (FOOD or SHIP) may read and edit; no active context is required and none is changed.
 *
 * The name is the customer's profile name only. This service never touches the driver's legal name, bank data, consent,
 * roles or onboarding state, and it never creates a profile or grants a role: a CUSTOMER without a profile row reads null
 * and cannot update (ROLE_NOT_AVAILABLE), exactly like an account without the role.
 */
@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly customers: CustomerProfileRepository,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * GET. One read transaction: user FOR SHARE, session FOR SHARE, role, profile. It writes nothing (no audit, no outbox, no
   * idempotency record). A CUSTOMER without a profile row is a successful null, not an error.
   */
  async read(principal: AuthPrincipal): Promise<CustomerProfileView | null> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      await this.#requireCustomer(context, actor.userId);
      const profile = await this.customers.findProfile(context, actor.userId);
      return profile === undefined ? null : viewOf(actor.userId, profile.fullName, profile.version);
    });
  }

  /**
   * PUT. Lock order after the executor's own advisory and record locks: user row, session row, profile row. The role, the
   * profile's existence and expected_version are decided under those locks. One commit holds the new name and version, one
   * audit row (ids and versions only) and the encrypted idempotency result; any failure rolls all three back.
   *
   * A replay of a committed change does not apply it again: the hook re-checks the session and the role under the same
   * locks, then the stored result is returned as it was committed. expected_version is not compared again, the name is not
   * written again and the profile is never moved back to an older state. The scope is the user, so another valid session of
   * the same user can replay.
   */
  async update(
    principal: AuthPrincipal,
    input: CustomerProfileUpdateInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<CustomerProfileView> {
    const outcome = await this.executor.execute(
      {
        scopeType: CUSTOMER_PROFILE_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: CUSTOMER_PROFILE_UPDATE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { full_name: input.fullName, expected_version: input.expectedVersion },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            await this.#authorizeReplay(context, guard, principal);
            return true;
          },
        },
      },
      (context) => this.#update(context, principal, input, requestId),
    );
    // The stored result comes back with canonically sorted keys; rebuilding it keeps the documented key order for the first
    // execution and for every replay alike (the values are exactly the stored ones).
    const stored = outcome.payload as CustomerProfileView;
    return viewOf(stored.user_id, stored.full_name, stored.version);
  }

  async #update(context: TransactionContext, principal: AuthPrincipal, input: CustomerProfileUpdateInput, requestId: string) {
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#requireCustomer(context, actor.userId);

    const current = await this.customers.lockProfile(context, actor.userId);
    if (current === undefined) {
      // No profile row: it is never created here. Same answer as a missing role.
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    // A wrong version, and a version that cannot be raised within the schema bound, are the same conflict.
    if (current.version !== input.expectedVersion || current.version >= CUSTOMER_PROFILE_MAX_VERSION) {
      throw new AppError('VERSION_CONFLICT');
    }
    const updated = await this.customers.updateFullName(context, actor.userId, input.fullName, current.version);
    if (updated === undefined) {
      // Unreachable under the profile lock; fail closed rather than report a change that did not happen.
      throw new AppError('VERSION_CONFLICT');
    }

    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: actor.userId,
      action: CUSTOMER_PROFILE_UPDATE_AUDIT_ACTION,
      resourceType: CUSTOMER_PROFILE_RESOURCE_TYPE,
      resourceId: actor.userId,
      resourceVersion: updated.version,
      outcome: 'SUCCESS',
      metadata: { user_id: actor.userId, from_version: current.version, to_version: updated.version },
    });

    return {
      status: 200,
      replayGuard: { user_id: actor.userId },
      payload: viewOf(actor.userId, updated.fullName, updated.version),
    };
  }

  /** Replay authorization: same locks and order as the first execution, session and role only. Read-only. */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject, principal: AuthPrincipal): Promise<void> {
    const { user_id: userId } = guard;
    if (!isCanonicalUuid(userId) || userId !== principal.userId) {
      // A guard we did not write, or one that is not this caller's: fail closed, nothing is decrypted.
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#requireCustomer(context, actor.userId);
  }

  async #requireCustomer(context: TransactionContext, userId: string): Promise<void> {
    if (!(await this.users.hasRole(context, userId, CUSTOMER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }
}

function viewOf(userId: string, fullName: string | null, version: number): CustomerProfileView {
  return { user_id: userId, full_name: fullName, version };
}
