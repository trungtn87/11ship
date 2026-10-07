import { describe, expect, it, jest } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { CryptoError } from '../crypto/crypto-error';
import { KeyVersion } from '../crypto/key-version';
import { Keyring } from '../crypto/keyring';
import { fixtureKeyring } from '../crypto/test-keys.fixture';
import { QueryRows, TransactionContext } from '../transaction/transaction-context';
import { DEFAULT_IDEMPOTENCY_CONFIG } from './idempotency-config';
import {
  IdempotencyExecutor,
  IdempotentRequest,
  IdempotentResult,
  TransactionRunner,
} from './idempotency-executor';

const KEY = '3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34';
const T0 = 1_800_000_000_000;

type Raw = Record<string, unknown>;

/**
 * Scripted stand-in for PostgreSQL: it answers the exact statements of the executor, records every
 * statement in order and emulates a single idempotency row. No SQL is interpreted beyond recognizing
 * which statement it is; the real SQL is exercised by the integration suite.
 */
class FakeDb {
  readonly statements: Array<{ text: string; values: readonly unknown[] }> = [];
  row: Raw | undefined;
  /** Successive answers of clock_timestamp(); the last one repeats. */
  clocks: number[] = [T0];
  advisoryError: unknown;
  rowLockError: unknown;
  transactions = 0;
  commits = 0;

  nowMs(): number {
    const next = this.clocks.length > 1 ? this.clocks.shift() : this.clocks[0];
    return next as number;
  }

  readonly runner: TransactionRunner = {
    withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => {
      this.transactions += 1;
      const result = await work(this.#context());
      this.commits += 1;
      return result;
    },
  };

  #context(): TransactionContext {
    return {
      isActive: true,
      query: async <R extends object = Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<QueryRows<R>> => {
        this.statements.push({ text, values });
        return this.#answer(text, values) as QueryRows<R>;
      },
    };
  }

