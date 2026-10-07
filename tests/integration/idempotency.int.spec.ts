import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { CryptoError } from '../../apps/backend/src/crypto/crypto-error';
import {
  FIXTURE_MASTER_K2,
  fixtureKeyring,
} from '../../apps/backend/src/crypto/test-keys.fixture';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { IdempotencyCleanup } from '../../apps/backend/src/idempotency/idempotency-cleanup';
import { IdempotencyExecutor } from '../../apps/backend/src/idempotency/idempotency-executor';
import { IdempotencyOperationRegistry } from '../../apps/backend/src/idempotency/idempotency-operation-registry';
import { IdempotencyOptions } from '../../apps/backend/src/idempotency/idempotency.types';
import { idempotencyLockKey } from '../../apps/backend/src/shared/lock-key';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { deferred, eventually, failureOf } from './support/async-helpers';
import { loadIntegrationConfig } from './support/test-helpers';
import {
  faultySource,
  managerFor,
  testPool,
} from './support/transaction-fixtures';

const OPTIONS: IdempotencyOptions = {
  advisoryWaitMs: 500,
  businessLockTimeoutMs: 300,
  replayTtlSeconds: 900,
  dedupeTtlSeconds: 604800,
};

const SCOPE = 'fixture';
const SCOPE_ID = 'actor-1';
const OPERATION = 'fixture.mutate.v1';
const SECRET_RESPONSE = 'ACCESS_TOKEN_SECRET_C1A1_9d1f';
const SECRET_PASSWORD = 'PASSWORD_SECRET_C1A1_10af';

