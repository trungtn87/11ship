import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import { configureApp } from '../../apps/backend/src/app.setup';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { FIXTURE_MASTER_K2 } from '../../apps/backend/src/crypto/test-keys.fixture';
import { JsonLogger } from '../../apps/backend/src/logging/json-logger';
import { LoggingModule } from '../../apps/backend/src/logging/logging.module';
import {
  appCodeOf,
  ageRecord,
  countItems,
  createHarness,
  createItemWork,
  errorOf,
  IdempotencyHarness,
  LockHolder,
  lockPairOf,
  newKey,
  newScopeId,
  onlyRecord,
  recordsOf,
  requestOf,
  SECRET_PASSWORD,
  SECRET_TOKEN,
} from './support/idempotency-fixtures';
import { IdempotencyHarnessContext, IdempotencyHarnessModule } from './support/idempotency-harness';
import { UUID_PATTERN } from './support/test-helpers';
import { expectPoolRecovered, faultySource, managerFor } from './support/transaction-fixtures';

interface Envelope {
  error: { code: string; message: string; request_id: string; details: Record<string, unknown> };
}

const LEAK_MARKERS = ['SELECT ', 'INSERT ', 'app.idempotency_records', 'password', SECRET_PASSWORD, 'ECONNRESET', '55P03'];

