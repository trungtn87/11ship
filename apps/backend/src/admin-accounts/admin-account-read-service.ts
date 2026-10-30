import { Inject, Injectable } from '@nestjs/common';
import { AccountActivityRegistry } from '../account-lifecycle/account-activity-registry';
import { detailAllowedActions } from '../admin-account-lock/admin-account-lock-policy';
import { AdminCrypto } from '../admin-auth/admin-crypto';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { maskPhone } from '../admin-provisioning/admin-provisioning-views';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy } from '../auth/account-origin';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  AdminApp,
  AdminAccountReadRepository,
  PermissionRow,
  ReadScope,
  StorageRole,
  UserSummaryRow,
  visibleStorageRoles,
} from './admin-account-read-repository';
import {
  AdministratorListQuery,
  encodeCursor,
  escapeLike,
  foldSearchText,
  phoneSearchDigits,
  PublicRole,
  RawCursor,
  UserListQuery,
} from './admin-account-read-validation';

const CURSOR_ACTION = 'admin-account-read.cursor.v1';
const APP_ORDER: readonly AdminApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];

const PUBLIC_OF: Readonly<Record<StorageRole, PublicRole>> = { CUSTOMER: 'CUSTOMER', SHOP: 'SHOP_OWNER', DRIVER: 'DRIVER' };
const STORAGE_OF: Readonly<Record<PublicRole, StorageRole>> = { CUSTOMER: 'CUSTOMER', SHOP_OWNER: 'SHOP', DRIVER: 'DRIVER' };

const iso = (ms: number): string => new Date(ms).toISOString();

interface Authorized {
  readonly locked: LockedActor;
  readonly userId: string;
  readonly role: AdminRole;
  readonly membershipVersion: number;
  /** The CURRENT permission rows, fixed order. SYSTEM: the three scopes with every right true (the system role's rights). */
  readonly permissions: readonly PermissionRow[];
  readonly scope: ReadScope;
}

function ordered(rows: readonly PermissionRow[]): PermissionRow[] {
  return [...rows].sort((a, b) => APP_ORDER.indexOf(a.app) - APP_ORDER.indexOf(b.app));
}

function permissionView(row: PermissionRow): JsonObject {
  return { app: row.app, can_view: row.canView, can_review_profile: row.canReviewProfile, can_lock: row.canLock, can_manage_catalog: row.canManageCatalog === true, can_manage_shops: row.canManageShops === true };
}

/**
 * Read side of the administration accounts: the actor's own permissions, the USER list/detail inside the actor's scope and
 * the list of activated ADMINs (SYSTEM only). Every read re-authorizes under the actor's shared locks in the module order
 * (user -> membership -> factor -> session), reads the permissions and the database clock after the last lock, and writes
 * nothing: no audit, no outbox, no idempotency record. Scope is applied in SQL; nothing is fetched and then hidden.
 */