describe('M00-C1A1 — idempotency executor on real PostgreSQL', () => {
  const pool: Pool = testPool(loadIntegrationConfig().database, {
    queryTimeoutMs: 6000,
    statementTimeoutMs: 5000,
  });

  function executor(
    options: Partial<IdempotencyOptions> = {},
    keyring = fixtureKeyring('k1'),
    source = poolClientSource(pool),
    lockKey = idempotencyLockKey,
    operationRegistry = new IdempotencyOperationRegistry(),
  ): IdempotencyExecutor {
    return new IdempotencyExecutor(
      managerFor(source),
      keyring,
      { ...OPTIONS, ...options },
      operationRegistry,
      lockKey,
    );
  }

  function request(key: string, logicalRequest: unknown = { password: SECRET_PASSWORD }) {
    return {
      scopeType: SCOPE,
      scopeId: SCOPE_ID,
      operationId: OPERATION,
      idempotencyKey: key,
      logicalRequest,
    };
  }

  async function writeEffect(
    context: { query: (text: string, values?: readonly unknown[]) => Promise<unknown> },
    effectKey: string,
    body: unknown = { access_token: SECRET_RESPONSE },
    guard: unknown = {},
  ) {
    await context.query(
      'INSERT INTO app.c1a1_effects(effect_key, hits) VALUES ($1, 1) ON CONFLICT (effect_key) DO UPDATE SET hits = app.c1a1_effects.hits + 1',
      [effectKey],
    );
    return { responseStatus: 201, responseBody: body, replayGuard: guard };
  }

  async function setExpired(key: string, dedupe = false): Promise<void> {
    await pool.query(
      `UPDATE app.idempotency_records
       SET created_at = date_trunc('milliseconds', clock_timestamp() - interval '2 seconds'),
           replay_expires_at = date_trunc('milliseconds', clock_timestamp() - interval '1 second'),
           dedupe_expires_at = CASE
             WHEN $2::boolean THEN date_trunc('milliseconds', clock_timestamp() - interval '1 millisecond')
             ELSE date_trunc('milliseconds', clock_timestamp() + interval '1 day')
           END
       WHERE idempotency_key = $1::uuid`,
      [key, dedupe],
    );
  }

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.c1a1_effects (
        effect_key text PRIMARY KEY,
        hits integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app.c1a1_guard_fixture (
        guard_id uuid PRIMARY KEY,
        allowed boolean NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app.c1a1_proof_fixture (
        proof_id uuid PRIMARY KEY,
        used boolean NOT NULL,
        invalidated boolean NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app.c1a1_user_fixture (
        user_id uuid PRIMARY KEY,
        active boolean NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app.c1a1_session_fixture (
        session_id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        proof_id uuid NOT NULL,
        revoked boolean NOT NULL,
        expires_at timestamptz NOT NULL
      );
    `);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM app.idempotency_records');
    await pool.query('DELETE FROM app.c1a1_effects');
    await pool.query('DELETE FROM app.c1a1_guard_fixture');
    await pool.query('DELETE FROM app.c1a1_session_fixture');
    await pool.query('DELETE FROM app.c1a1_user_fixture');
    await pool.query('DELETE FROM app.c1a1_proof_fixture');
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS app.c1a1_session_fixture');
    await pool.query('DROP TABLE IF EXISTS app.c1a1_user_fixture');
    await pool.query('DROP TABLE IF EXISTS app.c1a1_proof_fixture');
    await pool.query('DROP TABLE IF EXISTS app.c1a1_guard_fixture');
    await pool.query('DROP TABLE IF EXISTS app.c1a1_effects');
    await pool.end();
  });

  it('C02 — sequential same-key request replays the exact result without a second callback', async () => {
    const key = randomUUID();
    const ex = executor();
    let calls = 0;
    const first = await ex.execute(request(key), async (context) => {
      calls += 1;
      return writeEffect(context, 'sequential', { access_token: SECRET_RESPONSE, n: 7 });
    });
    const second = await ex.execute(request(key), async (context) => {
      calls += 1;
      return writeEffect(context, 'sequential', { access_token: 'must-never-be-created' });
    });
    expect(first).toEqual({
      responseStatus: 201,
      responseBody: { access_token: SECRET_RESPONSE, n: 7 },
      replayed: false,
    });
    expect(second).toEqual({ ...first, replayed: true });
    expect(calls).toBe(1);
  });

  it('C08 — oversized replay plaintext fails before persist and rolls back business work', async () => {
    const key = randomUUID();
    const ex = executor();
    const error = await failureOf(() =>
      ex.execute(request(key), async (context) => {
        await context.query('INSERT INTO app.c1a1_effects(effect_key, hits) VALUES ($1, 1)', [
          'oversized',
        ]);
        return {
          responseStatus: 200,
          responseBody: { value: 'x'.repeat(70 * 1024) },
          replayGuard: {},
        };
      }),
    );
    expect(error).toBeDefined();
    const effect = await pool.query(
      "SELECT 1 FROM app.c1a1_effects WHERE effect_key = 'oversized'",
    );
    const record = await pool.query(
      'SELECT 1 FROM app.idempotency_records WHERE idempotency_key = $1::uuid',
      [key],
    );
    expect(effect.rowCount).toBe(0);
    expect(record.rowCount).toBe(0);
  });

  it('C02/C03 — concurrent same-key requests overlap at the advisory lock but commit one effect', async () => {
    const key = randomUUID();
    const entered = deferred();
    const release = deferred();
    let callbackCount = 0;
    const ex = executor({ advisoryWaitMs: 1500 });

    const first = ex.execute(request(key), async (context) => {
      callbackCount += 1;
      entered.resolve();
      await release.promise;
      return writeEffect(context, 'same-key');
    });
    await entered.promise;

    const second = ex.execute(request(key), async (context) => {
      callbackCount += 1;
      return writeEffect(context, 'same-key');
    });

    await eventually(async () => {
      const waiting = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query LIKE 'SELECT pg_advisory_xact_lock%'`,
      );
      return Number(waiting.rows[0]?.count ?? '0') >= 1;
    }, 'second request waits on advisory transaction lock');

    release.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(callbackCount).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.responseBody).toEqual({ access_token: SECRET_RESPONSE });
    expect(b.responseBody).toEqual({ access_token: SECRET_RESPONSE });

    const effect = await pool.query<{ hits: number }>(
      "SELECT hits FROM app.c1a1_effects WHERE effect_key = 'same-key'",
    );
    expect(effect.rows[0]?.hits).toBe(1);
  });

  it('C04 — same key with a different logical request is rejected and never executes again', async () => {
    const key = randomUUID();
    let calls = 0;
    const ex = executor();
    await ex.execute(request(key, { password: 'one' }), async (context) => {
      calls += 1;
      return writeEffect(context, 'reuse');
    });

    const error = await failureOf(() =>
      ex.execute(request(key, { password: 'two' }), async (context) => {
        calls += 1;
        return writeEffect(context, 'reuse');
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(calls).toBe(1);
  });

  it('C05 — rollback does not consume the key and a later request may execute', async () => {
    const key = randomUUID();
    const ex = executor();
    await expect(
      ex.execute(request(key), async (context) => {
        await context.query('INSERT INTO app.c1a1_effects(effect_key, hits) VALUES ($1, 1)', [
          'rolled-back',
        ]);
        throw new Error('fixture failure');
      }),
    ).rejects.toThrow('fixture failure');

    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM app.idempotency_records WHERE idempotency_key = $1::uuid',
            [key],
          )
        ).rows[0]?.count,
      ),
    ).toBe(0);

    const result = await ex.execute(request(key), (context) => writeEffect(context, 'rolled-back'));
    expect(result.replayed).toBe(false);
    const effect = await pool.query<{ hits: number }>(
      "SELECT hits FROM app.c1a1_effects WHERE effect_key = 'rolled-back'",
    );
    expect(effect.rows[0]?.hits).toBe(1);
  });

  it('C06 — same UUID is isolated by scope and operation', async () => {
    const key = randomUUID();
    const ex = executor();
    const base = request(key);
    await ex.execute(base, (context) => writeEffect(context, 'isolation-a'));
    const otherScope = await ex.execute(
      { ...base, scopeId: 'actor-2' },
      (context) => writeEffect(context, 'isolation-b'),
    );
    const otherOperation = await ex.execute(
      { ...base, operationId: 'fixture.other.v1' },
      (context) => writeEffect(context, 'isolation-c'),
    );
    expect(otherScope.replayed).toBe(false);
    expect(otherOperation.replayed).toBe(false);
  });

  it('C10 — operation TTL override comes only from the immutable server registry', async () => {
    const key = randomUUID();
    const operationId = 'fixture.short-ttl.v1';
    const registry = new IdempotencyOperationRegistry([
      { operationId, replayTtlSeconds: 2, dedupeTtlSeconds: 5 },
    ]);
    const ex = executor({}, fixtureKeyring('k1'), poolClientSource(pool), idempotencyLockKey, registry);
    await ex.execute({ ...request(key), operationId }, (context) =>
      writeEffect(context, 'operation-ttl'),
    );
    const row = await pool.query<{ replay_ms: string; dedupe_ms: string }>(
      `SELECT
         floor(extract(epoch FROM (replay_expires_at - created_at)) * 1000)::bigint::text AS replay_ms,
         floor(extract(epoch FROM (dedupe_expires_at - created_at)) * 1000)::bigint::text AS dedupe_ms
       FROM app.idempotency_records
       WHERE idempotency_key = $1::uuid`,
      [key],
    );
    expect(row.rows[0]).toEqual({ replay_ms: '2000', dedupe_ms: '5000' });
  });

  it('C07/C09 — record uses historical key after active rotation and new record uses new active key', async () => {
    const oldKey = randomUUID();
    const newKey = randomUUID();
    await executor({}, fixtureKeyring('k1')).execute(request(oldKey), (context) =>
      writeEffect(context, 'rotation-old'),
    );

    const rotated = executor({}, fixtureKeyring('k2'));
    const replay = await rotated.execute(request(oldKey), () => {
      throw new Error('must not execute old record');
    });
    expect(replay.replayed).toBe(true);

    await rotated.execute(request(newKey), (context) => writeEffect(context, 'rotation-new'));
    const rows = await pool.query<{ idempotency_key: string; crypto_key_id: string }>(
      'SELECT idempotency_key::text, crypto_key_id FROM app.idempotency_records ORDER BY idempotency_key',
    );
    const map = new Map(rows.rows.map((row) => [row.idempotency_key, row.crypto_key_id]));
    expect(map.get(oldKey)).toBe('k1');
    expect(map.get(newKey)).toBe('k2');
  });

  it('C30 — a live record with a missing historical key returns 503 semantics and does not rerun', async () => {
    const key = randomUUID();
    await executor({}, fixtureKeyring('k1')).execute(request(key), (context) =>
      writeEffect(context, 'missing-key'),
    );
    const k2Only = new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2');
    let calls = 0;
    const error = await failureOf(() =>
      executor({}, k2Only).execute(request(key), async (context) => {
        calls += 1;
        return writeEffect(context, 'missing-key');
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('IDEMPOTENCY_KEY_UNAVAILABLE');
    expect(calls).toBe(0);
  });

  it('C10/C17 — replay expiry equality is a tombstone and does not rerun callback', async () => {
    const key = randomUUID();
    const ex = executor();
    await ex.execute(request(key), (context) => writeEffect(context, 'replay-expired'));
    await pool.query(
      `UPDATE app.idempotency_records
       SET replay_expires_at = date_trunc('milliseconds', clock_timestamp())
       WHERE idempotency_key = $1::uuid`,
      [key],
    );

    let calls = 0;
    const error = await failureOf(() =>
      ex.execute(request(key), async (context) => {
        calls += 1;
        return writeEffect(context, 'replay-expired');
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
    expect(calls).toBe(0);
  });

  it('C30 — an expired dedupe window is deleted under lock and business invariants are rechecked', async () => {
    const key = randomUUID();
    const ex = executor();
    await ex.execute(request(key), async (context) => {
      await context.query('INSERT INTO app.c1a1_effects(effect_key, hits) VALUES ($1, 1)', [
        'long-lived-invariant',
      ]);
      return { responseStatus: 200, responseBody: { ok: true }, replayGuard: {} };
    });
    await setExpired(key, true);

    await expect(
      ex.execute(request(key), async (context) => {
        await context.query('INSERT INTO app.c1a1_effects(effect_key, hits) VALUES ($1, 1)', [
          'long-lived-invariant',
        ]);
        return { responseStatus: 200, responseBody: { ok: true }, replayGuard: {} };
      }),
    ).rejects.toBeDefined();

    const row = await pool.query<{ dedupe_expired: boolean }>(
      'SELECT dedupe_expires_at <= clock_timestamp() AS dedupe_expired FROM app.idempotency_records WHERE idempotency_key = $1::uuid',
      [key],
    );
    // Deleting the expired tombstone was part of the failed transaction, so rollback restores it.
    expect(row.rows[0]?.dedupe_expired).toBe(true);
  });

  it('C08/C20 — plaintext secrets are absent and guard/status/expiry/tag/IV tamper all fail closed', async () => {
    const mutations = [
      "UPDATE app.idempotency_records SET replay_guard = '{\"guard_id\":\"tampered\"}'::jsonb WHERE idempotency_key = $1::uuid",
      'UPDATE app.idempotency_records SET response_status = 202 WHERE idempotency_key = $1::uuid',
      "UPDATE app.idempotency_records SET replay_expires_at = replay_expires_at + interval '1 second' WHERE idempotency_key = $1::uuid",
      "UPDATE app.idempotency_records SET replay_tag = decode(repeat('00', 16), 'hex') WHERE idempotency_key = $1::uuid",
      "UPDATE app.idempotency_records SET replay_iv = decode(repeat('01', 12), 'hex') WHERE idempotency_key = $1::uuid",
    ];

    for (const [index, mutation] of mutations.entries()) {
      const key = randomUUID();
      const ex = executor();
      await ex.execute(request(key), (context) =>
        writeEffect(context, `tamper-${index}`, { access_token: SECRET_RESPONSE }, { guard_id: randomUUID() }),
      );
      const stored = await pool.query<{
        request_fingerprint: string;
        replay_ciphertext: Buffer;
        replay_iv: Buffer;
        replay_tag: Buffer;
      }>(
        'SELECT request_fingerprint, replay_ciphertext, replay_iv, replay_tag FROM app.idempotency_records WHERE idempotency_key = $1::uuid',
        [key],
      );
      const serialized = JSON.stringify(stored.rows[0]);
      expect(serialized).not.toContain(SECRET_PASSWORD);
      expect(serialized).not.toContain(SECRET_RESPONSE);

      await pool.query(mutation, [key]);
      const error = await failureOf(() =>
        ex.execute(request(key), () => {
          throw new Error('tampered record must never rerun');
        }),
      );
      expect(error).toBeInstanceOf(CryptoError);
    }
  });

  it('C20 — null replay ciphertext before replay expiry is corruption, never a new execution', async () => {
    const key = randomUUID();
    const ex = executor();
    await ex.execute(request(key), (context) => writeEffect(context, 'null-before-expiry'));
    await pool.query(
      'UPDATE app.idempotency_records SET replay_ciphertext = NULL, replay_iv = NULL, replay_tag = NULL WHERE idempotency_key = $1::uuid',
      [key],
    );
    let calls = 0;
    const error = await failureOf(() =>
      ex.execute(request(key), async (context) => {
        calls += 1;
        return writeEffect(context, 'null-before-expiry');
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(calls).toBe(0);
  });

  it('C18/C19 — sensitive replay authorization runs under a row lock before decrypt', async () => {
    const key = randomUUID();
    const guardId = randomUUID();
    const ex = executor();
    await pool.query('INSERT INTO app.c1a1_guard_fixture(guard_id, allowed) VALUES ($1::uuid, true)', [
      guardId,
    ]);

    const sensitive = {
      ...request(key),
      sensitiveReplay: true,
      replayAuthorization: async (context: TransactionContext, guard: unknown) => {
        const id = (guard as { guard_id: string }).guard_id;
        const result = await context.query<{ allowed: boolean }>(
          'SELECT allowed FROM app.c1a1_guard_fixture WHERE guard_id = $1::uuid FOR UPDATE',
          [id],
        );
        if (result.rows[0]?.allowed !== true) throw new Error('fixture guard denied');
      },
    };

    await ex.execute(sensitive, (context) =>
      writeEffect(context, 'sensitive', { access_token: SECRET_RESPONSE }, { guard_id: guardId }),
    );
    await pool.query('UPDATE app.c1a1_guard_fixture SET allowed = false WHERE guard_id = $1::uuid', [
      guardId,
    ]);

    await expect(
      ex.execute(sensitive, () => {
        throw new Error('must not mint a new response');
      }),
    ).rejects.toThrow('fixture guard denied');
  });

  it('C19 — sensitive replay binds proof, active user and live session under ordered row locks', async () => {
    const key = randomUUID();
    const proofId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const ex = executor();

    await pool.query(
      "INSERT INTO app.c1a1_proof_fixture(proof_id, used, invalidated, expires_at) VALUES ($1::uuid, true, false, clock_timestamp() - interval '1 minute')",
      [proofId],
    );
    await pool.query('INSERT INTO app.c1a1_user_fixture(user_id, active) VALUES ($1::uuid, true)', [
      userId,
    ]);
    await pool.query(
      "INSERT INTO app.c1a1_session_fixture(session_id, user_id, proof_id, revoked, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, false, clock_timestamp() + interval '1 day')",
      [sessionId, userId, proofId],
    );

    const guard = { proof_id: proofId, user_id: userId, session_id: sessionId };
    const authorize = async (context: TransactionContext, value: import('../../apps/backend/src/shared/json/safe-json').JsonValue) => {
      const g = value as typeof guard;
      await context.query(
        'SELECT proof_id FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid FOR UPDATE',
        [g.proof_id],
      );
      const proof = await context.query<{ invalidated: boolean }>(
        'SELECT invalidated FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid',
        [g.proof_id],
      );
      if (proof.rows[0]?.invalidated !== false) throw new Error('proof invalidated');

      await context.query(
        'SELECT user_id FROM app.c1a1_user_fixture WHERE user_id = $1::uuid FOR UPDATE',
        [g.user_id],
      );
      const user = await context.query<{ active: boolean }>(
        'SELECT active FROM app.c1a1_user_fixture WHERE user_id = $1::uuid',
        [g.user_id],
      );
      if (user.rows[0]?.active !== true) throw new Error('user disabled');

      await context.query(
        'SELECT session_id FROM app.c1a1_session_fixture WHERE session_id = $1::uuid FOR UPDATE',
        [g.session_id],
      );
      const session = await context.query<{
        user_id: string;
        proof_id: string;
        revoked: boolean;
        fresh: boolean;
      }>(
        `SELECT user_id::text, proof_id::text, revoked,
                expires_at > clock_timestamp() AS fresh
         FROM app.c1a1_session_fixture
         WHERE session_id = $1::uuid`,
        [g.session_id],
      );
      const row = session.rows[0];
      if (
        row === undefined ||
        row.user_id !== g.user_id ||
        row.proof_id !== g.proof_id ||
        row.revoked ||
        !row.fresh
      ) {
        throw new Error('session denied');
      }
    };

    const req = {
      ...request(key),
      operationId: 'fixture.sensitive.v1',
      sensitiveReplay: true,
      replayAuthorization: authorize,
    };
    await ex.execute(req, (context) =>
      writeEffect(context, 'full-binding', { access_token: SECRET_RESPONSE }, guard),
    );
    expect((await ex.execute(req, () => Promise.reject(new Error('must replay')))).replayed).toBe(true);

    await pool.query('UPDATE app.c1a1_user_fixture SET active = false WHERE user_id = $1::uuid', [userId]);
    await expect(ex.execute(req, () => Promise.reject(new Error('must replay')))).rejects.toThrow(
      'user disabled',
    );
    await pool.query('UPDATE app.c1a1_user_fixture SET active = true WHERE user_id = $1::uuid', [userId]);

    await pool.query('UPDATE app.c1a1_session_fixture SET revoked = true WHERE session_id = $1::uuid', [
      sessionId,
    ]);
    await expect(ex.execute(req, () => Promise.reject(new Error('must replay')))).rejects.toThrow(
      'session denied',
    );
    await pool.query('UPDATE app.c1a1_session_fixture SET revoked = false, user_id = $2::uuid WHERE session_id = $1::uuid', [
      sessionId,
      randomUUID(),
    ]);
    await expect(ex.execute(req, () => Promise.reject(new Error('must replay')))).rejects.toThrow(
      'session denied',
    );
  });

  it('C17/C19 — session expiry while waiting on its row lock denies replay with fresh DB state', async () => {
    const key = randomUUID();
    const proofId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const ex = executor({ businessLockTimeoutMs: 3000 });
    const hookStarted = deferred();

    await pool.query(
      "INSERT INTO app.c1a1_proof_fixture(proof_id, used, invalidated, expires_at) VALUES ($1::uuid, true, false, clock_timestamp() + interval '1 day')",
      [proofId],
    );
    await pool.query('INSERT INTO app.c1a1_user_fixture(user_id, active) VALUES ($1::uuid, true)', [userId]);
    await pool.query(
      "INSERT INTO app.c1a1_session_fixture(session_id, user_id, proof_id, revoked, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, false, clock_timestamp() + interval '700 milliseconds')",
      [sessionId, userId, proofId],
    );
    const guard = { proof_id: proofId, user_id: userId, session_id: sessionId };
    const req = {
      ...request(key),
      operationId: 'fixture.session-expiry.v1',
      sensitiveReplay: true,
      replayAuthorization: async (context: TransactionContext, value: import('../../apps/backend/src/shared/json/safe-json').JsonValue) => {
        const g = value as typeof guard;
        await context.query('SELECT proof_id FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid FOR UPDATE', [g.proof_id]);
        await context.query('SELECT user_id FROM app.c1a1_user_fixture WHERE user_id = $1::uuid FOR UPDATE', [g.user_id]);
        hookStarted.resolve();
        await context.query(
          'SELECT session_id FROM app.c1a1_session_fixture WHERE session_id = $1::uuid FOR UPDATE',
          [g.session_id],
        );
        const session = await context.query<{ fresh: boolean }>(
          'SELECT expires_at > clock_timestamp() AS fresh FROM app.c1a1_session_fixture WHERE session_id = $1::uuid',
          [g.session_id],
        );
        if (session.rows[0]?.fresh !== true) throw new Error('session expired');
      },
    };

    await ex.execute(req, (context) =>
      writeEffect(context, 'session-expiry', { access_token: SECRET_RESPONSE }, guard),
    );

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT session_id FROM app.c1a1_session_fixture WHERE session_id = $1::uuid FOR UPDATE',
        [sessionId],
      );
      const replay = ex.execute(req, () => Promise.reject(new Error('must replay')));
      await hookStarted.promise;
      await eventually(async () => {
        const state = await pool.query<{ fresh: boolean }>(
          'SELECT expires_at > clock_timestamp() AS fresh FROM app.c1a1_session_fixture WHERE session_id = $1::uuid',
          [sessionId],
        );
        return state.rows[0]?.fresh === false;
      }, 'session expires while replay waits for row lock', 2000);
      await holder.query('COMMIT');
      await expect(replay).rejects.toThrow('session expired');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('C19 — replay guard row lock fences a concurrent revocation update', async () => {
    const key = randomUUID();
    const guardId = randomUUID();
    const hookLocked = deferred();
    const releaseHook = deferred();
    const ex = executor({ businessLockTimeoutMs: 1500 });
    await pool.query('INSERT INTO app.c1a1_guard_fixture(guard_id, allowed) VALUES ($1::uuid, true)', [
      guardId,
    ]);

    await ex.execute(request(key), (context) =>
      writeEffect(context, 'guard-lock', { access_token: SECRET_RESPONSE }, { guard_id: guardId }),
    );

    const replay = ex.execute(
      {
        ...request(key),
        sensitiveReplay: true,
        replayAuthorization: async (context, guard) => {
          const id = (guard as { guard_id: string }).guard_id;
          await context.query(
            'SELECT allowed FROM app.c1a1_guard_fixture WHERE guard_id = $1::uuid FOR UPDATE',
            [id],
          );
          hookLocked.resolve();
          await releaseHook.promise;
        },
      },
      () => {
        throw new Error('must replay');
      },
    );
    await hookLocked.promise;

    const updater = await pool.connect();
    let updatePromise: Promise<unknown> | undefined;
    try {
      const pid = (await updater.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      updatePromise = updater.query(
        'UPDATE app.c1a1_guard_fixture SET allowed = false WHERE guard_id = $1::uuid',
        [guardId],
      );
      await eventually(async () => {
        const state = await pool.query<{ wait_event_type: string | null }>(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
          [pid],
        );
        return state.rows[0]?.wait_event_type === 'Lock';
      }, 'revocation waits behind replay guard row lock');
      releaseHook.resolve();
      await replay;
      await updatePromise;
    } finally {
      releaseHook.resolve();
      await updatePromise?.catch(() => undefined);
      updater.release();
    }
  });

  it('C21-A1 — COMMIT unknown retries by replaying the committed record, not the callback', async () => {
    const key = randomUUID();
    const source = faultySource(pool, (text, real) =>
      text === 'COMMIT'
        ? real.query('COMMIT').then(() =>
            Promise.reject(Object.assign(new Error('ack lost'), { code: 'ECONNRESET' })),
          )
        : undefined,
    );
    let calls = 0;
    const first = executor({}, fixtureKeyring('k1'), source);
    const error = await failureOf(() =>
      first.execute(request(key), async (context) => {
        calls += 1;
        return writeEffect(context, 'unknown-commit');
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');

    const retry = await executor().execute(request(key), async (context) => {
      calls += 1;
      return writeEffect(context, 'unknown-commit');
    });
    expect(retry.replayed).toBe(true);
    expect(calls).toBe(1);
    const effect = await pool.query<{ hits: number }>(
      "SELECT hits FROM app.c1a1_effects WHERE effect_key = 'unknown-commit'",
    );
    expect(effect.rows[0]?.hits).toBe(1);
  });

  it('C29 — database acquisition outage is technical failure, never IDEMPOTENCY_BUSY', async () => {
    const failingSource = {
      acquire: async () => {
        throw Object.assign(new Error('fixture outage'), { code: 'ECONNREFUSED' });
      },
    };
    const error = await failureOf(() =>
      executor({}, fixtureKeyring('k1'), failingSource).execute(request(randomUUID()), () => {
        throw new Error('must not run callback');
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
  });

  it('C29 — advisory timeout alone maps to IDEMPOTENCY_BUSY and lock_timeout is restored after acquisition', async () => {
    const key = randomUUID();
    const [a, b] = idempotencyLockKey(SCOPE, SCOPE_ID, OPERATION, key);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [a, b]);

      const error = await failureOf(() =>
        executor({ advisoryWaitMs: 50 }).execute(request(key), (context) =>
          writeEffect(context, 'busy'),
        ),
      );
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('IDEMPOTENCY_BUSY');
      await holder.query('ROLLBACK');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    let observed = '';
    await executor({ businessLockTimeoutMs: 321 }).execute(request(randomUUID()), async (context) => {
      const setting = await context.query<{ lock_timeout: string }>('SHOW lock_timeout');
      observed = setting.rows[0]?.lock_timeout ?? '';
      return writeEffect(context, 'restore');
    });
    expect(observed).toBe('321ms');
  });

  it('C29 — row-lock timeout is not misclassified as IDEMPOTENCY_BUSY', async () => {
    const key = randomUUID();
    await executor().execute(request(key), (context) => writeEffect(context, 'row-lock'));
    const holder: PoolClient = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT record_id FROM app.idempotency_records WHERE idempotency_key = $1::uuid FOR UPDATE',
        [key],
      );

      const error = await failureOf(() =>
        executor({ businessLockTimeoutMs: 50 }).execute(request(key), () => {
          throw new Error('must not reach callback');
        }),
      );
      expect(error).not.toBeInstanceOf(AppError);
      expect((error as { code?: string }).code).toBe('55P03');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('C29 — forced advisory-hash collision serializes but exact rows never replay each other', async () => {
    const constantLock = () => [123, 456] as const;
    const ex = executor({ advisoryWaitMs: 1500 }, fixtureKeyring('k1'), poolClientSource(pool), constantLock);
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let callsA = 0;
    let callsB = 0;
    const keyA = randomUUID();
    const keyB = randomUUID();

    const a = ex.execute(request(keyA, { n: 1 }), async (context) => {
      callsA += 1;
      firstEntered.resolve();
      await releaseFirst.promise;
      return writeEffect(context, 'collision-a', { owner: 'a' });
    });
    await firstEntered.promise;
    const b = ex.execute(request(keyB, { n: 2 }), async (context) => {
      callsB += 1;
      return writeEffect(context, 'collision-b', { owner: 'b' });
    });

    await eventually(async () => {
      const waiting = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query LIKE 'SELECT pg_advisory_xact_lock%'`,
      );
      return Number(waiting.rows[0]?.count ?? '0') >= 1;
    }, 'hash collision serializes on advisory lock');
    releaseFirst.resolve();

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.responseBody).toEqual({ owner: 'a' });
    expect(rb.responseBody).toEqual({ owner: 'b' });
    expect(ra.replayed).toBe(false);
    expect(rb.replayed).toBe(false);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
  });

  it('C10/C17 — cleanup uses SKIP LOCKED, clears replay first, then deletes dedupe tombstones', async () => {
    const lockedKey = randomUUID();
    const freeKey = randomUUID();
    const ex = executor();
    await ex.execute(request(lockedKey), (context) => writeEffect(context, 'cleanup-locked'));
    await ex.execute(request(freeKey), (context) => writeEffect(context, 'cleanup-free'));
    await setExpired(lockedKey, false);
    await setExpired(freeKey, false);

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT record_id FROM app.idempotency_records WHERE idempotency_key = $1::uuid FOR UPDATE',
        [lockedKey],
      );
      const cleanup = new IdempotencyCleanup(managerFor(poolClientSource(pool)));
      const first = await cleanup.runBatch(10);
      expect(first.replayPayloadsCleared).toBe(1);
      expect(first.tombstonesDeleted).toBe(0);

      const states = await pool.query<{ idempotency_key: string; has_payload: boolean }>(
        'SELECT idempotency_key::text, replay_ciphertext IS NOT NULL AS has_payload FROM app.idempotency_records ORDER BY idempotency_key',
      );
      const map = new Map(states.rows.map((row) => [row.idempotency_key, row.has_payload]));
      expect(map.get(lockedKey)).toBe(true);
      expect(map.get(freeKey)).toBe(false);

      await holder.query('COMMIT');
      const second = await cleanup.runBatch(10);
      expect(second.replayPayloadsCleared).toBe(1);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    await pool.query(
      "UPDATE app.idempotency_records SET dedupe_expires_at = date_trunc('milliseconds', clock_timestamp() - interval '1 millisecond')",
    );
    const cleanup = new IdempotencyCleanup(managerFor(poolClientSource(pool)));
    const deleted = await cleanup.runBatch(10);
    expect(deleted.tombstonesDeleted).toBe(2);
    expect(
      Number(
        (await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM app.idempotency_records'))
          .rows[0]?.count,
      ),
    ).toBe(0);
  });

  it('C18 — consumed/naturally-expired proof can resolve replay, but a new execution must reject it', async () => {
    const key = randomUUID();
    const proofId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const logical = { verification_token: `proof:${proofId}`, password: SECRET_PASSWORD, device: 'fixture' };
    const ex = executor();
    let mintCount = 0;
    let guardCount = 0;

    await pool.query(
      "INSERT INTO app.c1a1_proof_fixture(proof_id, used, invalidated, expires_at) VALUES ($1::uuid, false, false, clock_timestamp() + interval '1 day')",
      [proofId],
    );

    const replayAuthorization = async (context: TransactionContext, guard: import('../../apps/backend/src/shared/json/safe-json').JsonValue) => {
      guardCount += 1;
      const id = (guard as { proof_id: string }).proof_id;
      await context.query(
        'SELECT proof_id FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid FOR UPDATE',
        [id],
      );
      const proof = await context.query<{ invalidated: boolean }>(
        'SELECT invalidated FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid',
        [id],
      );
      if (proof.rows[0]?.invalidated !== false) throw new Error('proof invalidated');
    };

    const work = async (context: TransactionContext) => {
      await context.query(
        'SELECT proof_id FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid FOR UPDATE',
        [proofId],
      );
      const proof = await context.query<{ used: boolean; invalidated: boolean; fresh: boolean }>(
        `SELECT used, invalidated, expires_at > clock_timestamp() AS fresh
         FROM app.c1a1_proof_fixture WHERE proof_id = $1::uuid`,
        [proofId],
      );
      const row = proof.rows[0];
      if (row === undefined || row.used || row.invalidated || !row.fresh) {
        throw new Error('proof not eligible for new execution');
      }
      await context.query('UPDATE app.c1a1_proof_fixture SET used = true WHERE proof_id = $1::uuid', [proofId]);
      mintCount += 1;
      return writeEffect(context, 'proof-protocol', { access_token: SECRET_RESPONSE }, { proof_id: proofId, user_id: userId, session_id: sessionId });
    };

    const req = { ...request(key, logical), sensitiveReplay: true, replayAuthorization };
    const first = await ex.execute(req, work);
    expect(first.replayed).toBe(false);
    expect(mintCount).toBe(1);

    const persisted = await pool.query<{ stored: string }>(
      `SELECT row_to_json(r)::text AS stored
       FROM app.idempotency_records AS r
       WHERE idempotency_key = $1::uuid`,
      [key],
    );
    expect(persisted.rows[0]?.stored).not.toContain(logical.verification_token);
    expect(persisted.rows[0]?.stored).not.toContain(SECRET_PASSWORD);

    // Natural proof expiry after a committed result does not block lookup/replay.
    await pool.query(
      "UPDATE app.c1a1_proof_fixture SET expires_at = clock_timestamp() - interval '1 second' WHERE proof_id = $1::uuid",
      [proofId],
    );
    const replay = await ex.execute(req, work);
    expect(replay.replayed).toBe(true);
    expect(mintCount).toBe(1);
    expect(guardCount).toBe(1);

    // A different idempotency key has no record, so the new-execution proof checks run and reject used/expired.
    await expect(ex.execute({ ...req, idempotencyKey: randomUUID() }, work)).rejects.toThrow(
      'proof not eligible for new execution',
    );
    expect(mintCount).toBe(1);

    // Same key but changed password conflicts before the sensitive replay guard/decrypt path.
    const changed = await failureOf(() =>
      ex.execute({ ...req, logicalRequest: { ...logical, password: 'changed' } }, work),
    );
    expect(changed).toBeInstanceOf(AppError);
    expect((changed as AppError).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(guardCount).toBe(1);

    // Explicit invalidation does block an already-committed sensitive replay.
    await pool.query('UPDATE app.c1a1_proof_fixture SET invalidated = true WHERE proof_id = $1::uuid', [proofId]);
    await expect(ex.execute(req, work)).rejects.toThrow('proof invalidated');
    expect(mintCount).toBe(1);
  });

  it('C17 — replay TTL is rechecked with fresh DB time after waiting in the authorization hook', async () => {
    const key = randomUUID();
    const guardId = randomUUID();
    const hookStarted = deferred();
    const holder = await pool.connect();
    const ex = executor({
      replayTtlSeconds: 1,
      dedupeTtlSeconds: 30,
      businessLockTimeoutMs: 3000,
    });

    await pool.query('INSERT INTO app.c1a1_guard_fixture(guard_id, allowed) VALUES ($1::uuid, true)', [guardId]);
    const req = {
      ...request(key),
      sensitiveReplay: true,
      replayAuthorization: async (
        context: TransactionContext,
        guard: import('../../apps/backend/src/shared/json/safe-json').JsonValue,
      ) => {
        hookStarted.resolve();
        await context.query(
          'SELECT allowed FROM app.c1a1_guard_fixture WHERE guard_id = $1::uuid FOR UPDATE',
          [(guard as { guard_id: string }).guard_id],
        );
      },
    };

    await ex.execute(req, (context) =>
      writeEffect(context, 'ttl-wait', { access_token: SECRET_RESPONSE }, { guard_id: guardId }),
    );

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT guard_id FROM app.c1a1_guard_fixture WHERE guard_id = $1::uuid FOR UPDATE', [guardId]);

      const replay = ex.execute(req, () => {
        throw new Error('must not execute');
      });
      await hookStarted.promise;

      await eventually(async () => {
        const state = await pool.query<{ expired: boolean }>(
          'SELECT replay_expires_at <= clock_timestamp() AS expired FROM app.idempotency_records WHERE idempotency_key = $1::uuid',
          [key],
        );
        return state.rows[0]?.expired === true;
      }, 'replay TTL expires while authorization is waiting', 2500);

      await holder.query('COMMIT');
      const error = await failureOf(() => replay);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('C30 — after dedupe expiry, concurrent retries create one committed effect in the new window', async () => {
    const key = randomUUID();
    const ex = executor({ advisoryWaitMs: 1500 });
    await ex.execute(request(key), (context) => writeEffect(context, 'new-window'));
    await setExpired(key, true);

    const entered = deferred();
    const release = deferred();
    let newWindowCalls = 0;
    const first = ex.execute(request(key), async (context) => {
      newWindowCalls += 1;
      entered.resolve();
      await release.promise;
      return writeEffect(context, 'new-window');
    });
    await entered.promise;
    const second = ex.execute(request(key), async (context) => {
      newWindowCalls += 1;
      return writeEffect(context, 'new-window');
    });

    await eventually(async () => {
      const waiting = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query LIKE 'SELECT pg_advisory_xact_lock%'`,
      );
      return Number(waiting.rows[0]?.count ?? '0') >= 1;
    }, 'second retry waits for the new-window owner');
    release.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(newWindowCalls).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const effect = await pool.query<{ hits: number }>(
      "SELECT hits FROM app.c1a1_effects WHERE effect_key = 'new-window'",
    );
    expect(effect.rows[0]?.hits).toBe(2);
  });

});
