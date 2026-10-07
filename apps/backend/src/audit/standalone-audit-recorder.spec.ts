import { describe, expect, it } from '@jest/globals';
import { QueryRows, TransactionContext } from '../transaction/transaction-context';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
} from '../transaction/transaction-manager';
import { StandaloneAuditEntry } from './audit-entry';
import {
  AuditAppender,
  AuditFailureLogger,
  STANDALONE_AUDIT_BUDGET_MS,
  StandaloneAuditFailureCode,
  StandaloneAuditRecorder,
} from './standalone-audit-recorder';

const MARKER = 'SECRET_MARKER_STANDALONE_8d3f';
const REQUEST_ID = '3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34';

const DENIED: StandaloneAuditEntry = {
  requestId: REQUEST_ID,
  actorType: 'ANONYMOUS',
  action: 'auth.login.v1',
  outcome: 'DENIED',
  reasonCode: 'INVALID_CREDENTIALS',
};

interface FakeClient extends TransactionClient {
  readonly statements: string[];
  /** One entry per release: true when the connection was destroyed instead of returned. */
  readonly released: boolean[];
}

type Script = (text: string) => Promise<QueryRows> | undefined;

function fakeClient(script?: Script): FakeClient {
  const statements: string[] = [];
  const released: boolean[] = [];
  return {
    statements,
    released,
    query(text: string): Promise<QueryRows> {
      statements.push(text);
      const scripted = script?.(text);
      if (scripted !== undefined) {
        return scripted;
      }
      const command = text === 'COMMIT' || text === 'ROLLBACK' ? text : undefined;
      return Promise.resolve({ rows: [], rowCount: 1, command });
    },
    release(destroy?: boolean): void {
      released.push(destroy === true);
    },
    onError(): () => void {
      return () => undefined;
    },
  };
}

function sourceOf(client: TransactionClient): TransactionClientSource & { acquisitions: number } {
  const source = {
    acquisitions: 0,
    acquire(): Promise<TransactionClient> {
      source.acquisitions += 1;
      return Promise.resolve(client);
    },
  };
  return source;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets already-queued promise continuations run (a late acquisition settling, a release). */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly meta: { code: StandaloneAuditFailureCode };
}

function recordingLogger(): { lines: LogLine[]; logger: AuditFailureLogger } {
  const lines: LogLine[] = [];
  return {
    lines,
    logger: {
      log: (level, event, meta) => {
        lines.push({ level, event, meta });
      },
    },
  };
}

function recordingWriter(behavior?: (context: TransactionContext) => Promise<void>): {
  appended: StandaloneAuditEntry[];
  writer: AuditAppender;
} {
  const appended: StandaloneAuditEntry[] = [];
  return {
    appended,
    writer: {
      append: async (context, entry) => {
        appended.push(entry as StandaloneAuditEntry);
        if (behavior !== undefined) {
          await behavior(context);
          return;
        }
        await context.query('INSERT INTO app.audit_logs VALUES (1)');
      },
    },
  };
}

function codes(lines: readonly LogLine[]): StandaloneAuditFailureCode[] {
  return lines.map((line) => line.meta.code);
}

