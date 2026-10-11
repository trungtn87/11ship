import { randomUUID } from 'node:crypto';
import { AuditWriter } from '../audit/audit-writer';
import { MAX_STAGING_ALLOWED_PHONES, PhoneAllowlist } from '../config/staging-fixtures-config';
import { deriveLockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import {
  AUDIT_ACTIONS,
  STAGING_SEED_ACTOR_ID,
  STAGING_SEED_ACTOR_TYPE,
  STAGING_SEED_LOCK_DOMAIN,
} from './auth-constants';
import { exactObject, parsePassword } from './auth-validation';
import { normalizeVietnamPhone } from './phone';
import { PasswordHasher } from './password-hasher';
import { UserRepository } from './user-repository';

// The operator seed of staging fixture accounts (M00-D2 design, PR #26 section 5). It is
// a plain class used by the CLI (scripts/staging-seed-fixtures.js) and by the PostgreSQL tests: there is no HTTP
// endpoint, no Nest provider and no application boot path that reaches it.
//
// What it does: creates ACTIVE, roleless STAGING_FIXTURE users (phone_verified_at NULL) for allowlisted phones, in
// ONE transaction, under one fixed advisory lock. What it never does: overwrite an account, reset a password,
// change a status, re-enable a disabled account, grant a role or create a profile, mint a session, write an
// OTP challenge/proof/idempotency record or emit a "user registered" event.

/** Why a payload was refused. A fixed vocabulary: it never contains a phone number, a password or a key name. */
export type SeedPayloadProblem = 'SHAPE' | 'EMPTY' | 'TOO_MANY' | 'PHONE_INVALID' | 'PHONE_NOT_ALLOWED' | 'PHONE_DUPLICATE' | 'PASSWORD_INVALID';

export interface SeedEntry {
  readonly phoneNormalized: string;
  readonly password: string;
}

export type SeedPayloadParse =
  | { readonly ok: true; readonly entries: readonly SeedEntry[] }
  | { readonly ok: false; readonly problem: SeedPayloadProblem };

/**
 * Strict parser of the stdin payload `[{ "phone": ..., "password": ... }]`: an array of 1..20 objects whose keys are
 * EXACTLY phone and password (so an origin, a timestamp, a role or a status cannot be smuggled in), phones in the
 * normalized form the phone contract defines, unique, and every one in the allowlist; passwords by the standard
 * registration validation. Nothing is repaired and nothing is echoed.
 */
export function parseSeedPayload(raw: unknown, allowlist: PhoneAllowlist): SeedPayloadParse {
  if (!Array.isArray(raw)) {
    return { ok: false, problem: 'SHAPE' };
  }
  if (raw.length === 0) {
    return { ok: false, problem: 'EMPTY' };
  }
  if (raw.length > MAX_STAGING_ALLOWED_PHONES) {
    return { ok: false, problem: 'TOO_MANY' };
  }
  const entries: SeedEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    let object: Record<string, unknown>;
    try {
      object = exactObject(item, ['phone', 'password']);
    } catch {
      return { ok: false, problem: 'SHAPE' };
    }
    const phone = object.phone;
    // Only the normalized form is accepted: a seed file is not a place to rely on input repair.
    if (typeof phone !== 'string' || normalizeVietnamPhone(phone) !== phone) {
      return { ok: false, problem: 'PHONE_INVALID' };
    }
    if (!allowlist.has(phone)) {
      return { ok: false, problem: 'PHONE_NOT_ALLOWED' };
    }
    if (seen.has(phone)) {
      return { ok: false, problem: 'PHONE_DUPLICATE' };
    }
    let password: string;
    try {
      password = parsePassword(object.password);
    } catch {
      return { ok: false, problem: 'PASSWORD_INVALID' };
    }
    seen.add(phone);
    entries.push({ phoneNormalized: phone, password });
  }
  return { ok: true, entries };
}

export interface PreparedFixture {
  readonly phoneNormalized: string;
  readonly passwordHash: string;
}

export interface SeedResult {
  readonly created: number;
  readonly skipped: number;
}

/**
 * The phone already belongs to an account that is not a staging fixture: a registered (PHONE_VERIFIED) account or an
 * administration (ADMIN_PROVISIONED) one. The whole batch is rolled back and nothing is written, and the seed never
 * touches that account. The message carries no phone number.
 */
export class StagingSeedConflictError extends Error {
  readonly code = 'PHONE_ALREADY_VERIFIED';

  constructor() {
    super('A phone number in the batch belongs to an account that is not a staging fixture');
    this.name = 'StagingSeedConflictError';
  }
}

export class StagingFixtureSeeder {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditWriter,
    private readonly hasher: PasswordHasher,
    private readonly newId: () => string = randomUUID,
  ) {}

  /**
   * Argon2id hashing of every password, OUTSIDE any transaction (it is CPU and memory work). Sorted by phone so the
   * rows are always written in the same order, whatever order the file listed them in.
   */
  async prepare(entries: readonly SeedEntry[]): Promise<PreparedFixture[]> {
    const sorted = [...entries].sort((a, b) => (a.phoneNormalized < b.phoneNormalized ? -1 : 1));
    const prepared: PreparedFixture[] = [];
    for (const entry of sorted) {
      prepared.push({ phoneNormalized: entry.phoneNormalized, passwordHash: await this.hasher.hash(entry.password) });
    }
    return prepared;
  }

  /**
   * The batch, inside the caller's transaction (the caller commits or rolls back; a thrown error means roll back).
   * One fixed advisory lock serializes concurrent seed runs, and the UNIQUE phone constraint stays the final
   * arbiter against anything that does not take that lock (a concurrent registration).
   */
  async seed(context: TransactionContext, prepared: readonly PreparedFixture[], requestId: string): Promise<SeedResult> {
    const key = deriveLockKey(STAGING_SEED_LOCK_DOMAIN, []);
    await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [key[0], key[1]]);

    let created = 0;
    let skipped = 0;
    for (const fixture of prepared) {
      const existing = await this.users.findByPhone(context, fixture.phoneNormalized);
      if (existing !== undefined) {
        // An existing fixture is left exactly as it is (password, status, version, roles); any other account (a
        // verified one, an administration one) aborts the batch. Either way nothing is overwritten.
        if (existing.accountOrigin !== 'STAGING_FIXTURE') {
          throw new StagingSeedConflictError();
        }
        skipped += 1;
        continue;
      }
      const userId = this.newId();
      const inserted = await this.users.insertStagingFixture(context, {
        userId,
        phoneNormalized: fixture.phoneNormalized,
        passwordHash: fixture.passwordHash,
      });
      if (!inserted) {
        // Lost a race with something that does not take the seed lock: look again, decide the same way.
        const winner = await this.users.findByPhone(context, fixture.phoneNormalized);
        if (winner === undefined || winner.accountOrigin !== 'STAGING_FIXTURE') {
          throw new StagingSeedConflictError();
        }
        skipped += 1;
        continue;
      }
      // Same transaction as the row: if the audit cannot be written the user is not created either.
      await this.audit.append(context, {
        requestId,
        actorType: STAGING_SEED_ACTOR_TYPE,
        actorId: STAGING_SEED_ACTOR_ID,
        action: AUDIT_ACTIONS.stagingFixtureCreated,
        resourceType: 'user',
        resourceId: userId,
        outcome: 'SUCCESS',
      });
      created += 1;
    }
    return { created, skipped };
  }
}
