import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { AdminBootstrapService } from '../../apps/backend/src/admin-auth/admin-bootstrap-service';
import { AdminCliError } from '../../apps/backend/src/admin-auth/admin-cli-errors';
import { AdminLimitConfigRepository } from '../../apps/backend/src/admin-auth/admin-limit-config-repository';
import { AdminLimitConfigService } from '../../apps/backend/src/admin-auth/admin-limit-config-service';
import { AdminMembershipRepository } from '../../apps/backend/src/admin-auth/admin-membership-repository';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { AdminIdentityParticipant } from '../../apps/backend/src/auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../../apps/backend/src/auth/admin-password-verifier';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { AdminLimiterConfig, loadLimiterConfig } from '../../apps/backend/src/config/admin-auth-config';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
} from '../../apps/backend/src/transaction/transaction-manager';
import { ADMIN_PASSWORD, adminTestEnv, initLimitConfig, purgeSystem } from './support/admin-fixtures';
import { Deferred, deferred } from './support/async-helpers';
import { purgePhone, randomPhone } from './support/auth-fixtures';
import { waitForBlockedBackends } from './support/lock-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// B-1 (finding of the M01-D-ADMIN-1B contract review). The operator bootstrap used to lock the SYSTEM MEMBERSHIP first
// and the USER second - the opposite of login, TOTP, session and every future SYSTEM writer (user, then membership).
// Against a writer that already holds the user, that is a lock cycle. These cases decide the interleaving with
// barriers (a statement is paused AFTER PostgreSQL granted its lock; the test waits until the other side is really
// blocked), never with sleeps:
//   * case 1 reproduces the OLD order and shows PostgreSQL ending the cycle with 40P01;
//   * cases 2-5 run the real bootstrap service against the same kind of writer and show no deadlock and unchanged
//     business behaviour (same phone: UNCHANGED and the password untouched; another phone: refused; one SYSTEM only).

const USER_LOCK = /FROM app\.users WHERE user_id = \$1::uuid FOR UPDATE/;
const MEMBERSHIP_LOCK = /FROM app\.admin_memberships WHERE user_id = \$1::uuid FOR UPDATE/;
const LEGACY_SYSTEM_LOCK = /FROM app\.admin_memberships WHERE admin_role = 'SYSTEM' FOR UPDATE/;

// Long enough that neither a statement timeout nor a transaction timeout can end a lock wait before PostgreSQL's own
// deadlock detector (deadlock_timeout, checked below) does: a timeout must never be mistaken for, or hide, a deadlock.
const STATEMENT_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 25_000;
const TRANSACTION_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 25_000;
const MAX_DEADLOCK_TIMEOUT_MS = 5_000;

interface Gate {
  readonly reached: Deferred;
  readonly release: Deferred;
}

function newGate(): Gate {
  return { reached: deferred(), release: deferred() };
}

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

function settle<T>(run: Promise<T>): Promise<Settled<T>> {
  return run.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error: unknown): Settled<T> => ({ ok: false, error }),
  );
}