describe('StandaloneAuditRecorder — the write itself', () => {
  it('writes in its own short transaction on the acquired client and releases it once, cleanly', async () => {
    const client = fakeClient();
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(sourceOf(client), writer, logger).recordBestEffort(DENIED);

    expect(appended).toEqual([DENIED]);
    expect(client.statements[0]).toBe('BEGIN');
    expect(client.statements[1]).toContain('idle_in_transaction_session_timeout');
    expect(client.statements[2]).toContain('INSERT INTO app.audit_logs');
    expect(client.statements[3]).toBe('COMMIT');
    expect(client.statements).toHaveLength(4);
    expect(client.released).toEqual([false]);
    expect(lines).toEqual([]);
  });

  it('exposes the normative 500 ms budget as an infrastructure constant', () => {
    expect(STANDALONE_AUDIT_BUDGET_MS).toBe(500);
  });

  it('accepts only budgets between 1 and 500 ms (a test may shorten it, nothing may lengthen it)', () => {
    const { writer } = recordingWriter();
    const { logger } = recordingLogger();
    const source = sourceOf(fakeClient());
    for (const budgetMs of [0, -1, 501, 1.5, Number.NaN]) {
      expect(() => new StandaloneAuditRecorder(source, writer, logger, { budgetMs })).toThrow(RangeError);
    }
    expect(() => new StandaloneAuditRecorder(source, writer, logger, { budgetMs: 1 })).not.toThrow();
    expect(() => new StandaloneAuditRecorder(source, writer, logger, { budgetMs: 500 })).not.toThrow();
  });
});

describe('StandaloneAuditRecorder — never writes SUCCESS and never touches the pool for a bad entry', () => {
  it('refuses a SUCCESS entry: no acquisition, no write, no throw, one fixed-code log line', async () => {
    const client = fakeClient();
    const source = sourceOf(client);
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(source, writer, logger).recordBestEffort({
      ...DENIED,
      outcome: 'SUCCESS',
    } as unknown as StandaloneAuditEntry);

    expect(source.acquisitions).toBe(0);
    expect(appended).toHaveLength(0);
    expect(codes(lines)).toEqual(['AUDIT_ENTRY_REJECTED']);
  });

  it('refuses an invalid entry (unsafe metadata) the same way, before any connection is taken', async () => {
    const source = sourceOf(fakeClient());
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(source, writer, logger).recordBestEffort({
      ...DENIED,
      metadata: { password: MARKER },
    });

    expect(source.acquisitions).toBe(0);
    expect(appended).toHaveLength(0);
    expect(codes(lines)).toEqual(['AUDIT_ENTRY_REJECTED']);
    expect(JSON.stringify(lines)).not.toContain(MARKER);
  });

  it('resolves for a missing or malformed entry as well', async () => {
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();
    const recorder = new StandaloneAuditRecorder(sourceOf(fakeClient()), writer, logger);
    for (const entry of [undefined, null, 'x', 7]) {
      await recorder.recordBestEffort(entry as unknown as StandaloneAuditEntry);
    }
    expect(codes(lines)).toEqual(Array<StandaloneAuditFailureCode>(4).fill('AUDIT_ENTRY_REJECTED'));
  });
});