// M00-C1A1 — a COMMIT whose acknowledgement is lost (C21, integrated with the executor) and every
// idempotency error code through the REAL Nest HTTP pipeline (C22). Only the lost acknowledgement is
// injected, at the client boundary of the real pool; rows, locks and commits are real PostgreSQL.
describe('M00-C1A1 — COMMIT outcome unknown and HTTP error mapping', () => {
  let h: IdempotencyHarness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  describe('C21 — unknown COMMIT with the executor', () => {
    it('the server COMMITTED but the acknowledgement was lost: TRANSACTION_OUTCOME_UNKNOWN, no auto-retry; a retry with the same key REPLAYS (callback total = 1)', async () => {
      const lost = managerFor(
        faultySource(h.pool, (text, real) =>
          text === 'COMMIT'
            ? real.query('COMMIT').then(() => Promise.reject(Object.assign(new Error('injected: ack lost'), { code: 'ECONNRESET' })))
            : undefined,
        ),
      );
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };

      const error = await errorOf(() =>
        h.executor({ manager: lost }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)),
      );
      expect(appCodeOf(error)).toBe('TRANSACTION_OUTCOME_UNKNOWN');
      expect((error as AppError).status).toBe(503);
      expect(calls.n).toBe(1); // never run a second time by the executor or the manager
      expect(await countItems(h, scopeId)).toBe(1); // it really did commit
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);

      const retry = await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(retry.replayed).toBe(true);
      expect((retry.payload as { access_token: string }).access_token).toBe(SECRET_TOKEN);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
      await expectPoolRecovered(h.pool);
    });

    it('COMMIT never reached the server: also UNKNOWN to the caller, nothing is stored, and the retry executes exactly once', async () => {
      const lost = managerFor(
        faultySource(h.pool, (text) =>
          text === 'COMMIT' ? Promise.reject(Object.assign(new Error('injected: COMMIT lost'), { code: 'ECONNRESET' })) : undefined,
        ),
      );
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };

      const error = await errorOf(() =>
        h.executor({ manager: lost }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)),
      );
      expect(appCodeOf(error)).toBe('TRANSACTION_OUTCOME_UNKNOWN');
      expect(calls.n).toBe(1);

      await expectPoolRecovered(h.pool);
      // The lost COMMIT left the server to roll the abandoned session back.
      await h.pool.query('SELECT 1');
      const retry = await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(retry.replayed).toBe(false);
      expect(calls.n).toBe(2);
      expect(await countItems(h, scopeId)).toBe(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });
  });

  describe('C22 — idempotency errors through the real HTTP pipeline', () => {
    let app: INestApplication;
    let baseUrl: string;
    const logs: string[] = [];
    const requestIds = new Set<string>();
    const callbacks = new Map<string, number>();

    beforeAll(async () => {
      const logger = new JsonLogger((line) => {
        logs.push(line);
      });
      const lostAck = managerFor(
        faultySource(h.pool, (text, real) =>
          text === 'COMMIT'
            ? real.query('COMMIT').then(() => Promise.reject(Object.assign(new Error('injected ack lost'), { code: 'ECONNRESET' })))
            : undefined,
        ),
      );
      const context: IdempotencyHarnessContext = {
        harness: h,
        callbacks,
        executors: {
          normal: h.executor({ config: { advisoryWaitMs: 50, businessLockTimeoutMs: 100 } }),
          k2only: h.executor({ keyring: new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2') }),
          lostack: h.executor({ manager: lostAck }),
        },
      };
      const moduleRef = await Test.createTestingModule({
        imports: [LoggingModule.forRoot(logger), IdempotencyHarnessModule.register(context)],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await app.close();
    });

    async function post(
      profile: string,
      scope: string,
      key: string | undefined,
      body: unknown = { name: 'Alice', password: SECRET_PASSWORD },
    ): Promise<{ status: number; text: string; json: Envelope & Record<string, unknown>; header: string | null }> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (key !== undefined) {
        headers['idempotency-key'] = key;
      }
      const response = await fetch(`${baseUrl}/v1/harness/idempotent/${profile}/${scope}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const json = JSON.parse(text) as Envelope & Record<string, unknown>;
      if (json.error?.request_id !== undefined) {
        requestIds.add(json.error.request_id);
      }
      return { status: response.status, text, json, header: response.headers.get('x-request-id') };
    }

    function expectEnvelope(result: { status: number; text: string; json: Envelope; header: string | null }, status: number, code: string): void {
      expect(result.status).toBe(status);
      expect(result.json.error.code).toBe(code);
      expect(result.json.error.details).toEqual({});
      expect(result.json.error.request_id).toMatch(UUID_PATTERN);
      expect(result.json.error.request_id).toBe(result.header);
      for (const marker of LEAK_MARKERS) {
        expect(result.text).not.toContain(marker);
      }
      expect(result.text).not.toContain(SECRET_TOKEN);
    }

    it('success and replay: 201 with the logical payload, the second time without running the callback', async () => {
      const scope = newScopeId();
      const key = newKey();
      const first = await post('normal', scope, key);
      expect(first.status).toBe(201);
      const second = await post('normal', scope, key);
      expect(second.status).toBe(201);
      expect(second.json).toEqual(first.json);
      expect(callbacks.get(scope)).toBe(1);
    });

    it('IDEMPOTENCY_KEY_REQUIRED (400) and INVALID_IDEMPOTENCY_KEY (400)', async () => {
      const scope = newScopeId();
      expectEnvelope(await post('normal', scope, undefined), 400, 'IDEMPOTENCY_KEY_REQUIRED');
      expectEnvelope(await post('normal', scope, 'not-a-uuid'), 400, 'INVALID_IDEMPOTENCY_KEY');
      expectEnvelope(await post('normal', scope, '00000000-0000-0000-0000-000000000000'), 400, 'INVALID_IDEMPOTENCY_KEY');
      expect(callbacks.get(scope)).toBeUndefined();
    });

    it('IDEMPOTENCY_KEY_REUSED (409) for the same key with a different body', async () => {
      const scope = newScopeId();
      const key = newKey();
      await post('normal', scope, key);
      expectEnvelope(await post('normal', scope, key, { name: 'Mallory' }), 409, 'IDEMPOTENCY_KEY_REUSED');
      expect(callbacks.get(scope)).toBe(1);
    });

    it('IDEMPOTENCY_BUSY (409) while another request holds the key', async () => {
      const scope = newScopeId();
      const key = newKey();
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.advisory(lockPairOf(h.scopeType, scope, 'harness.create.v1', key));
        expectEnvelope(await post('normal', scope, key), 409, 'IDEMPOTENCY_BUSY');
      } finally {
        await holder.rollback();
      }
      expect(callbacks.get(scope)).toBeUndefined();
    });

    it('a row-lock timeout is NOT IDEMPOTENCY_BUSY over HTTP: it is the generic 500', async () => {
      const scope = newScopeId();
      const key = newKey();
      await post('normal', scope, key);
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.lockRecordRow(h, scope, key);
        const result = await post('normal', scope, key);
        expectEnvelope(result, 500, 'INTERNAL_ERROR');
      } finally {
        await holder.rollback();
      }
      expect(callbacks.get(scope)).toBe(1);
    });

    it('IDEMPOTENCY_REPLAY_EXPIRED (409) after the replay window, without decrypting', async () => {
      const scope = newScopeId();
      const key = newKey();
      await post('normal', scope, key);
      await ageRecord(h, (await onlyRecord(h, scope, key)).record_id, 1000);
      expectEnvelope(await post('normal', scope, key), 409, 'IDEMPOTENCY_REPLAY_EXPIRED');
      expect(callbacks.get(scope)).toBe(1);
    });

    it('IDEMPOTENCY_KEY_UNAVAILABLE (503) when the record key was removed from the keyring; no re-execution', async () => {
      const scope = newScopeId();
      const key = newKey();
      await post('normal', scope, key);
      expectEnvelope(await post('k2only', scope, key), 503, 'IDEMPOTENCY_KEY_UNAVAILABLE');
      expect(callbacks.get(scope)).toBe(1);
      expect(await countItems(h, scope)).toBe(1);
    });

    it('TRANSACTION_OUTCOME_UNKNOWN (503) for a lost COMMIT acknowledgement; the retry replays with the callback total = 1', async () => {
      const scope = newScopeId();
      const key = newKey();
      expectEnvelope(await post('lostack', scope, key), 503, 'TRANSACTION_OUTCOME_UNKNOWN');
      expect(callbacks.get(scope)).toBe(1);

      const retry = await post('normal', scope, key);
      expect(retry.status).toBe(201);
      expect((retry.json as unknown as { access_token: string }).access_token).toBe(SECRET_TOKEN);
      expect(callbacks.get(scope)).toBe(1);
      expect(await countItems(h, scope)).toBe(1);
    });

    it('a corrupted record is the generic 500 INTERNAL_ERROR: no crypto detail, no payload, no re-execution', async () => {
      const scope = newScopeId();
      const key = newKey();
      await post('normal', scope, key);
      await h.pool.query(
        `UPDATE app.idempotency_records SET replay_tag = set_byte(replay_tag, 0, (get_byte(replay_tag, 0)::int # 1))
          WHERE scope_type = $1 AND scope_id = $2`,
        [h.scopeType, scope],
      );
      const result = await post('normal', scope, key);
      expect(result.status).toBe(500);
      expect(result.json.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: result.json.error.request_id,
        details: {},
      });
      expect(result.text).not.toContain(SECRET_TOKEN);
      expect(callbacks.get(scope)).toBe(1);
    });

    it('every error response carries a NEW request_id and no log line leaks a secret, SQL or key material', () => {
      expect(requestIds.size).toBeGreaterThanOrEqual(9);
      const everything = logs.join('\n');
      for (const secret of [SECRET_PASSWORD, SECRET_TOKEN, 'INSERT INTO', 'app.idempotency_records']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('leaves the pool healthy after all of the above', async () => {
      await expectPoolRecovered(h.pool);
    });
  });
});
