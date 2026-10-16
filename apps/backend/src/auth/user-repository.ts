import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountOrigin, isAccountOrigin } from './account-origin';
import { SUPPORTED_ROLES } from './auth-constants';
import { CLOCK_CTE } from './auth-db';

export type UserStatus = 'ACTIVE' | 'DISABLED';

/**
 * The two independent identity scopes (Owner decision 2026-10-14). ADMIN_WEB = SYSTEM and ADMIN (the administration web only);
 * APP_USER = CUSTOMER / SHOP_OWNER / DRIVER (11Food and 11Ship only). A phone number is unique inside a scope and may exist once
 * in each. The scope is chosen by the CODE PATH that reads or writes (administration module vs application module), never
 * from anything a request carries.
 */
export type AccountScope = 'ADMIN_WEB' | 'APP_USER';

/** Why a DISABLED account is locked. DELETE_REQUEST is the only reason the owner may undo by recovering the account. */
export type LockReason = 'DELETE_REQUEST' | 'VIOLATION' | 'SECURITY';

export function isLockReason(value: unknown): value is LockReason {
  return value === 'DELETE_REQUEST' || value === 'VIOLATION' || value === 'SECURITY';
}

/**
 * Where an account came from. It carries NO privilege (see account-origin.ts, which owns the type and the policy):
 * the application (customer/shop/driver) Auth accepts PHONE_VERIFIED accounts, STAGING_FIXTURE accounts only in
 * staging fixture mode and TEST_UNVERIFIED accounts only in the no-proof test mode; ADMIN_PROVISIONED accounts exist for the administration web and are refused by every
 * application login and session check. Re-exported so the modules that already import it from here keep working.
 */
export type { AccountOrigin } from './account-origin';

export interface UserRow {
  readonly userId: string;
  readonly phoneNormalized: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly accountOrigin: AccountOrigin;
  readonly accountScope: AccountScope;
  /** Present only while DISABLED; a DISABLED row without a recorded reason (older rows) reads as undefined = not self-recoverable. */
  readonly lockReason?: LockReason;
}

interface RawUser {
  user_id: string;
  phone_normalized: string;
  password_hash: string;
  status: UserStatus;
  account_origin: string;
  account_scope: AccountScope;
  lock_reason: string | null;
}


function toUser(row: RawUser): UserRow {
  if (!isAccountOrigin(row.account_origin)) {
    // The CHECK constraint makes this unreachable; refuse rather than guess an origin.
    throw new TechnicalError('internal', 'Database returned an unexpected account origin');
  }
  return {
    userId: row.user_id,
    phoneNormalized: row.phone_normalized,
    passwordHash: row.password_hash,
    status: row.status,
    accountOrigin: row.account_origin,
    accountScope: row.account_scope,
    ...(isLockReason(row.lock_reason) ? { lockReason: row.lock_reason } : {}),
  };
}

/** What the administration lock/unlock (M01-ADMIN, D15) needs to decide on one ordinary account. Nothing secret. */
export interface AdminLockTargetRow {
  readonly userId: string;
  readonly phoneNormalized: string;
  readonly status: UserStatus;
  readonly version: number;
  readonly accountOrigin: AccountOrigin;
  readonly accountScope: AccountScope;
  /** phone_verified_at is set: one input of the ordinary-account row-shape rule. */
  readonly phoneVerified: boolean;
  readonly hasAdminMembership: boolean;
  /** Why the account is locked (DISABLED rows only; older rows carry none). */
  readonly lockReason?: LockReason;
}

/** What the no-OTP test password reset (M01-RESET) classifies on a locked row. Nothing secret. */
export type ResetTargetRow = AdminLockTargetRow;

interface RawResetTarget {
  user_id: string;
  phone_normalized: string;
  status: UserStatus;
  version: string;
  account_origin: string;
  account_scope: AccountScope;
  lock_reason: string | null;
  phone_verified: boolean;
  has_membership: boolean;
}

function toResetTarget(row: RawResetTarget | undefined): ResetTargetRow | undefined {
  if (row === undefined) {
    return undefined;
  }
  if (!isAccountOrigin(row.account_origin)) {
    throw new TechnicalError('internal', 'Database returned an unexpected account origin');
  }
  return {
    userId: row.user_id,
    phoneNormalized: row.phone_normalized,
    status: row.status,
    version: Number(row.version),
    accountOrigin: row.account_origin,
    accountScope: row.account_scope,
    phoneVerified: row.phone_verified,
    hasAdminMembership: row.has_membership,
    ...(isLockReason(row.lock_reason) ? { lockReason: row.lock_reason } : {}),
  };
}