describe('StandaloneAuditRecorder — pool acquisition is part of the budget (C27)', () => {
  it('resolves when no client arrives within the budget, logging AUDIT_ACQUIRE_TIMEOUT', async () => {
    const never = deferred<TransactionClient>();
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();
    const recorder = new StandaloneAuditRecorder({ acquire: () => never.promise }, writer, logger, { budgetMs: 30 });

    const started = Date.now();
    await recorder.recordBestEffort(DENIED);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(500);
    expect(appended).toHaveLength(0);
    expect(lines).toEqual([
      { level: 'warn', event: 'audit_standalone_failed', meta: { code: 'AUDIT_ACQUIRE_TIMEOUT' } },
    ]);
  });

  it('releases a client that arrives AFTER the budget immediately, without using it (no leak, no late row)', async () => {
    const late = deferred<TransactionClient>();
    const { writer, appended } = recordingWriter();
    const { logger } = recordingLogger();
    const recorder = new StandaloneAuditRecorder({ acquire: () => late.promise }, writer, logger, { budgetMs: 25 });

    await recorder.recordBestEffort(DENIED); // the caller has been released: its budget is spent

    const client = fakeClient();
    late.resolve(client); // the queued acquisition finally yields a client
    await flush();

    expect(client.released).toEqual([false]); // returned to the pool right away
    expect(client.statements).toEqual([]); // not a single statement: nothing was written late
    expect(appended).toHaveLength(0);
  });

  it('does not start a write when the client arrives exactly as the budget runs out', async () => {
    let clock = 0;
    const client = fakeClient();
    const source: TransactionClientSource = {
      acquire: () => {
        clock = 10_000; // the budget is long gone by the time the acquisition resolves
        return Promise.resolve(client);
      },
    };
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(source, writer, logger, { budgetMs: 30, now: () => clock }).recordBestEffort(DENIED);

    expect(client.statements).toEqual([]);
    expect(client.released).toEqual([false]);
    expect(appended).toHaveLength(0);
    expect(codes(lines)).toEqual(['AUDIT_ACQUIRE_TIMEOUT']);
  });

  it('swallows an acquisition failure (database outage) with the fixed AUDIT_WRITE_FAILED code', async () => {
    const source: TransactionClientSource = {
      acquire: () => Promise.reject(Object.assign(new Error(`connect ECONNREFUSED ${MARKER}`), { code: 'ECONNREFUSED' })),
    };
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(source, writer, logger).recordBestEffort(DENIED);

    expect(codes(lines)).toEqual(['AUDIT_WRITE_FAILED']);
    expect(JSON.stringify(lines)).not.toContain(MARKER);
  });

  it('turns a synchronous throw from the connection source into the same best-effort outcome', async () => {
    const source: TransactionClientSource = {
      acquire: () => {
        throw new Error(MARKER);
      },
    };
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();
    await new StandaloneAuditRecorder(source, writer, logger).recordBestEffort(DENIED);
    expect(codes(lines)).toEqual(['AUDIT_WRITE_FAILED']);
  });
});

describe('StandaloneAuditRecorder — one budget for acquire + BEGIN + INSERT + COMMIT (C27)', () => {
  it('gives the transaction only the time that is LEFT after acquisition, so the total stays at the budget', async () => {
    const client = fakeClient((text) => (text.startsWith('INSERT') ? new Promise<QueryRows>(() => undefined) : undefined));
    const source: TransactionClientSource = {
      acquire: () => new Promise<TransactionClient>((resolve) => setTimeout(() => resolve(client), 200)),
    };
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();
    // budget 300: acquisition takes ~200, so the transaction may only use ~100. A recorder that handed the
    // manager a fresh 300 would finish at ~500.
    const recorder = new StandaloneAuditRecorder(source, writer, logger, { budgetMs: 300 });

    const started = Date.now();
    await recorder.recordBestEffort(DENIED);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(270);
    expect(elapsed).toBeLessThan(420);
    expect(codes(lines)).toEqual(['AUDIT_WRITE_TIMEOUT']);
    expect(client.released).toEqual([true]); // the hung connection is destroyed, never returned to the pool
  });

  it('a hanging INSERT ends the call at the budget with AUDIT_WRITE_TIMEOUT and no COMMIT', async () => {
    const client = fakeClient((text) => (text.startsWith('INSERT') ? new Promise<QueryRows>(() => undefined) : undefined));
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();

    const started = Date.now();
    await new StandaloneAuditRecorder(sourceOf(client), writer, logger, { budgetMs: 40 }).recordBestEffort(DENIED);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(500);
    expect(codes(lines)).toEqual(['AUDIT_WRITE_TIMEOUT']);
    expect(client.statements).not.toContain('COMMIT');
    expect(client.released).toEqual([true]);
  });
});

