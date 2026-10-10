import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { SUPPORTED_ROLES } from './auth-constants';
import { CLOCK_CTE } from './auth-db';

export type UserStatus = 'ACTIVE' | 'DISABLED';

/**
 * Where an account came from. It carries NO privilege. The application (customer/shop/driver) Auth only accepts
 * PHONE_VERIFIED accounts; ADMIN_PROVISIONED accounts exist for the administration web and are refused by every
 * application login and session check.
 */
export type AccountOrigin = 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED';

export interface UserRow {
  readonly userId: string;
  readonly phoneNormalized: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly accountOrigin: AccountOrigin;
}

interface RawUser {
  user_id: string;
  phone_normalized: string;
  password_hash: string;
  status: UserStatus;
  account_origin: AccountOrigin;
}

function toUser(row: RawUser): UserRow {
  return {
    userId: row.user_id,
    phoneNormalized: row.phone_normalized,
    passwordHash: row.password_hash,
    status: row.status,
    accountOrigin: row.account_origin,
  };
}

/** SQL for users and user_roles. */
@Injectable()
export class UserRepository {
  async isPhoneRegistered(context: TransactionContext, phoneNormalized: string): Promise<boolean> {
    const result = await context.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [
      phoneNormalized,
    ]);
    return result.rows.length > 0;
  }

  async findByPhone(context: TransactionContext, phoneNormalized: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin
         FROM app.users WHERE phone_normalized = $1`,
      [phoneNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async lockById(context: TransactionContext, userId: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin
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
      `SELECT user_id, phone_normalized, password_hash, status, account_origin
         FROM app.users WHERE user_id = $1::uuid FOR SHARE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async findById(context: TransactionContext, userId: string): Promise<UserRow | undefined> {
    const result = await context.query<RawUser>(
      `SELECT user_id, phone_normalized, password_hash, status, account_origin
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
       ON CONFLICT (phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash, input.proofId],
    );
    if (result.rowCount === 1) {
      return true;
    }
    // Either the phone is taken (the expected conflict) or the verification join found nothing. Tell them
    // apart so a broken invariant is never reported as "phone already registered".
    const taken = await this.isPhoneRegistered(context, input.phoneNormalized);
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
       ON CONFLICT (phone_normalized) DO NOTHING`,
      [input.userId, input.phoneNormalized, input.passwordHash],
    );
    return result.rowCount === 1;
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
}
