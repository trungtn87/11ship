import { Injectable } from '@nestjs/common';
import { AccountOrigin, isAccountOrigin } from '../auth/account-origin';
import { epochMs, toSafeInteger } from '../auth/auth-db';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { FOLD_FROM, FOLD_TO } from './admin-account-read-validation';

// READ-ONLY projections for the administration web (M01-ADMIN account read). No INSERT, UPDATE, DELETE or lock clause here:
// the actor's locks are taken by the service before any of these runs, and a read changes nothing. Every value reaches the
// statement as a parameter; the text of a statement never contains anything the client sent.
//
// This file reads columns that other modules own (users, user_roles, customer_profiles, shops/shop_members, drivers). It is
// the one place allowed to do so; the owners' boundary specs name it explicitly. No password, hash, OTP, proof, TOTP, token,
// bank or GPS column is ever selected.

export type AdminApp = 'CUSTOMER' | 'SHOP' | 'DRIVER';
/** Storage names of user_roles. The public name of SHOP is SHOP_OWNER (mapped by the service). */
export type StorageRole = 'CUSTOMER' | 'SHOP' | 'DRIVER';

export interface PermissionRow {
  readonly app: AdminApp;
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  /** Dish-group management (SHOP only). Absent = false. */
  readonly canManageCatalog?: boolean;
}

/** What the actor may read, derived once from the CURRENT permission rows (SYSTEM: everything). */
export interface ReadScope {
  readonly system: boolean;
  readonly customer: boolean;
  readonly shop: boolean;
  readonly driver: boolean;
}

export interface UserSummaryRow {
  readonly userId: string;
  readonly phoneNormalized: string;
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly createdAtMs: number;
  /** created_at with microseconds, for the keyset cursor (a millisecond cursor would skip or repeat rows). */
  readonly createdAtUs: string;
  readonly roles: readonly StorageRole[];
  readonly displayName: string | null;
}

export interface UserDetailRow extends UserSummaryRow {
  readonly updatedAtMs: number;
  readonly version: number;
  readonly customer: { readonly fullName: string | null } | undefined;
  readonly shop: { readonly name: string; readonly status: string } | undefined;
  readonly driver: { readonly status: string } | undefined;
  /** Facts for the lock hint only (never sent): the origin/shape of the account and ALL its roles, not the projection in `roles`. */
  readonly lock: {
    readonly accountOrigin: AccountOrigin;
    readonly phoneVerified: boolean;
    readonly allRoles: readonly string[];
  };
  /** Why the account is locked (DISABLED rows only) and since when; older locks carry no reason (read as not self-recoverable). */
  readonly lockReason: 'DELETE_REQUEST' | 'VIOLATION' | 'SECURITY' | null;
  readonly lockedAtMs: number | null;
}

export interface AdministratorRow {
  readonly userId: string;
  readonly fullName: string;
  readonly phoneNormalized: string;
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly createdAtMs: number;
  readonly createdAtUs: string;
}

export interface SearchParams {
  /** Folded, LIKE-escaped (`!`) search text, or null. */
  readonly pattern: string | null;
  /** Digits after "+", or null. */
  readonly phoneDigits: string | null;
}

export interface UserListParams {
  readonly scope: ReadScope;
  readonly role: StorageRole | null;
  readonly status: 'ACTIVE' | 'DISABLED' | null;
  readonly search: SearchParams;
  readonly cursor: { readonly createdAtUs: string; readonly userId: string } | null;
  readonly fetch: number;
}

export interface AdministratorListParams {
  readonly status: 'ACTIVE' | 'DISABLED' | null;
  readonly search: SearchParams;
  readonly cursor: { readonly createdAtUs: string; readonly userId: string } | null;
  readonly fetch: number;
}

const US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SHOP_OWNER_JOIN = `LEFT JOIN LATERAL (
         SELECT s.name, s.status FROM app.shop_members m JOIN app.shops s ON s.shop_id = m.shop_id
          WHERE m.user_id = u.user_id AND m.member_role = 'OWNER' ORDER BY s.created_at, s.shop_id LIMIT 1
       ) sh ON true`;

/** USER = not provisioned by an administrator and not an administrator (even a DISABLED one). One row per user. */
const USER_BASE = `FROM app.users u
       LEFT JOIN app.customer_profiles cp ON cp.user_id = u.user_id
       ${SHOP_OWNER_JOIN}
       LEFT JOIN app.drivers dr ON dr.user_id = u.user_id
      WHERE u.account_scope = 'APP_USER'
        AND NOT EXISTS (SELECT 1 FROM app.admin_memberships am WHERE am.user_id = u.user_id)`;

/** Roles the actor can see (storage names). ADMIN without view of an app never sees that app's roles. */
export function visibleStorageRoles(scope: ReadScope): StorageRole[] {
  const roles: StorageRole[] = [];
  if (scope.customer) {
    roles.push('CUSTOMER');
  }
  if (scope.shop) {
    roles.push('SHOP');
  }
  if (scope.driver) {
    roles.push('DRIVER');
  }
  return roles;
}