describe('StandaloneAuditRecorder — every failure is swallowed after a fixed-code log (C27)', () => {
  const leaky = Object.assign(new Error(`message ${MARKER}`), {
    code: `${MARKER}_CODE`,
    detail: `${MARKER}_DETAIL`,
    hint: `${MARKER}_HINT`,
    stack: `Error: ${MARKER}\n    at ${MARKER} (file.ts:1:1)`,
  });

  it('a failing INSERT is swallowed; the error content never reaches the log', async () => {
    const client = fakeClient();
    const { writer } = recordingWriter(() => Promise.reject(leaky));
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(sourceOf(client), writer, logger).recordBestEffort(DENIED);

    expect(codes(lines)).toEqual(['AUDIT_WRITE_FAILED']);
    expect(lines).toEqual([{ level: 'warn', event: 'audit_standalone_failed', meta: { code: 'AUDIT_WRITE_FAILED' } }]);
    expect(JSON.stringify(lines)).not.toContain('SECRET_MARKER');
    expect(client.statements).toContain('ROLLBACK');
    expect(client.statements).not.toContain('COMMIT');
    expect(client.released).toEqual([false]);
  });

  it('a lost COMMIT acknowledgement is swallowed too, and the connection is destroyed', async () => {
    const client = fakeClient((text) =>
      text === 'COMMIT' ? Promise.reject(Object.assign(new Error(`lost ${MARKER}`), { code: 'ECONNRESET' })) : undefined,
    );
    const { writer } = recordingWriter();
    const { logger, lines } = recordingLogger();

    await new StandaloneAuditRecorder(sourceOf(client), writer, logger).recordBestEffort(DENIED);

    expect(codes(lines)).toEqual(['AUDIT_WRITE_FAILED']);
    expect(JSON.stringify(lines)).not.toContain(MARKER);
    expect(client.released).toEqual([true]);
  });

  it('a logger that throws cannot change the outcome: the call still resolves', async () => {
    const { writer } = recordingWriter(() => Promise.reject(leaky));
    const throwing: AuditFailureLogger = {
      log: () => {
        throw new Error(`logger exploded ${MARKER}`);
      },
    };
    await expect(
      new StandaloneAuditRecorder(sourceOf(fakeClient()), writer, throwing).recordBestEffort(DENIED),
    ).resolves.toBeUndefined();
  });

  it('never rejects, whatever fails', async () => {
    const { logger } = recordingLogger();
    const failures: Array<[string, TransactionClientSource, AuditAppender]> = [
      ['acquire rejects', { acquire: () => Promise.reject(leaky) }, recordingWriter().writer],
      ['acquire throws', { acquire: () => { throw leaky; } }, recordingWriter().writer],
      ['writer rejects', sourceOf(fakeClient()), recordingWriter(() => Promise.reject(leaky)).writer],
      ['writer throws synchronously', sourceOf(fakeClient()), { append: () => { throw leaky; } }],
      ['BEGIN fails', sourceOf(fakeClient((text) => (text === 'BEGIN' ? Promise.reject(leaky) : undefined))), recordingWriter().writer],
    ];
    for (const [, source, writer] of failures) {
      await expect(new StandaloneAuditRecorder(source, writer, logger).recordBestEffort(DENIED)).resolves.toBeUndefined();
    }
  });
});

describe('StandaloneAuditRecorder — only after the business transaction is over', () => {
  it('called inside a business callback it refuses to open a second transaction and returns its connection', async () => {
    const outerClient = fakeClient();
    const innerClient = fakeClient();
    const outer = new TransactionManager(sourceOf(outerClient), { timeoutMs: 5_000, idleInTransactionTimeoutMs: 2_000 });
    const { writer, appended } = recordingWriter();
    const { logger, lines } = recordingLogger();
    const recorder = new StandaloneAuditRecorder(sourceOf(innerClient), writer, logger, { budgetMs: 100 });

    await outer.withTransaction(async () => {
      await recorder.recordBestEffort(DENIED);
    });

    expect(appended).toHaveLength(0);
    expect(innerClient.statements).toEqual([]);
    expect(innerClient.released).toEqual([false]); // handed back, not leaked
    expect(codes(lines)).toEqual(['AUDIT_WRITE_FAILED']);
    expect(outerClient.statements[outerClient.statements.length - 1]).toBe('COMMIT'); // the business transaction is untouched
  });
});