  #answer(text: string, values: readonly unknown[]): QueryRows {
    if (text.includes("set_config('lock_timeout'")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('pg_advisory_xact_lock')) {
      if (this.advisoryError !== undefined) {
        throw this.advisoryError;
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FOR UPDATE')) {
      if (this.rowLockError !== undefined) {
        throw this.rowLockError;
      }
      return { rows: this.row === undefined ? [] : [{ ...this.row }], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes('clock_timestamp()')) {
      return { rows: [{ now_ms: String(this.nowMs()) }], rowCount: 1 };
    }
    if (text.startsWith('DELETE')) {
      const had = this.row !== undefined;
      this.row = undefined;
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (text.includes('INSERT INTO app.idempotency_records')) {
      if (this.row !== undefined) {
        throw new Error('unique violation (the executor must never insert over a live row)');
      }
      this.row = {
        record_id: values[0],
        scope_type: values[1],
        scope_id: values[2],
        operation_id: values[3],
        idempotency_key: values[4],
        request_fingerprint: values[5],
        crypto_key_id: values[6],
        response_status: values[7],
        replay_format_version: values[8],
        replay_guard: JSON.parse(values[9] as string),
        replay_ciphertext: values[10],
        replay_iv: values[11],
        replay_tag: values[12],
        created_at_ms: values[13],
        replay_expires_at_ms: values[14],
        dedupe_expires_at_ms: values[15],
      };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('SELECT 1')) {
      // a replay-authorization hook's own read
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected statement: ${text}`);
  }

  kinds(): string[] {
    return this.statements.map((statement) => {
      const text = statement.text;
      if (text.includes("set_config('lock_timeout'")) return `lock_timeout=${String(statement.values[0])}`;
      if (text.includes('pg_advisory_xact_lock')) return 'advisory';
      if (text.includes('FOR UPDATE')) return 'select-for-update';
      if (text.includes('clock_timestamp()')) return 'clock';
      if (text.startsWith('DELETE')) return 'delete';
      if (text.includes('INSERT')) return 'insert';
      return 'other';
    });
  }
}

const NON_SENSITIVE = { kind: 'non-sensitive' } as const;

function request(overrides: Partial<IdempotentRequest> = {}): IdempotentRequest {
  return {
    scopeType: 'verification_proof',
    scopeId: 'p1',
    operationId: 'auth.register.v1',
    idempotencyKey: KEY,
    logicalRequest: { email: 'a@example.test', password: 'hunter2-SECRET' },
    replay: NON_SENSITIVE,
    ...overrides,
  };
}

function ok(payload: unknown = { access_token: 'tok-SECRET' }, status = 201): IdempotentResult {
  return { status, replayGuard: { proof_id: 'p1' }, payload: payload as never };
}

function make(db: FakeDb, keyring: Keyring = fixtureKeyring('k1')): IdempotencyExecutor {
  return new IdempotencyExecutor(db.runner, keyring, DEFAULT_IDEMPOTENCY_CONFIG);
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function codeOf(error: unknown): string {
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

/** Runs one execution that creates the record, then moves the clock to `at`. */
async function seeded(
  db: FakeDb,
  executor: IdempotencyExecutor,
  overrides: Partial<IdempotentRequest> = {},
): Promise<void> {
  db.clocks = [T0];
  await executor.execute(request(overrides), async () => ok());
  db.statements.length = 0;
}

describe('IdempotencyExecutor: new record', () => {
  it('runs the protocol in the ADR order and persists one encrypted record', async () => {
    const db = new FakeDb();
    const work = jest.fn(async () => ok());
    const outcome = await make(db).execute(request(), work);

    expect(outcome).toEqual({
      status: 201,
      payload: { access_token: 'tok-SECRET' },
      replayed: false,
      persisted: true,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(db.kinds()).toEqual([
      'lock_timeout=250ms',
      'advisory',
      'lock_timeout=500ms',
      'select-for-update',
      'clock',
      'clock',
      'insert',
    ]);
    expect(db.transactions).toBe(1);
    expect(db.commits).toBe(1);
  });

  it('stores TTLs from the fresh database clock and a key id of the ONE captured version', async () => {
    const db = new FakeDb();
    await make(db, fixtureKeyring('k2')).execute(request(), async () => ok());
    expect(db.row?.crypto_key_id).toBe('k2');
    expect(db.row?.created_at_ms).toBe(String(T0));
    expect(db.row?.replay_expires_at_ms).toBe(String(T0 + 900_000));
    expect(db.row?.dedupe_expires_at_ms).toBe(String(T0 + 604_800_000));
  });

  it('never stores plaintext secrets: only ciphertext, IV, tag, fingerprint and the guard', async () => {
    const db = new FakeDb();
    await make(db).execute(request(), async () => ok());
    const stored = JSON.stringify(db.statements.map((s) => s.values.map((v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v))));
    expect(stored).not.toContain('tok-SECRET');
    expect(stored).not.toContain('hunter2-SECRET');
    expect(db.row?.replay_ciphertext).toBeInstanceOf(Buffer);
  });

  it('captures the active key exactly once, for HMAC and encryption', async () => {
    const db = new FakeDb();
    const keyring = fixtureKeyring('k1');
    const active = jest.spyOn(Keyring.prototype, 'active');
    try {
      await make(db, keyring).execute(request(), async () => ok());
      expect(active).toHaveBeenCalledTimes(1);
    } finally {
      active.mockRestore();
    }
  });

  it('honours a server-side TTL override', async () => {
    const db = new FakeDb();
    await make(db).execute(
      request({ ttl: { replaySeconds: 60, dedupeSeconds: 86_400 } }),
      async () => ok(),
    );
    expect(db.row?.replay_expires_at_ms).toBe(String(T0 + 60_000));
    expect(db.row?.dedupe_expires_at_ms).toBe(String(T0 + 86_400_000));
  });

  it('does not persist a non-2xx result: nothing is inserted and the caller gets the result back', async () => {
    const db = new FakeDb();
    const failure = { status: 422, replayGuard: {}, payload: { code: 'X' } };
    const outcome = await make(db).execute(request(), async () => failure);
    expect(outcome).toEqual({ status: 422, payload: { code: 'X' }, replayed: false, persisted: false });
    expect(db.row).toBeUndefined();
    expect(db.kinds()).not.toContain('insert');
    // The fake runner "commits" when the callback resolves; the executor must instead throw so the real
    // manager rolls back. A thrown callback never reaches the fake's commit counter.
    expect(db.commits).toBe(0);
  });

  it('refuses an oversized replay payload and persists nothing', async () => {
    const db = new FakeDb();
    const huge = { blob: 'x'.repeat(70_000) };
    const error = await errorOf(make(db).execute(request(), async () => ok(huge)));
    expect(error).toBeInstanceOf(Error);
    expect(db.row).toBeUndefined();
  });

  it('refuses a secret-looking replay guard key', async () => {
    const db = new FakeDb();
    const error = await errorOf(
      make(db).execute(request(), async () => ({ status: 201, replayGuard: { password: 'x' }, payload: {} })),
    );
    expect(error).toBeInstanceOf(Error);
    expect(db.row).toBeUndefined();
  });

  it('propagates a callback failure unchanged and leaves no record', async () => {
    const db = new FakeDb();
    const boom = new Error('business failure');
    const error = await errorOf(make(db).execute(request(), async () => Promise.reject(boom)));
    expect(error).toBe(boom);
    expect(db.row).toBeUndefined();
  });
});

describe('IdempotencyExecutor: input validation happens before any transaction', () => {
  const cases: ReadonlyArray<readonly [string, Partial<IdempotentRequest>, string]> = [
    ['missing key', { idempotencyKey: undefined }, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['malformed key', { idempotencyKey: 'nope' }, 'INVALID_IDEMPOTENCY_KEY'],
  ];
  for (const [label, override, code] of cases) {
    it(`${label} -> ${code}`, async () => {
      const db = new FakeDb();
      const error = await errorOf(make(db).execute(request(override), async () => ok()));
      expect(codeOf(error)).toBe(code);
      expect(db.transactions).toBe(0);
    });
  }

  const programming: ReadonlyArray<readonly [string, Partial<IdempotentRequest>]> = [
    ['empty scope type', { scopeType: '' }],
    ['scope id above 128', { scopeId: 'x'.repeat(129) }],
    ['operation id above 128', { operationId: 'x'.repeat(129) }],
    ['invalid TTL', { ttl: { replaySeconds: 10, dedupeSeconds: 5 } }],
    ['undefined logical request', { logicalRequest: undefined }],
  ];
  for (const [label, override] of programming) {
    it(`rejects ${label} without opening a transaction`, async () => {
      const db = new FakeDb();
      const error = await errorOf(make(db).execute(request(override), async () => ok()));
      expect(error).toBeInstanceOf(Error);
      expect(db.transactions).toBe(0);
    });
  }

  it('rejects a sensitive replay without a hook', async () => {
    const db = new FakeDb();
    const error = await errorOf(
      make(db).execute(request({ replay: { kind: 'sensitive' } as never }), async () => ok()),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(db.transactions).toBe(0);
  });
});

describe('IdempotencyExecutor: advisory lock and lock_timeout', () => {
  it('55P03 raised by the advisory statement becomes IDEMPOTENCY_BUSY, without running the callback', async () => {
    const db = new FakeDb();
    db.advisoryError = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const work = jest.fn(async () => ok());
    const error = await errorOf(make(db).execute(request(), work));
    expect(codeOf(error)).toBe('IDEMPOTENCY_BUSY');
    expect(work).not.toHaveBeenCalled();
    expect(db.kinds()).toEqual(['lock_timeout=250ms', 'advisory']);
  });

  it('another SQLSTATE at the advisory statement is not BUSY', async () => {
    const db = new FakeDb();
    db.advisoryError = Object.assign(new Error('statement timeout'), { code: '57014' });
    const error = await errorOf(make(db).execute(request(), async () => ok()));
    expect(error).toBe(db.advisoryError);
  });

  it('55P03 at the exact-row lock is NOT BUSY and is surfaced as the raw error', async () => {
    const db = new FakeDb();
    db.rowLockError = Object.assign(new Error('row lock timeout'), { code: '55P03' });
    const work = jest.fn(async () => ok());
    const error = await errorOf(make(db).execute(request(), work));
    expect(error).toBe(db.rowLockError);
    expect(work).not.toHaveBeenCalled();
    // the business budget had been restored BEFORE the row lock was requested
    expect(db.kinds()).toEqual([
      'lock_timeout=250ms',
      'advisory',
      'lock_timeout=500ms',
      'select-for-update',
    ]);
  });

  it('derives the advisory pair from the exact tuple (or the injected test derivation)', async () => {
    const db = new FakeDb();
    const executor = new IdempotencyExecutor(db.runner, fixtureKeyring(), DEFAULT_IDEMPOTENCY_CONFIG, {
      lockKey: () => [7, -9],
    });
    await executor.execute(request(), async () => ok());
    const advisory = db.statements.find((s) => s.text.includes('pg_advisory_xact_lock'));
    expect(advisory?.values).toEqual([7, -9]);
  });

  it('refuses an advisory pair outside int32', async () => {
    const db = new FakeDb();
    const executor = new IdempotencyExecutor(db.runner, fixtureKeyring(), DEFAULT_IDEMPOTENCY_CONFIG, {
      lockKey: () => [2_147_483_648, 0],
    });
    const error = await errorOf(executor.execute(request(), async () => ok()));
    expect(error).toBeInstanceOf(TypeError);
  });

  it('refuses an invalid configuration at construction', () => {
    expect(
      () =>
        new IdempotencyExecutor(new FakeDb().runner, fixtureKeyring(), {
          ...DEFAULT_IDEMPOTENCY_CONFIG,
          advisoryWaitMs: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe('IdempotencyExecutor: replay of a live record', () => {
  it('replays the stored status and payload without running the callback', async () => {
    const db = new FakeDb();
    const executor = make(db);
    await seeded(db, executor);
    db.clocks = [T0 + 1000];
    const work = jest.fn(async () => ok({ other: true }));
    const outcome = await executor.execute(request(), work);
    expect(outcome).toEqual({
      status: 201,
      payload: { access_token: 'tok-SECRET' },
      replayed: true,
      persisted: true,
    });
    expect(work).not.toHaveBeenCalled();
    expect(db.kinds()).toEqual([
      'lock_timeout=250ms',
      'advisory',
      'lock_timeout=500ms',
      'select-for-update',
      'clock',
      'clock',
    ]);
  });

  it('handles a historical record with ITS key version, not the active one (rotation)', async () => {
    const db = new FakeDb();
    await seeded(db, make(db, fixtureKeyring('k1')));
    expect(db.row?.crypto_key_id).toBe('k1');
    db.clocks = [T0 + 1000];
    const rotated = fixtureKeyring('k2');
    const active = jest.spyOn(Keyring.prototype, 'active');
    const work = jest.fn(async () => ok());
    try {
      const outcome = await make(db, rotated).execute(request(), work);
      expect(outcome.replayed).toBe(true);
      expect(outcome.payload).toEqual({ access_token: 'tok-SECRET' });
      expect(work).not.toHaveBeenCalled();
      expect(active).not.toHaveBeenCalled();
    } finally {
      active.mockRestore();
    }
  });

  it('missing historical key -> IDEMPOTENCY_KEY_UNAVAILABLE, no callback, no write, no decrypt', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.row = { ...(db.row as Raw), crypto_key_id: 'retired' };
    db.clocks = [T0 + 1000];
    const work = jest.fn(async () => ok());
    const error = await errorOf(make(db).execute(request(), work));
    expect(codeOf(error)).toBe('IDEMPOTENCY_KEY_UNAVAILABLE');
    expect((error as AppError).status).toBe(503);
    expect(work).not.toHaveBeenCalled();
    expect(db.kinds()).not.toContain('insert');
    expect(db.kinds()).not.toContain('delete');
    expect(db.row?.crypto_key_id).toBe('retired');
  });

  it('different logical request -> IDEMPOTENCY_KEY_REUSED, no decrypt, no callback', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 1000];
    const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
    const work = jest.fn(async () => ok());
    try {
      const error = await errorOf(
        make(db).execute(request({ logicalRequest: { email: 'other@example.test' } }), work),
      );
      expect(codeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(decrypt).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });

  it('a different key order of the same logical request has the same fingerprint (canonical JSON)', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 1000];
    const outcome = await make(db).execute(
      request({ logicalRequest: { password: 'hunter2-SECRET', email: 'a@example.test' } }),
      async () => ok(),
    );
    expect(outcome.replayed).toBe(true);
  });

  it('IDEMPOTENCY_KEY_REUSED wins over IDEMPOTENCY_REPLAY_EXPIRED for a different request', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 900_000 + 5];
    const error = await errorOf(
      make(db).execute(request({ logicalRequest: { different: 1 } }), async () => ok()),
    );
    expect(codeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  const expiryEdges: ReadonlyArray<readonly [string, number, boolean]> = [
    ['one millisecond before the replay expiry', T0 + 900_000 - 1, true],
    ['exactly at the replay expiry (equality is expired)', T0 + 900_000, false],
    ['after the replay expiry', T0 + 900_001, false],
  ];
  for (const [label, at, replayable] of expiryEdges) {
    it(`${label}: ${replayable ? 'replays' : 'IDEMPOTENCY_REPLAY_EXPIRED'}`, async () => {
      const db = new FakeDb();
      await seeded(db, make(db));
      db.clocks = [at];
      const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
      try {
        const promise = make(db).execute(request(), async () => ok());
        if (replayable) {
          expect((await promise).replayed).toBe(true);
        } else {
          expect(codeOf(await errorOf(promise))).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
          expect(decrypt).not.toHaveBeenCalled();
          expect(db.row?.replay_ciphertext).toBeInstanceOf(Buffer);
        }
      } finally {
        decrypt.mockRestore();
      }
    });
  }

  it('re-reads the clock after the hook: crossing the expiry during the hook refuses the replay', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    // first clock (record lookup) is still inside the window; the final one is at the expiry
    db.clocks = [T0 + 900_000 - 1, T0 + 900_000];
    const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
    try {
      const hook = jest.fn(async () => true as const);
      const error = await errorOf(
        make(db).execute(request({ replay: { kind: 'sensitive', authorize: hook } }), async () => ok()),
      );
      expect(codeOf(error)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      expect(hook).toHaveBeenCalledTimes(1);
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });

  it('tombstone (ciphertext cleared by cleanup) after the replay window -> REPLAY_EXPIRED', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.row = { ...(db.row as Raw), replay_ciphertext: null, replay_iv: null, replay_tag: null };
    db.clocks = [T0 + 900_000];
    const error = await errorOf(make(db).execute(request(), async () => ok()));
    expect(codeOf(error)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
  });

  it('tombstone with a different request still answers IDEMPOTENCY_KEY_REUSED', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.row = { ...(db.row as Raw), replay_ciphertext: null, replay_iv: null, replay_tag: null };
    db.clocks = [T0 + 900_000];
    const error = await errorOf(
      make(db).execute(request({ logicalRequest: { x: 1 } }), async () => ok()),
    );
    expect(codeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  const corruptions: ReadonlyArray<readonly [string, Raw]> = [
    ['replay format version 2', { replay_format_version: 2 }],
    ['ciphertext NULL inside the window', { replay_ciphertext: null, replay_iv: null, replay_tag: null }],
    ['only the tag NULL', { replay_tag: null }],
    ['guard is not an object', { replay_guard: 'text' }],
  ];
  for (const [label, override] of corruptions) {
    it(`fails closed on ${label}: crypto error, no callback, no write`, async () => {
      const db = new FakeDb();
      await seeded(db, make(db));
      db.row = { ...(db.row as Raw), ...override };
      db.clocks = [T0 + 1000];
      const work = jest.fn(async () => ok());
      const error = await errorOf(make(db).execute(request(), work));
      expect(error).toBeInstanceOf(CryptoError);
      expect(work).not.toHaveBeenCalled();
      expect(db.kinds()).not.toContain('insert');
      expect(db.kinds()).not.toContain('delete');
    });
  }

  it('a tampered ciphertext, tag, iv, guard or status fails closed (AAD / GCM)', async () => {
    const tampers: Array<(row: Raw) => Raw> = [
      (row) => ({ ...row, replay_ciphertext: Buffer.from(Uint8Array.from(row.replay_ciphertext as Buffer).map((b, i) => (i === 0 ? b ^ 1 : b))) }),
      (row) => ({ ...row, replay_tag: Buffer.alloc(16, 1) }),
      (row) => ({ ...row, replay_iv: Buffer.alloc(12, 1) }),
      (row) => ({ ...row, replay_guard: { proof_id: 'someone-else' } }),
      (row) => ({ ...row, response_status: 200 }),
      (row) => ({ ...row, replay_expires_at_ms: String(Number(row.replay_expires_at_ms) + 1) }),
    ];
    for (const tamper of tampers) {
      const db = new FakeDb();
      await seeded(db, make(db));
      db.row = tamper(db.row as Raw);
      db.clocks = [T0 + 1000];
      const work = jest.fn(async () => ok());
      const error = await errorOf(make(db).execute(request(), work));
      expect(error).toBeInstanceOf(CryptoError);
      expect(work).not.toHaveBeenCalled();
      expect(db.row).toBeDefined();
    }
  });
});

describe('IdempotencyExecutor: dedupe window', () => {
  const dedupeAt = T0 + 604_800_000;

  it('one millisecond before the dedupe expiry the record is still live (replay expired)', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [dedupeAt - 1];
    const work = jest.fn(async () => ok());
    const error = await errorOf(make(db).execute(request(), work));
    expect(codeOf(error)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
    expect(work).not.toHaveBeenCalled();
    expect(db.kinds()).not.toContain('delete');
  });

  it('exactly at the dedupe expiry (equality is expired): delete, then a NEW window, callback once', async () => {
    const db = new FakeDb();
    const executor = make(db);
    await seeded(db, executor);
    const oldId = db.row?.record_id;
    db.clocks = [dedupeAt];
    const work = jest.fn(async () => ok({ access_token: 'new-SECRET' }, 200));
    const outcome = await executor.execute(request(), work);
    expect(outcome).toEqual({
      status: 200,
      payload: { access_token: 'new-SECRET' },
      replayed: false,
      persisted: true,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(db.kinds()).toEqual([
      'lock_timeout=250ms',
      'advisory',
      'lock_timeout=500ms',
      'select-for-update',
      'clock',
      'delete',
      'clock',
      'insert',
    ]);
    expect(db.row?.record_id).not.toBe(oldId);
  });

  it('the dedupe check precedes the historical-key lookup: an expired record whose key is gone is simply replaced', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.row = { ...(db.row as Raw), crypto_key_id: 'retired' };
    db.clocks = [dedupeAt + 10];
    const work = jest.fn(async () => ok());
    const outcome = await make(db).execute(request(), work);
    expect(outcome.replayed).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
    expect(db.row?.crypto_key_id).toBe('k1');
  });

  it('a different request after the dedupe expiry is accepted as a new window', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [dedupeAt];
    const outcome = await make(db).execute(
      request({ logicalRequest: { brand: 'new' } }),
      async () => ok(),
    );
    expect(outcome.replayed).toBe(false);
  });
});

describe('IdempotencyExecutor: sensitive replay authorization', () => {
  it('runs the hook with the SAME context and the stored guard BEFORE any decrypt', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 1000];
    const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
    const seen: unknown[] = [];
    try {
      const outcome = await make(db).execute(
        request({
          replay: {
            kind: 'sensitive',
            authorize: async (context, guard) => {
              seen.push(context, guard);
              expect(decrypt).not.toHaveBeenCalled();
              await context.query('SELECT 1 /* hook read */');
              return true;
            },
          },
        }),
        async () => ok(),
      );
      expect(outcome.replayed).toBe(true);
      expect(seen[0]).toBeDefined();
      expect(seen[1]).toEqual({ proof_id: 'p1' });
      expect(decrypt).toHaveBeenCalledTimes(1);
    } catch (error) {
      // the hook's own query is not scripted; treat the unscripted statement as part of the contract
      throw error;
    } finally {
      decrypt.mockRestore();
    }
  });

  it('a denying hook stops the replay: the hook error propagates, nothing is decrypted or executed', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 1000];
    const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
    const denial = new AppError('IDEMPOTENCY_KEY_REUSED');
    const work = jest.fn(async () => ok());
    try {
      const error = await errorOf(
        make(db).execute(
          request({ replay: { kind: 'sensitive', authorize: async () => Promise.reject(denial) } }),
          work,
        ),
      );
      expect(error).toBe(denial);
      expect(decrypt).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });

  it('a hook resolving to anything but true is a denial (generic technical error)', async () => {
    for (const value of [false, undefined, 'true', 1, null]) {
      const db = new FakeDb();
      await seeded(db, make(db));
      db.clocks = [T0 + 1000];
      const decrypt = jest.spyOn(KeyVersion.prototype, 'decryptReplay');
      try {
        const error = await errorOf(
          make(db).execute(
            request({ replay: { kind: 'sensitive', authorize: (async () => value) as never } }),
            async () => ok(),
          ),
        );
        expect(error).toBeInstanceOf(TechnicalError);
        expect(decrypt).not.toHaveBeenCalled();
      } finally {
        decrypt.mockRestore();
      }
    }
  });

  it('does not call the hook for a request with a different fingerprint, nor for a new record', async () => {
    const db = new FakeDb();
    const hook = jest.fn(async () => true as const);
    const sensitive = { kind: 'sensitive', authorize: hook } as const;
    await make(db).execute(request({ replay: sensitive }), async () => ok());
    expect(hook).not.toHaveBeenCalled();
    db.clocks = [T0 + 1000];
    const error = await errorOf(
      make(db).execute(request({ replay: sensitive, logicalRequest: { z: 1 } }), async () => ok()),
    );
    expect(codeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(hook).not.toHaveBeenCalled();
  });

  it('a non-sensitive replay never calls any hook', async () => {
    const db = new FakeDb();
    await seeded(db, make(db));
    db.clocks = [T0 + 1000];
    const outcome = await make(db).execute(request(), async () => ok());
    expect(outcome.replayed).toBe(true);
  });
});