/** SQL for users and user_roles. */
@Injectable()
export class UserRepository {
  /** True when the phone already belongs to an account OF THIS SCOPE (the same number may exist once in the other scope). */
  async isPhoneRegistered(context: TransactionContext, scope: AccountScope, phoneNormalized: string): Promise<boolean> {
    const result = await context.query('SELECT 1 FROM app.users WHERE account_scope = $1 AND phone_normalized = $2', [
      scope,
      phoneNormalized,
    ]);
    return result.rows.length > 0;
  }

  async findByPhone(context: TransactionContext, scope: AccountScope, phoneNormalized: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin, account_scope, lock_reason
         FROM app.users WHERE account_scope = $1 AND phone_normalized = $2`,
      [scope, phoneNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async lockById(context: TransactionContext, userId: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin, account_scope, lock_reason
         FROM app.users WHERE user_id = $1::uuid FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  /**
   * A shared row lock on the user, for a reader that must see one coherent state of everything the user lock
   * guards (roles, owned shop status). It waits for a writer holding the row FOR UPDATE and lets other
   * FOR SHARE readers through. The caller re-checks the returned status; nothing is written.
   */
  async lockByIdForShare(context: TransactionContext, userId: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin, account_scope, lock_reason
         FROM app.users WHERE user_id = $1::uuid FOR SHARE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async findById(context: TransactionContext, userId: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin, account_scope, lock_reason
         FROM app.users WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  /**
   * Creates the ACTIVE user, taking phone_verified_at from the verification that backed the proof. Returns
   * false when the phone number already belongs to a user (the UNIQUE constraint decided, possibly a race).
   * No role is ever written here: a new account is roleless.
   */
  async insertRegistered(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string; proofId: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.users (
         user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, v.verified_at, 'PHONE_VERIFIED', 'ACTIVE', 1, clock.t, clock.t
         FROM app.verification_proofs p
         JOIN app.phone_verifications v ON v.verification_id = p.verification_id
        CROSS JOIN (${CLOCK_CTE}) AS clock
        WHERE p.proof_id = $4::uuid AND v.verified_at IS NOT NULL
       ON CONFLICT (account_scope, phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash, input.proofId],
    );
    if (result.rowCount === 1) {
      return true;
    }
    // Either the phone is taken (the expected conflict) or the verification join found nothing. Tell them
    // apart so a broken invariant is never reported as "phone already registered".
    const taken = await this.isPhoneRegistered(context, 'APP_USER', input.phoneNormalized);
    if (!taken) {
      throw new TechnicalError('internal', 'User was not written');
    }
    return false;
  }

  /**
   * Creates an ACTIVE administration-provisioned account (no phone verification: phone_verified_at stays NULL and
   * no proof is invented). Returns false when the phone number already belongs to a user. No role is written.
   */
  async insertAdminProvisioned(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.users (
         user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (account_scope, phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash],
    );
    return result.rowCount === 1;
  }

  /**
   * Creates one ACTIVE STAGING_FIXTURE account: roleless, phone_verified_at NULL (the phone was never proven),
   * timestamps from the database clock. Returns false when the phone number already belongs to a user (the UNIQUE
   * constraint decided); an existing account is NEVER touched: no password reset, no status change, no role.
   * Used only by the operator seed command (M00-D2); no HTTP path reaches it.
   */
  async insertStagingFixture(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.users (
         user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, NULL, 'STAGING_FIXTURE', 'ACTIVE', 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (account_scope, phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash],
    );
    return result.rowCount === 1;
  }

  /**
   * Creates one ACTIVE TEST_UNVERIFIED account for the no-proof test registration (CLIENT_AUTH_PHONE_VERIFICATION_MODE=
   * DISABLED_TEST): phone_verified_at stays NULL (the phone was never proven and no proof is invented), timestamps come from
   * the database clock. Returns false when the phone number already belongs to a user (the UNIQUE constraint decided, possibly
   * a race); an existing account is NEVER touched. No role is written here.
   */
  async insertUnverifiedTest(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.users (
         user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, NULL, 'TEST_UNVERIFIED', 'ACTIVE', 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (account_scope, phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash],
    );
    return result.rowCount === 1;
  }

  /**
   * Creates one ACTIVE PHONE_UNVERIFIED account: registered while the SYSTEM setting otp_registration_enabled is OFF. The phone
   * was never proven and nothing pretends it was (phone_verified_at stays NULL; the origin says why). Returns false when the
   * phone already belongs to an APP_USER account (the unique pair decided, possibly a race); an existing account is NEVER touched.
   * No role is written here.
   */
  async insertPhoneUnverified(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.users (
         user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
         created_at, updated_at
       )
       SELECT $1::uuid, $2, $3, NULL, 'PHONE_UNVERIFIED', 'ACTIVE', 1, clock.t, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (account_scope, phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash],
    );
    return result.rowCount === 1;
  }

  /**
   * Permanently removes an APP_USER account and its OWN rows (sessions with their device bindings, consents, customer profile, roles,
   * the user row) through app.purge_app_user. The function itself refuses an administration account and an account with a shop
   * membership or a driver profile (23503), so even a caller that skipped the lifecycle checks cannot delete business data. Returns
   * false when no such APP_USER row exists. The caller holds the user row FOR UPDATE and has revoked nothing it still needs.
   */
  async purgeAppUser(context: TransactionContext, userId: string): Promise<boolean> {
    const result = await context.query<{ purged: boolean }>('SELECT app.purge_app_user($1::uuid) AS purged', [userId]);
    return result.rows[0]?.purged === true;
  }

  /** Sorted supported business roles of the user (SHOP, DRIVER). */
  async supportedRoles(context: TransactionContext, userId: string): Promise<string[]> {
    const result = await context.query<{ role: string }>(
      `SELECT role FROM app.user_roles
        WHERE user_id = $1::uuid AND role = ANY($2::text[])
        ORDER BY role`,
      [userId, [...SUPPORTED_ROLES]],
    );
    return result.rows.map((row) => row.role);
  }

  /**
   * The roles of the given set the user holds, sorted. Pure membership read (M01.03 identity): whether a role is
   * SELECTABLE is decided elsewhere, from the owners' eligibility ports.
   */
  async rolesAmong(context: TransactionContext, userId: string, roles: readonly string[]): Promise<string[]> {
    const result = await context.query<{ role: string }>(
      `SELECT role FROM app.user_roles
        WHERE user_id = $1::uuid AND role = ANY($2::text[])
        ORDER BY role`,
      [userId, [...roles]],
    );
    return result.rows.map((row) => row.role);
  }

  async hasRole(context: TransactionContext, userId: string, role: string): Promise<boolean> {
    const result = await context.query('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = $2', [
      userId,
      role,
    ]);
    return result.rows.length > 0;
  }

  /**
   * Idempotent grant: inserts the (user, role) row unless it already exists. Returns true when this call
   * created it, false when the user already held the role. The caller holds the user row lock; nothing here
   * decides WHICH roles may be granted (RoleGrantParticipant does).
   */
  async grantRole(context: TransactionContext, userId: string, role: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.user_roles (user_id, role, created_at)
       SELECT $1::uuid, $2, clock.t
         FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role],
    );
    return result.rowCount === 1;
  }

  /**
   * The account that an administrator wants to lock or unlock, never an administration account: an ADMIN_PROVISIONED row is
   * not selected at all (so it is not locked either), and the database already refuses a membership on any other origin.
   * 'write' = FOR UPDATE, 'read' = FOR SHARE (replay authorization). The caller applies the account origin policy.
   */
  async lockAdminTarget(context: TransactionContext, userId: string, mode: 'write' | 'read'): Promise<AdminLockTargetRow | undefined> {
    const columns = `SELECT u.user_id, u.phone_normalized, u.status, u.version::text AS version, u.account_origin, u.account_scope, u.lock_reason,
              (u.phone_verified_at IS NOT NULL) AS phone_verified,
              EXISTS (SELECT 1 FROM app.admin_memberships am WHERE am.user_id = u.user_id) AS has_membership
         FROM app.users u
        WHERE u.user_id = $1::uuid AND u.account_scope = 'APP_USER'`;
    // Two fixed statements (never an interpolated lock clause): the writer lock of the command, the shared lock of a replay check.
    const result = await context.query<{
      user_id: string;
      phone_normalized: string;
      status: UserStatus;
      version: string;
      account_origin: string;
      account_scope: AccountScope;
      lock_reason: string | null;
      phone_verified: boolean;
      has_membership: boolean;
    }>(mode === 'write' ? columns + ' FOR UPDATE OF u' : columns + ' FOR SHARE OF u', [userId]);
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (!isAccountOrigin(row.account_origin)) {
      throw new TechnicalError('internal', 'Database returned an unexpected account origin');
    }
    return {
      userId: row.user_id,
      phoneNormalized: row.phone_normalized,
      status: row.status,
      version: Number(row.version),
      accountOrigin: row.account_origin,
      accountScope: row.account_scope,
      phoneVerified: row.phone_verified,
      hasAdminMembership: row.has_membership,
      ...(isLockReason(row.lock_reason) ? { lockReason: row.lock_reason } : {}),
    };
  }

  /** Every role row of the user (sorted), whatever its name: the lock decision looks at the FULL set. */
  async allRoles(context: TransactionContext, userId: string): Promise<string[]> {
    const result = await context.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [userId]);
    return result.rows.map((row) => row.role);
  }

  /**
   * ACTIVE <-> DISABLED at the expected version, version + 1, database time. The caller holds the row FOR UPDATE; undefined
   * means the row no longer matches (nothing was written). Locking records the reason and the time; unlocking clears both.
   * Roles, profile and password are not touched.
   */
  async setAccountStatus(
    context: TransactionContext,
    input: { userId: string; from: UserStatus; to: UserStatus; expectedVersion: number; lockReason?: LockReason },
  ): Promise<{ version: number; changedAtMs: number } | undefined> {
    if ((input.to === 'DISABLED') !== (input.lockReason !== undefined)) {
      throw new TechnicalError('internal', 'A lock needs a reason and an unlock must not carry one');
    }
    const result = await context.query<{ version: string; changed_ms: string }>(
      `UPDATE app.users
          SET status = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
              lock_reason = $5::varchar,
              locked_at = CASE WHEN $5::varchar IS NULL THEN NULL ELSE date_trunc('milliseconds', clock_timestamp()) END
        WHERE user_id = $1::uuid AND status = $2 AND version = $4::bigint
        RETURNING version::text AS version, (extract(epoch FROM updated_at) * 1000)::bigint::text AS changed_ms`,
      [input.userId, input.from, input.to, input.expectedVersion, input.lockReason ?? null],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { version: Number(row.version), changedAtMs: Number(row.changed_ms) };
  }

  /**
   * The account a no-OTP test password reset (M01-RESET) targets, write-locked by id (the caller found the id by phone,
   * unlocked, and re-checks the phone here). Any origin is returned, ADMIN_PROVISIONED included: the caller classifies the row.
   */
  async lockResetTarget(context: TransactionContext, userId: string): Promise<ResetTargetRow | undefined> {
    const result = await context.query<RawResetTarget>(
      `SELECT u.user_id, u.phone_normalized, u.status, u.version::text AS version, u.account_origin, u.account_scope, u.lock_reason,
              (u.phone_verified_at IS NOT NULL) AS phone_verified,
              EXISTS (SELECT 1 FROM app.admin_memberships am WHERE am.user_id = u.user_id) AS has_membership
         FROM app.users u
        WHERE u.user_id = $1::uuid
          FOR UPDATE OF u`,
      [userId],
    );
    return toResetTarget(result.rows[0]);
  }

  /** The same row as lockResetTarget, read WITHOUT a lock (the read-only check of the local SYSTEM recovery). */
  async readResetTarget(context: TransactionContext, userId: string): Promise<ResetTargetRow | undefined> {
    const result = await context.query<RawResetTarget>(
      `SELECT u.user_id, u.phone_normalized, u.status, u.version::text AS version, u.account_origin, u.account_scope, u.lock_reason,
              (u.phone_verified_at IS NOT NULL) AS phone_verified,
              EXISTS (SELECT 1 FROM app.admin_memberships am WHERE am.user_id = u.user_id) AS has_membership
         FROM app.users u
        WHERE u.user_id = $1::uuid`,
      [userId],
    );
    return toResetTarget(result.rows[0]);
  }

  /**
   * Replaces the password hash of a row the caller holds FOR UPDATE: version + 1, database time. Status, roles, phone and origin
   * are not touched. Returns the new version, or undefined when the row is gone.
   */
  async setPasswordHash(context: TransactionContext, input: { userId: string; passwordHash: string }): Promise<number | undefined> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.users
          SET password_hash = $2, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = $1::uuid
        RETURNING version::text AS version`,
      [input.userId, input.passwordHash],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : Number(row.version);
  }
}