const SCOPE_PARAMS = (scope: ReadScope): [StorageRole[], boolean, boolean, boolean, boolean] => [
  visibleStorageRoles(scope),
  scope.system,
  scope.customer,
  scope.shop,
  scope.driver,
];

interface RawUser {
  user_id: string;
  phone_normalized: string;
  status: 'ACTIVE' | 'DISABLED';
  created_ms: string;
  created_us: string;
  roles: StorageRole[];
  display_name: string | null;
}

function toSummary(row: RawUser): UserSummaryRow {
  return {
    userId: row.user_id,
    phoneNormalized: row.phone_normalized,
    status: row.status,
    createdAtMs: toSafeInteger(row.created_ms),
    createdAtUs: row.created_us,
    roles: row.roles,
    displayName: row.display_name,
  };
}

@Injectable()
export class AdminAccountReadRepository {
  /** The CURRENT permission rows of an ADMIN, sorted by app. Read under the actor's shared membership lock. */
  async permissions(context: TransactionContext, userId: string): Promise<PermissionRow[]> {
    const result = await context.query<{ app: AdminApp; can_view: boolean; can_review_profile: boolean; can_lock: boolean; can_manage_catalog: boolean }>(
      `SELECT app, can_view, can_review_profile, can_lock, can_manage_catalog FROM app.admin_app_permissions WHERE user_id = $1::uuid ORDER BY app`,
      [userId],
    );
    return result.rows.map((row) => ({
      app: row.app,
      canView: row.can_view,
      canReviewProfile: row.can_review_profile,
      canLock: row.can_lock,
      canManageCatalog: row.can_manage_catalog,
    }));
  }

  async listUsers(context: TransactionContext, params: UserListParams): Promise<UserSummaryRow[]> {
    const { scope, search } = params;
    const result = await context.query<RawUser>(
      `SELECT u.user_id, u.phone_normalized, u.status,
              ${epochMs('u.created_at')} AS created_ms,
              to_char(u.created_at AT TIME ZONE 'UTC', ${US}) AS created_us,
              ARRAY(SELECT r.role FROM app.user_roles r WHERE r.user_id = u.user_id AND r.role = ANY($1::text[]) ORDER BY r.role) AS roles,
              COALESCE(CASE WHEN $3::boolean THEN cp.full_name END, CASE WHEN $4::boolean THEN sh.name END, CASE WHEN $5::boolean THEN dr.full_name END) AS display_name
       ${USER_BASE}
        AND ($2::boolean OR EXISTS (SELECT 1 FROM app.user_roles r WHERE r.user_id = u.user_id AND r.role = ANY($1::text[])))
        AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM app.user_roles r WHERE r.user_id = u.user_id AND r.role = $6::text))
        AND ($7::text IS NULL OR u.status = $7::text)
        AND ($8::text IS NULL
             OR ($9::text IS NOT NULL AND substr(u.phone_normalized, 2) LIKE '%' || $9::text || '%')
             OR ($3::boolean AND lower(translate(COALESCE(cp.full_name, ''), $10::text, $11::text)) LIKE '%' || $8::text || '%' ESCAPE '!')
             OR ($4::boolean AND lower(translate(COALESCE(sh.name, ''), $10::text, $11::text)) LIKE '%' || $8::text || '%' ESCAPE '!')
             OR ($5::boolean AND lower(translate(COALESCE(dr.full_name, ''), $10::text, $11::text)) LIKE '%' || $8::text || '%' ESCAPE '!'))
        AND ($12::timestamptz IS NULL OR (u.created_at, u.user_id) < ($12::timestamptz, $13::uuid))
      ORDER BY u.created_at DESC, u.user_id DESC
      LIMIT $14::int`,
      [
        ...SCOPE_PARAMS(scope),
        params.role,
        params.status,
        search.pattern,
        search.phoneDigits,
        FOLD_FROM,
        FOLD_TO,
        params.cursor?.createdAtUs ?? null,
        params.cursor?.userId ?? null,
        params.fetch,
      ],
    );
    return result.rows.map(toSummary);
  }