function pgCode(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The real pool, except that the FIRST statement matching `pattern` is paused after PostgreSQL has answered it - so
 * the lock it took is held - until the test releases the gate.
 */
function gatedSource(pool: Pool, pattern: RegExp, gate: Gate): TransactionClientSource {
  const inner = poolClientSource(pool);
  let fired = false;
  return {
    async acquire(): Promise<TransactionClient> {
      const real = await inner.acquire();
      return {
        query: async (text, values) => {
          const result = await real.query(text, values);
          if (!fired && pattern.test(text)) {
            fired = true;
            gate.reached.resolve();
            await gate.release.promise;
          }
          return result;
        },
        release: (destroy) => real.release(destroy),
        onError: (listener) => real.onError(listener),
      };
    },
  };
}

function managerFor(source: TransactionClientSource): TransactionManager {
  return new TransactionManager(source, {
    timeoutMs: TRANSACTION_TIMEOUT_MS,
    idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
}

function bootstrapService(source: TransactionClientSource): AdminBootstrapService {
  const transactions = managerFor(source);
  return new AdminBootstrapService(
    transactions,
    new AdminIdentityParticipant(new UserRepository()),
    new AdminMembershipRepository(),
    new AdminLimitConfigService(transactions, new AdminLimitConfigRepository()),
    new AdminPasswordVerifier(new Argon2idPasswordHasher()),
    new AuditWriter(),
  );
}

/** A SYSTEM writer in the module's lock order, using the same repositories as login/TOTP: user, then membership. */
async function writerTransaction(source: TransactionClientSource, systemUserId: string): Promise<void> {
  const identities = new AdminIdentityParticipant(new UserRepository());
  const memberships = new AdminMembershipRepository();
  await managerFor(source).withTransaction(async (context) => {
    const user = await identities.lockById(context, systemUserId);
    if (user === undefined) {
      throw new Error('the SYSTEM user is missing');
    }
    const membership = await memberships.lock(context, systemUserId);
    if (membership === undefined) {
      throw new Error('the SYSTEM membership is missing');
    }
  });
}

/** The OLD bootstrap lock order, kept only here as the reference that reproduces B-1: membership, then user. */
async function legacyOrderTransaction(source: TransactionClientSource, systemUserId: string): Promise<void> {
  const identities = new AdminIdentityParticipant(new UserRepository());
  await managerFor(source).withTransaction(async (context) => {
    await context.query(`SELECT user_id FROM app.admin_memberships WHERE admin_role = 'SYSTEM' FOR UPDATE`);
    await identities.lockById(context, systemUserId);
  });
}

describe('M01-D-ADMIN-1B B-1 - the SYSTEM bootstrap takes locks in the module order (user, then membership)', () => {
  let pool: Pool;
  let limiter: AdminLimiterConfig;
  const phones: string[] = [];
  let systemPhone = '';
  let systemUserId = '';
  let systemPasswordHash = '';

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, {
      poolMax: 8,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
    });
    const loaded = loadLimiterConfig(adminTestEnv());
    if (!loaded.ok) {
      throw new Error('test limiter configuration is invalid');
    }
    limiter = loaded.limiter;

    // The budget above only proves anything if PostgreSQL detects a cycle well inside it.
    const shown = await pool.query<{ deadlock_timeout: string }>('SHOW deadlock_timeout');
    const raw = shown.rows[0]?.deadlock_timeout ?? '';
    const match = /^(\d+)(ms|s)$/.exec(raw);
    const deadlockMs = match === null ? Number.NaN : Number(match[1]) * (match[2] === 's' ? 1000 : 1);
    expect(deadlockMs).toBeLessThanOrEqual(MAX_DEADLOCK_TIMEOUT_MS);
  });

  afterAll(async () => {
    await purgeSystem(pool);
    for (const phone of phones) {
      await purgePhone(pool, phone);
    }
    await pool.end();
  });

  beforeEach(async () => {
    await purgeSystem(pool);
    const init = await initLimitConfig();
    expect(init.code).toBe(0);
    const phone = randomPhone();
    phones.push(phone.normalized);
    systemPhone = phone.normalized;
    const created = await bootstrapService(poolClientSource(pool)).bootstrapSystem(
      { phoneNormalized: phone.normalized, password: ADMIN_PASSWORD },
      limiter,
    );
    expect(created).toBe('CREATED');
    const row = await pool.query<{ user_id: string; password_hash: string }>(
      'SELECT user_id, password_hash FROM app.users WHERE phone_normalized = $1',
      [phone.normalized],
    );
    systemUserId = row.rows[0]?.user_id ?? '';
    systemPasswordHash = row.rows[0]?.password_hash ?? '';
    expect(systemUserId).not.toBe('');
  });

  async function expectUnchangedBusinessState(): Promise<void> {
    const systems = await pool.query(`SELECT 1 FROM app.admin_memberships WHERE admin_role = 'SYSTEM'`);
    expect(systems.rowCount).toBe(1);
    const users = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM app.users WHERE phone_normalized = $1',
      [systemPhone],
    );
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]?.password_hash).toBe(systemPasswordHash);
  }

  it('REFERENCE (old order): membership-then-user against a user-then-membership writer ends in 40P01', async () => {
    const legacyGate = newGate();
    const writerGate = newGate();
    const legacy = settle(
      legacyOrderTransaction(gatedSource(pool, LEGACY_SYSTEM_LOCK, legacyGate), systemUserId),
    );
    await legacyGate.reached.promise; // the old order holds the SYSTEM membership
    const writer = settle(writerTransaction(gatedSource(pool, USER_LOCK, writerGate), systemUserId));
    await writerGate.reached.promise; // the writer holds the user
    legacyGate.release.resolve(); // the old order now asks for the user: blocked by the writer
    await waitForBlockedBackends(pool, 1);
    writerGate.release.resolve(); // the writer now asks for the membership: a cycle

    const results = await Promise.all([legacy, writer]);
    const failures = results.filter((result) => !result.ok);
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    expect(failure !== undefined && !failure.ok ? pgCode(failure.error) : undefined).toBe('40P01');
  });

  it('writer holds the user, bootstrap arrives: bootstrap waits, then both finish; same phone is UNCHANGED', async () => {
    const writerGate = newGate();
    const writer = settle(writerTransaction(gatedSource(pool, USER_LOCK, writerGate), systemUserId));
    await writerGate.reached.promise;
    const bootstrap = settle(
      bootstrapService(poolClientSource(pool)).bootstrapSystem(
        { phoneNormalized: systemPhone, password: ADMIN_PASSWORD },
        limiter,
      ),
    );
    await waitForBlockedBackends(pool, 1); // bootstrap is waiting for the user, holding nothing the writer needs
    writerGate.release.resolve();

    const [writerResult, bootstrapResult] = await Promise.all([writer, bootstrap]);
    expect(writerResult.ok).toBe(true);
    expect(bootstrapResult).toEqual({ ok: true, value: 'UNCHANGED' });
    await expectUnchangedBusinessState();
  });

  it('bootstrap holds the user, writer arrives: the writer waits, then both finish', async () => {
    const bootstrapGate = newGate();
    const bootstrap = settle(
      bootstrapService(gatedSource(pool, USER_LOCK, bootstrapGate)).bootstrapSystem(
        { phoneNormalized: systemPhone, password: ADMIN_PASSWORD },
        limiter,
      ),
    );
    await bootstrapGate.reached.promise;
    const writer = settle(writerTransaction(poolClientSource(pool), systemUserId));
    await waitForBlockedBackends(pool, 1);
    bootstrapGate.release.resolve();

    const [bootstrapResult, writerResult] = await Promise.all([bootstrap, writer]);
    expect(bootstrapResult).toEqual({ ok: true, value: 'UNCHANGED' });
    expect(writerResult.ok).toBe(true);
    await expectUnchangedBusinessState();
  });

  it('bootstrap holds user and membership, writer arrives: the writer waits at the user, then both finish', async () => {
    const bootstrapGate = newGate();
    const bootstrap = settle(
      bootstrapService(gatedSource(pool, MEMBERSHIP_LOCK, bootstrapGate)).bootstrapSystem(
        { phoneNormalized: systemPhone, password: ADMIN_PASSWORD },
        limiter,
      ),
    );
    await bootstrapGate.reached.promise;
    const writer = settle(writerTransaction(poolClientSource(pool), systemUserId));
    await waitForBlockedBackends(pool, 1);
    bootstrapGate.release.resolve();

    const [bootstrapResult, writerResult] = await Promise.all([bootstrap, writer]);
    expect(bootstrapResult).toEqual({ ok: true, value: 'UNCHANGED' });
    expect(writerResult.ok).toBe(true);
    await expectUnchangedBusinessState();
  });

  it('another phone is still refused under the same contention: no second SYSTEM and no new account', async () => {
    const other = randomPhone();
    phones.push(other.normalized);
    const writerGate = newGate();
    const writer = settle(writerTransaction(gatedSource(pool, USER_LOCK, writerGate), systemUserId));
    await writerGate.reached.promise;
    const bootstrap = settle(
      bootstrapService(poolClientSource(pool)).bootstrapSystem(
        { phoneNormalized: other.normalized, password: ADMIN_PASSWORD },
        limiter,
      ),
    );
    await waitForBlockedBackends(pool, 1);
    writerGate.release.resolve();

    const [writerResult, bootstrapResult] = await Promise.all([writer, bootstrap]);
    expect(writerResult.ok).toBe(true);
    expect(bootstrapResult.ok).toBe(false);
    const refusal = bootstrapResult.ok ? undefined : bootstrapResult.error;
    expect(refusal).toBeInstanceOf(AdminCliError);
    expect((refusal as AdminCliError).code).toBe('SYSTEM_ACCOUNT_DIFFERENT');
    const created = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [other.normalized]);
    expect(created.rowCount).toBe(0);
    await expectUnchangedBusinessState();
  });
});
