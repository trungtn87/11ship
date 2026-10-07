import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { CryptoError } from '../../apps/backend/src/crypto/crypto-error';
import { KeyVersion } from '../../apps/backend/src/crypto/key-version';
import { deferred } from './support/async-helpers';
import {
  appCodeOf,
  countItems,
  createHarness,
  createItemWork,
  errorOf,
  grantHook,
  IdempotencyHarness,
  insertItem,
  newKey,
  newScopeId,
  onlyRecord,
  ReplayDenied,
  requestOf,
  SECRET_PASSWORD,
  SECRET_TOKEN,
  seedGrant,
  waitForBlockedStatement,
} from './support/idempotency-fixtures';
import { ReplayAuthorizationHook } from '../../apps/backend/src/idempotency/idempotency-executor';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { randomBytes } from 'node:crypto';

// M00-C1A1 — replay authorization (C18, C19) and tamper/corruption (C20, C08) on a REAL PostgreSQL.
// The "register" operation below is a FIXTURE of the pattern M01 will implement; no Auth code exists.
describe('M00-C1A1 — replay guard, authorization races and tamper', () => {
  let h: IdempotencyHarness;
  let proofs: string;

  beforeAll(async () => {
    h = await createHarness();
    proofs = `${h.schema}.proofs`;
    await h.pool.query(
      `CREATE TABLE ${proofs} (proof_id text PRIMARY KEY, state text NOT NULL, expires_at timestamptz NOT NULL)`,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  class ProofRejected extends Error {}

  async function seedProof(state = 'unused', expiresInSeconds = 600): Promise<string> {
    const proofId = `p-${randomBytes(5).toString('hex')}`;
    await h.pool.query(
      `INSERT INTO ${proofs} (proof_id, state, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3::double precision))`,
      [proofId, state, expiresInSeconds],
    );
    return proofId;
  }

  /**
   * Fixture register operation. The scope is the PROOF identity (resolved before anything is
   * consumed); only the new-owner callback checks that the proof is unused and not expired.
   */
  function registerWork(proofId: string, minted: { n: number }) {
    return async (context: TransactionContext) => {
      const proof = await context.query<{ state: string; live: boolean }>(
        `SELECT state, expires_at > clock_timestamp() AS live FROM ${proofs} WHERE proof_id = $1 FOR UPDATE`,
        [proofId],
      );
      const row = proof.rows[0];
      if (row === undefined || row.state !== 'unused' || !row.live) {
        throw new ProofRejected('proof is not usable');
      }
      await context.query(`UPDATE ${proofs} SET state = 'used' WHERE proof_id = $1`, [proofId]);
      const sessionId = `sess-${randomBytes(5).toString('hex')}`;
      await context.query(`INSERT INTO ${h.grants} (grant_id, owner_id) VALUES ($1, $2)`, [sessionId, `user-of-${proofId}`]);
      await insertItem(h, context, proofId, 'registered-user');
      minted.n += 1;
      return {
        status: 201,
        replayGuard: { grant_id: sessionId, proof_id: proofId },
        payload: { access_token: `${SECRET_TOKEN}-${sessionId}`, session_id: sessionId },
      };
    };
  }

  /** Hook of the register replay: session not revoked AND proof not invalidated, both locked FOR SHARE. */
  function registerHook(proofId: string, calls: { n: number }): ReplayAuthorizationHook {
    const sessionHook = grantHook(h, `user-of-${proofId}`);
    return async (context, guard) => {
      calls.n += 1;
      const proof = await context.query<{ state: string }>(
        `SELECT state FROM ${proofs} WHERE proof_id = $1 FOR SHARE`,
        [guard['proof_id']],
      );
      if (proof.rows[0] === undefined || proof.rows[0].state === 'invalidated') {
        throw new ReplayDenied('proof invalidated');
      }
      return sessionHook(context, guard);
    };
  }

  function registerRequest(proofId: string, key: string, hookCalls: { n: number }, body: Record<string, unknown> = {}) {
    return requestOf({
      harness: h,
      scopeId: proofId,
      key,
      operationId: 'auth.register.v1',
      logicalRequest: { proof_id: proofId, password: SECRET_PASSWORD, name: 'Alice', ...body },
      replay: { kind: 'sensitive', authorize: registerHook(proofId, hookCalls) },
    });
  }

  describe('C18 — register fixture: consumed and expired proofs, retention and denial', () => {
    it('a retry after success replays the SAME token even though the proof is now used AND expired; no new token is minted', async () => {
      const proofId = await seedProof();
      const key = newKey();
      const minted = { n: 0 };
      const hookCalls = { n: 0 };
      const executor = h.executor();

      const first = await executor.execute(registerRequest(proofId, key, hookCalls), registerWork(proofId, minted));
      expect(first.replayed).toBe(false);
      await h.pool.query(`UPDATE ${proofs} SET expires_at = now() - interval '1 hour' WHERE proof_id = $1`, [proofId]);

      const retry = await executor.execute(registerRequest(proofId, key, hookCalls), registerWork(proofId, minted));
      expect(retry.replayed).toBe(true);
      expect(retry.payload).toEqual(first.payload);
      expect(minted.n).toBe(1);
      expect(hookCalls.n).toBe(1);
      expect(await countItems(h, proofId)).toBe(1);
    });

    it('a NEW key with an already used or an expired proof runs the callback, which rejects it: nothing is minted or stored', async () => {
      const usedProof = await seedProof();
      const minted = { n: 0 };
      const hookCalls = { n: 0 };
      const executor = h.executor();
      await executor.execute(registerRequest(usedProof, newKey(), hookCalls), registerWork(usedProof, minted));

      const keyUsed = newKey();
      const usedError = await errorOf(() => executor.execute(registerRequest(usedProof, keyUsed, hookCalls), registerWork(usedProof, minted)));
      expect(usedError).toBeInstanceOf(ProofRejected);

      const expiredProof = await seedProof('unused', -60);
      const keyExpired = newKey();
      const expiredError = await errorOf(() => executor.execute(registerRequest(expiredProof, keyExpired, hookCalls), registerWork(expiredProof, minted)));
      expect(expiredError).toBeInstanceOf(ProofRejected);

      expect(minted.n).toBe(1);
      expect(await countItems(h, usedProof)).toBe(1);
      expect(await countItems(h, expiredProof)).toBe(0);
      expect((await h.pool.query(`SELECT 1 FROM app.idempotency_records WHERE scope_type = $1 AND idempotency_key = ANY($2::text[])`, [h.scopeType, [keyUsed, keyExpired]])).rowCount).toBe(0);
    });

    it('an INVALIDATED proof denies the replay; no token is returned or decrypted', async () => {
      const proofId = await seedProof();
      const key = newKey();
      const minted = { n: 0 };
      const hookCalls = { n: 0 };
      const executor = h.executor();
      await executor.execute(registerRequest(proofId, key, hookCalls), registerWork(proofId, minted));
      await h.pool.query(`UPDATE ${proofs} SET state = 'invalidated' WHERE proof_id = $1`, [proofId]);

      const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
      try {
        const error = await errorOf(() => executor.execute(registerRequest(proofId, key, hookCalls), registerWork(proofId, minted)));
        expect(error).toBeInstanceOf(ReplayDenied);
        expect(decrypt).not.toHaveBeenCalled();
      } finally {
        decrypt.mockRestore();
      }
      expect(minted.n).toBe(1);
    });

    it('only the key, or the key with a changed password or body, is refused before the hook runs; no token is minted', async () => {
      const proofId = await seedProof();
      const key = newKey();
      const minted = { n: 0 };
      const hookCalls = { n: 0 };
      const executor = h.executor();
      await executor.execute(registerRequest(proofId, key, hookCalls), registerWork(proofId, minted));
      expect(hookCalls.n).toBe(0);

      const variants: Array<Record<string, unknown>> = [{ password: 'a-different-password' }, { name: 'Mallory' }];
      for (const variant of variants) {
        const error = await errorOf(() => executor.execute(registerRequest(proofId, key, hookCalls, variant), registerWork(proofId, minted)));
        expect(appCodeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
      }
      // "only the key": a request that does not carry the password at all
      const keyOnly = await errorOf(() =>
        executor.execute(
          requestOf({
            harness: h,
            scopeId: proofId,
            key,
            operationId: 'auth.register.v1',
            logicalRequest: { proof_id: proofId },
            replay: { kind: 'sensitive', authorize: registerHook(proofId, hookCalls) },
          }),
          registerWork(proofId, minted),
        ),
      );
      expect(appCodeOf(keyOnly)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(hookCalls.n).toBe(0);
      expect(minted.n).toBe(1);
    });
  });

  describe('C19 — authorization races on a sensitive replay', () => {
    async function sealed(): Promise<{ scopeId: string; key: string; calls: { n: number } }> {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seedGrant(h, scopeId, 'owner-1');
      await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      return { scopeId, key, calls };
    }

    it('revoke COMMITTED before the guard -> deny, and the payload is never decrypted', async () => {
      const { scopeId, key, calls } = await sealed();
      await h.pool.query(`UPDATE ${h.grants} SET revoked = true WHERE grant_id = $1`, [scopeId]);

      const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
      try {
        const error = await errorOf(() =>
          h.executor().execute(
            requestOf({ harness: h, scopeId, key, replay: { kind: 'sensitive', authorize: grantHook(h, 'owner-1') } }),
            createItemWork(h, scopeId, calls),
          ),
        );
        expect(error).toBeInstanceOf(ReplayDenied);
        expect(String((error as Error).message)).not.toContain(SECRET_TOKEN);
        expect(decrypt).not.toHaveBeenCalled();
      } finally {
        decrypt.mockRestore();
      }
      expect(calls.n).toBe(1);
    });

    it('guard locked FIRST -> the revoking updater WAITS, the replay is allowed, and the revoke applies afterwards', async () => {
      const { scopeId, key, calls } = await sealed();
      const entered = deferred();
      const release = deferred();
      const replay = h.executor().execute(
        requestOf({
          harness: h,
          scopeId,
          key,
          replay: {
            kind: 'sensitive',
            authorize: grantHook(h, 'owner-1', async () => {
              entered.resolve();
              await release.promise;
            }),
          },
        }),
        createItemWork(h, scopeId, calls),
      );
      await entered.promise; // the hook holds FOR SHARE on the grant row

      const revoke = h.pool.query(`UPDATE ${h.grants} SET revoked = true WHERE grant_id = $1`, [scopeId]);
      await waitForBlockedStatement(h.pool, `UPDATE ${h.grants} SET revoked`);
      release.resolve();

      const outcome = await replay;
      expect(outcome.replayed).toBe(true);
      expect((outcome.payload as { access_token: string }).access_token).toBe(SECRET_TOKEN);
      await revoke; // the updater proceeds only after the replay transaction ended

      const later = await errorOf(() =>
        h.executor().execute(
          requestOf({ harness: h, scopeId, key, replay: { kind: 'sensitive', authorize: grantHook(h, 'owner-1') } }),
          createItemWork(h, scopeId, calls),
        ),
      );
      expect(later).toBeInstanceOf(ReplayDenied);
      expect(calls.n).toBe(1);
    });

    it('session / user / proof binding: another owner, a missing grant and a guard naming no grant are all denied', async () => {
      const { scopeId, key, calls } = await sealed();
      const attempts: ReplayAuthorizationHook[] = [
        grantHook(h, 'owner-2'), // another user
        async (context, guard) => grantHook(h, 'owner-1')(context, { ...guard, grant_id: 'no-such-grant' }),
        async (context) => grantHook(h, 'owner-1')(context, {}),
      ];
      for (const authorize of attempts) {
        const error = await errorOf(() =>
          h.executor().execute(requestOf({ harness: h, scopeId, key, replay: { kind: 'sensitive', authorize } }), createItemWork(h, scopeId, calls)),
        );
        expect(error).toBeInstanceOf(ReplayDenied);
      }
      const allowed = await h.executor().execute(
        requestOf({ harness: h, scopeId, key, replay: { kind: 'sensitive', authorize: grantHook(h, 'owner-1') } }),
        createItemWork(h, scopeId, calls),
      );
      expect(allowed.replayed).toBe(true);
      expect(calls.n).toBe(1);
    });

    it('the hook runs INSIDE the executor transaction: the record row is still locked by it while the hook runs', async () => {
      const { scopeId, key, calls } = await sealed();
      let probe: unknown;
      const outcome = await h.executor().execute(
        requestOf({
          harness: h,
          scopeId,
          key,
          replay: {
            kind: 'sensitive',
            authorize: async () => {
              // Another connection cannot take the row the executor holds FOR UPDATE.
              probe = await errorOf(() =>
                h.pool.query(
                  `SELECT 1 FROM app.idempotency_records
                    WHERE scope_type = $1 AND scope_id = $2 AND idempotency_key = $3 FOR UPDATE NOWAIT`,
                  [h.scopeType, scopeId, key],
                ),
              );
              return true;
            },
          },
        }),
        createItemWork(h, scopeId, calls),
      );
      expect(outcome.replayed).toBe(true);
      expect((probe as { code?: string }).code).toBe('55P03');
      expect(calls.n).toBe(1);
    });
  });

  describe('C20 / C08 — tamper and corruption fail closed', () => {
    async function sealedRecord(): Promise<{ scopeId: string; key: string; calls: { n: number }; recordId: string }> {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seedGrant(h, scopeId, 'owner-1');
      await seedGrant(h, `${scopeId}-other`, 'owner-1');
      await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      return { scopeId, key, calls, recordId: (await onlyRecord(h, scopeId, key)).record_id };
    }

    const tampers: ReadonlyArray<readonly [string, string]> = [
      ['replay guard', `replay_guard = replay_guard || '{"grant_id": "other"}'::jsonb`],
      ['response status', 'response_status = 200'],
      ['replay expiry', `replay_expires_at = replay_expires_at + interval '1 second'`],
      ['ciphertext', 'replay_ciphertext = set_byte(replay_ciphertext, 0, (get_byte(replay_ciphertext, 0)::int # 1))'],
      ['auth tag', 'replay_tag = set_byte(replay_tag, 0, (get_byte(replay_tag, 0)::int # 1))'],
      ['IV', 'replay_iv = set_byte(replay_iv, 0, (get_byte(replay_iv, 0)::int # 1))'],
      ['bound identity (AAD): operation id', `operation_id = 'fixture.moved.v1'`],
    ];
    for (const [label, assignment] of tampers) {
      it(`tampered ${label}: CryptoError, no callback, record untouched, nothing decrypted`, async () => {
        const { scopeId, key, calls, recordId } = await sealedRecord();
        await h.pool.query(`UPDATE app.idempotency_records SET ${assignment} WHERE record_id = $1`, [recordId]);
        const operationId = label.startsWith('bound identity') ? 'fixture.moved.v1' : 'fixture.create.v1';

        const error = await errorOf(() =>
          h.executor().execute(requestOf({ harness: h, scopeId, key, operationId }), createItemWork(h, scopeId, calls)),
        );
        expect(error).toBeInstanceOf(CryptoError);
        expect(String((error as Error).message)).not.toContain(SECRET_TOKEN);
        expect(calls.n).toBe(1);
        expect(await countItems(h, scopeId)).toBe(1);
        expect((await h.pool.query('SELECT 1 FROM app.idempotency_records WHERE record_id = $1', [recordId])).rowCount).toBe(1);
      });
    }

    it('a tampered guard that points at ANOTHER valid grant is allowed by the hook, but the payload is still not released (AAD)', async () => {
      const { scopeId, key, calls, recordId } = await sealedRecord();
      await h.pool.query(`UPDATE app.idempotency_records SET replay_guard = $2::jsonb WHERE record_id = $1`, [recordId, JSON.stringify({ grant_id: `${scopeId}-other` })]);
      const error = await errorOf(() =>
        h.executor().execute(
          requestOf({ harness: h, scopeId, key, replay: { kind: 'sensitive', authorize: grantHook(h, 'owner-1') } }),
          createItemWork(h, scopeId, calls),
        ),
      );
      expect(error).toBeInstanceOf(CryptoError);
      expect(calls.n).toBe(1);
    });

    it('ciphertext NULL before the replay expiry is corruption: fail closed, the callback is NOT re-run', async () => {
      const { scopeId, key, calls, recordId } = await sealedRecord();
      await h.pool.query('UPDATE app.idempotency_records SET replay_ciphertext = NULL, replay_iv = NULL, replay_tag = NULL WHERE record_id = $1', [recordId]);
      const error = await errorOf(() => h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)));
      expect(error).toBeInstanceOf(CryptoError);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
    });

    it('a partially NULL replay envelope cannot even be stored (database CHECK)', async () => {
      const { recordId } = await sealedRecord();
      const error = await errorOf(() => h.pool.query('UPDATE app.idempotency_records SET replay_tag = NULL WHERE record_id = $1', [recordId]));
      expect((error as { code?: string }).code).toBe('23514');
    });
  });
});