@Injectable()
export class AdminAccountReadService {
  readonly #lockTimeoutMs: number;
  readonly #lockGateOpen: boolean;
  /** The (terms, privacy) pair the server accepts for a registration now, or undefined when none is configured. */
  readonly #currentConsent: { readonly termsVersion: string; readonly privacyVersion: string } | undefined;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly reader: AdminAccountReadRepository,
    private readonly crypto: AdminCrypto,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy,
    private readonly activity: AccountActivityRegistry,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
    this.#lockGateOpen = appConfig.adminUserAccountMutations?.enabled === true;
    this.#currentConsent = appConfig.clientAuth;
  }

  async permissions(sessionToken: string | undefined): Promise<JsonObject> {
    return this.#read(sessionToken, async (auth) => ({
      admin_role: auth.role,
      permissions: auth.permissions.map(permissionView),
    }));
  }

  async listUsers(sessionToken: string | undefined, query: UserListQuery): Promise<JsonObject> {
    return this.#read(sessionToken, async (auth, context) => {
      const visible = visibleStorageRoles(auth.scope);
      if (visible.length === 0) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const role = query.role === null ? null : STORAGE_OF[query.role];
      if (role !== null && !visible.includes(role)) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const filter = { q: query.q, role: query.role, status: query.status };
      const cursor = this.#verifiedCursor(query.cursor, 'users', auth, filter);
      const rows = await this.reader.listUsers(context, {
        scope: auth.scope,
        role,
        status: query.status,
        search: searchOf(query.q),
        cursor,
        fetch: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(userSummaryView),
        next_cursor: rows.length > query.limit && last !== undefined ? this.#newCursor('users', auth, filter, last) : null,
        available_role_filters: visible.map((item) => PUBLIC_OF[item]),
      };
    });
  }

  async userDetail(sessionToken: string | undefined, userId: string): Promise<JsonObject> {
    return this.#read(sessionToken, async (auth, context) => {
      if (visibleStorageRoles(auth.scope).length === 0) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const row = await this.reader.userDetail(context, auth.scope, userId);
      if (row === undefined) {
        throw new AppError('USER_NOT_AVAILABLE');
      }
      const profiles: JsonObject = {};
      if (row.customer !== undefined) {
        profiles.customer = { full_name: row.customer.fullName };
      }
      if (row.shop !== undefined) {
        profiles.shop = { name: row.shop.name, status: row.shop.status };
      }
      if (row.driver !== undefined) {
        profiles.driver = { status: row.driver.status };
      }
      // The lifecycle facts the screen shows (Owner decision 2026-10-14): is the phone proven, why is the account locked, which business data
      // it has (names only), which orders/deliveries are still being processed, what a delete would do and what blocks a lock or a delete.
      const relatedData = await this.activity.relatedData(context, userId);
      const activeWork = await this.activity.activeWork(context, userId);
      const lockBlocked = row.status === 'DISABLED' ? 'ALREADY_LOCKED' : activeWork.length > 0 ? 'ACTIVE_WORK' : null;
      const deleteBlocked =
        relatedData.length === 0 ? null : row.status === 'DISABLED' ? 'ALREADY_LOCKED' : activeWork.length > 0 ? 'ACTIVE_WORK' : null;
      return {
        ...userSummaryView(row),
        updated_at: iso(row.updatedAtMs),
        version: row.version,
        profiles,
        phone_verified: row.lock.phoneVerified,
        consent: await this.#consentView(context, userId),
        lifecycle: {
          lock_reason: row.lockReason,
          locked_at: row.lockedAtMs === null ? null : iso(row.lockedAtMs),
          related_data: relatedData,
          active_work: activeWork,
          delete_effect: relatedData.length === 0 ? 'DELETE_PERMANENTLY' : 'LOCK',
          lock_blocked_reason: lockBlocked,
          delete_blocked_reason: deleteBlocked,
        },
        // A hint for the screen: the mutation re-checks everything under locks. It follows D15 (full-domain view + lock for an
        // ADMIN, ordinary accounts only) and the local gate; anything missing means no action.
        allowed_actions: detailAllowedActions({ policy: this.originPolicy, actor: auth, row, gateOpen: this.#lockGateOpen }),
      };
    });
  }

  /**
   * Which versions the account accepted and when, and whether it accepted the CURRENT pair (null when no pair is configured). Matching is by
   * the exact pair: a changed text under a new version is a new pair, so an older acceptance never counts as the new one.
   */
  async #consentView(context: TransactionContext, userId: string): Promise<JsonObject> {
    const history = await this.reader.consentHistory(context, userId);
    const current = this.#currentConsent;
    return {
      current: current === undefined ? null : { terms_version: current.termsVersion, privacy_version: current.privacyVersion },
      accepted_current: current === undefined ? null : history.some((row) => row.termsVersion === current.termsVersion && row.privacyVersion === current.privacyVersion),
      history: history.map((row) => ({ terms_version: row.termsVersion, privacy_version: row.privacyVersion, accepted_at: iso(row.acceptedAtMs), client_app: row.clientApp })),
    };
  }

  async listAdministrators(sessionToken: string | undefined, query: AdministratorListQuery): Promise<JsonObject> {
    return this.#read(sessionToken, async (auth, context) => {
      if (auth.role !== 'SYSTEM') {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const filter = { q: query.q, status: query.status };
      const cursor = this.#verifiedCursor(query.cursor, 'administrators', auth, filter);
      const rows = await this.reader.listAdministrators(context, {
        status: query.status,
        search: searchOf(query.q),
        cursor,
        fetch: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const permissions = await this.reader.permissionsOf(
        context,
        page.map((row) => row.userId),
      );
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          user_id: row.userId,
          full_name: row.fullName,
          phone_masked: maskPhone(row.phoneNormalized),
          admin_role: 'ADMIN',
          status: row.status,
          permissions: ordered(permissions.get(row.userId) ?? []).map(permissionView),
          created_at: iso(row.createdAtMs),
        })),
        next_cursor: rows.length > query.limit && last !== undefined ? this.#newCursor('administrators', auth, filter, last) : null,
      };
    });
  }

  // ----- shared steps ---------------------------------------------------------------------------------------------

  async #read<T>(sessionToken: string | undefined, work: (auth: Authorized, context: TransactionContext) => Promise<T>): Promise<T> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<T> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const role = locked.checked.membership.adminRole;
      const rows = role === 'ADMIN' ? await this.reader.permissions(context, known.userId) : [];
      // The database clock is read only now, after the last lock was granted.
      const nowMs = await freshClockMs(context);
      this.actor.assertSessionLive(locked, nowMs);
      const permissions =
        role === 'SYSTEM'
          ? APP_ORDER.map((app): PermissionRow => ({ app, canView: true, canReviewProfile: true, canLock: true, canManageCatalog: app === 'SHOP', canManageShops: app === 'SHOP' }))
          : ordered(rows);
      const scope: ReadScope =
        role === 'SYSTEM'
          ? { system: true, customer: true, shop: true, driver: true }
          : {
              system: false,
              customer: permissions.some((row) => row.app === 'CUSTOMER' && row.canView),
              shop: permissions.some((row) => row.app === 'SHOP' && row.canView),
              driver: permissions.some((row) => row.app === 'DRIVER' && row.canView),
            };
      return work(
        { locked, userId: known.userId, role, membershipVersion: locked.checked.membership.version, permissions, scope },
        context,
      );
    });
  }

  /** The payload the cursor is bound to: endpoint, filter, actor, membership version and the CURRENT permission fingerprint. */
  #bindingPayload(endpoint: string, auth: Authorized, filter: object): object {
    return {
      endpoint,
      filter,
      actor: auth.userId,
      membership_version: auth.membershipVersion,
      scope: auth.permissions.map((row) => `${row.app}:${row.canView ? 'V' : '-'}${row.canReviewProfile ? 'R' : '-'}${row.canLock ? 'L' : '-'}${row.canManageCatalog === true ? 'C' : ''}${row.canManageShops === true ? 'S' : ''}`),
    };
  }

  #newCursor(endpoint: string, auth: Authorized, filter: object, last: { createdAtUs: string; userId: string }): string {
    const bound = this.crypto.operationFingerprint(CURSOR_ACTION, this.#bindingPayload(endpoint, auth, filter));
    return encodeCursor({ createdAtUs: last.createdAtUs, userId: last.userId, keyId: bound.keyId, binding: bound.fingerprint });
  }

  /** A cursor issued for another endpoint, filter, actor, membership version or permission set is refused, never reinterpreted. */
  #verifiedCursor(
    raw: RawCursor | null,
    endpoint: string,
    auth: Authorized,
    filter: object,
  ): { createdAtUs: string; userId: string } | null {
    if (raw === null) {
      return null;
    }
    let matches = false;
    try {
      matches = this.crypto.operationFingerprintMatches({
        keyId: raw.keyId,
        action: CURSOR_ACTION,
        canonicalPayload: this.#bindingPayload(endpoint, auth, filter),
        stored: raw.binding,
      });
    } catch {
      matches = false;
    }
    if (!matches) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { createdAtUs: raw.createdAtUs, userId: raw.userId };
  }
}

function searchOf(q: string | null): { pattern: string | null; phoneDigits: string | null } {
  if (q === null) {
    return { pattern: null, phoneDigits: null };
  }
  return { pattern: escapeLike(foldSearchText(q)), phoneDigits: phoneSearchDigits(q) };
}

function userSummaryView(row: UserSummaryRow): JsonObject {
  return {
    user_id: row.userId,
    display_name: row.displayName,
    phone_masked: maskPhone(row.phoneNormalized),
    roles_visible: row.roles.map((item) => PUBLIC_OF[item]),
    account_status: row.status,
    created_at: iso(row.createdAtMs),
  };
}