  /** One USER inside the actor's scope; undefined for an id that does not exist AND for one outside the scope. */
  async userDetail(context: TransactionContext, scope: ReadScope, userId: string): Promise<UserDetailRow | undefined> {
    const result = await context.query<
      RawUser & {
        updated_ms: string;
        version: string;
        has_customer: boolean;
        customer_name: string | null;
        shop_name: string | null;
        shop_status: string | null;
        driver_status: string | null;
        account_origin: string;
        phone_verified: boolean;
        all_roles: string[];
        lock_reason: string | null;
        locked_ms: string | null;
      }
    >(
      `SELECT u.user_id, u.phone_normalized, u.status, u.version::text AS version,
              ${epochMs('u.created_at')} AS created_ms, ${epochMs('u.updated_at')} AS updated_ms,
              to_char(u.created_at AT TIME ZONE 'UTC', ${US}) AS created_us,
              ARRAY(SELECT r.role FROM app.user_roles r WHERE r.user_id = u.user_id AND r.role = ANY($1::text[]) ORDER BY r.role) AS roles,
              COALESCE(CASE WHEN $3::boolean THEN cp.full_name END, CASE WHEN $4::boolean THEN sh.name END, CASE WHEN $5::boolean THEN dr.full_name END) AS display_name,
              (cp.user_id IS NOT NULL) AS has_customer, cp.full_name AS customer_name,
              sh.name AS shop_name, sh.status AS shop_status, dr.status AS driver_status,
              u.account_origin, (u.phone_verified_at IS NOT NULL) AS phone_verified, u.lock_reason,
              CASE WHEN u.locked_at IS NULL THEN NULL ELSE ${epochMs('u.locked_at')} END AS locked_ms,
              ARRAY(SELECT r.role FROM app.user_roles r WHERE r.user_id = u.user_id ORDER BY r.role) AS all_roles
       ${USER_BASE}
        AND ($2::boolean OR EXISTS (SELECT 1 FROM app.user_roles r WHERE r.user_id = u.user_id AND r.role = ANY($1::text[])))
        AND u.user_id = $6::uuid`,
      [...SCOPE_PARAMS(scope), userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (!isAccountOrigin(row.account_origin)) {
      throw new TechnicalError('internal', 'Database returned an unexpected account origin');
    }
    return {
      ...toSummary(row),
      lock: { accountOrigin: row.account_origin, phoneVerified: row.phone_verified, allRoles: row.all_roles },
      lockReason: row.lock_reason === 'DELETE_REQUEST' || row.lock_reason === 'VIOLATION' || row.lock_reason === 'SECURITY' ? row.lock_reason : null,
      lockedAtMs: row.locked_ms === null ? null : toSafeInteger(row.locked_ms),
      updatedAtMs: toSafeInteger(row.updated_ms),
      version: toSafeInteger(row.version),
      customer: scope.customer && row.has_customer ? { fullName: row.customer_name } : undefined,
      shop: scope.shop && row.shop_name !== null ? { name: row.shop_name, status: row.shop_status ?? '' } : undefined,
      driver: scope.driver && row.driver_status !== null ? { status: row.driver_status } : undefined,
    };
  }

  /** Activated ADMINs only (membership + profile). Never SYSTEM, never an invitation. */
  async listAdministrators(context: TransactionContext, params: AdministratorListParams): Promise<AdministratorRow[]> {
    const { search } = params;
    const result = await context.query<{
      user_id: string;
      full_name: string;
      phone_normalized: string;
      eff_status: 'ACTIVE' | 'DISABLED';
      created_ms: string;
      created_us: string;
    }>(
      `SELECT am.user_id, ap.full_name, u.phone_normalized,
              CASE WHEN u.status = 'ACTIVE' AND am.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'DISABLED' END AS eff_status,
              ${epochMs('am.created_at')} AS created_ms,
              to_char(am.created_at AT TIME ZONE 'UTC', ${US}) AS created_us
         FROM app.admin_memberships am
         JOIN app.users u ON u.user_id = am.user_id
         JOIN app.admin_profiles ap ON ap.user_id = am.user_id
        WHERE am.admin_role = 'ADMIN'
          AND ($1::text IS NULL OR $1::text = CASE WHEN u.status = 'ACTIVE' AND am.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'DISABLED' END)
          AND ($2::text IS NULL
               OR ($3::text IS NOT NULL AND substr(u.phone_normalized, 2) LIKE '%' || $3::text || '%')
               OR lower(translate(ap.full_name, $4::text, $5::text)) LIKE '%' || $2::text || '%' ESCAPE '!')
          AND ($6::timestamptz IS NULL OR (am.created_at, am.user_id) < ($6::timestamptz, $7::uuid))
        ORDER BY am.created_at DESC, am.user_id DESC
        LIMIT $8::int`,
      [
        params.status,
        search.pattern,
        search.phoneDigits,
        FOLD_FROM,
        FOLD_TO,
        params.cursor?.createdAtUs ?? null,
        params.cursor?.userId ?? null,
        params.fetch,
      ],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      phoneNormalized: row.phone_normalized,
      status: row.eff_status,
      createdAtMs: toSafeInteger(row.created_ms),
      createdAtUs: row.created_us,
    }));
  }

  /** The permission rows of the given administrators, grouped by user. */
  async permissionsOf(context: TransactionContext, userIds: readonly string[]): Promise<Map<string, PermissionRow[]>> {
    const grouped = new Map<string, PermissionRow[]>();
    if (userIds.length === 0) {
      return grouped;
    }
    const result = await context.query<{ user_id: string; app: AdminApp; can_view: boolean; can_review_profile: boolean; can_lock: boolean; can_manage_catalog: boolean }>(
      `SELECT user_id, app, can_view, can_review_profile, can_lock, can_manage_catalog FROM app.admin_app_permissions
        WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, app`,
      [userIds],
    );
    for (const row of result.rows) {
      const list = grouped.get(row.user_id) ?? [];
      list.push({ app: row.app, canView: row.can_view, canReviewProfile: row.can_review_profile, canLock: row.can_lock, canManageCatalog: row.can_manage_catalog });
      grouped.set(row.user_id, list);
    }
    return grouped;
  }
}
