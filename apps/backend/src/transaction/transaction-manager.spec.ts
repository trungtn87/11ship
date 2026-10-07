import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { QueryRows } from './transaction-context';
import { TransactionError } from './transaction-error';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
  TransactionOptions,
} from './transaction-manager';

// These tests pin the lifecycle rules with a scripted client so each branch (including faults that a
// real server rarely produces) is deterministic. The same rules are proven against a real
// PostgreSQL server in tests/integration/transaction-manager.int.spec.ts.

type Handler = (text: string, values?: readonly unknown[]) => Promise<QueryRows> | QueryRows;

function rows(text: string): QueryRows {
  const command = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return { rows: [], rowCount: 0, command };
}

class ScriptedClient implements TransactionClient {
  readonly log: string[] = [];
  readonly released: Array<boolean | undefined> = [];
  readonly listeners = new Set<(error: Error) => void>();

  constructor(private readonly handler: Handler = rows) {}

  query(text: string, values?: readonly unknown[]): Promise<QueryRows> {
    this.log.push(text);
    try {
      return Promise.resolve(this.handler(text, values));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  release(destroy?: boolean): void {
    this.released.push(destroy);
  }

  onError(listener: (error: Error) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitError(error: Error): void {
    for (const listener of [...this.listeners]) {
      listener(error);
    }
  }
}

function sourceOf(client: ScriptedClient): TransactionClientSource & { acquired: number } {
  const source = {
    acquired: 0,
    acquire: () => {
      source.acquired += 1;
      return Promise.resolve(client);
    },
  };
  return source;
}

const OPTIONS: TransactionOptions = { timeoutMs: 1000, idleInTransactionTimeoutMs: 500 };

function managerFor(client: ScriptedClient, options: TransactionOptions = OPTIONS) {
  const source = sourceOf(client);
  return { manager: new TransactionManager(source, options), source };
}

function serverError(code: string, severity = 'ERROR'): Error {
  return Object.assign(new Error(`SECRET server text for ${code}`), { code, severity });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe('TransactionManager — commit path', () => {
  it('runs BEGIN, the idle timeout setup, the callback statements and COMMIT on one client, then releases it', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);

    const result = await manager.withTransaction(async (context) => {
      await context.query('INSERT INTO t VALUES ($1)', [1]);
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.log).toEqual([
      'BEGIN',
      "SELECT set_config('idle_in_transaction_session_timeout', $1, true)",
      'INSERT INTO t VALUES ($1)',
      'COMMIT',
    ]);
    expect(client.released).toEqual([false]);
    expect(client.listeners.size).toBe(0);
  });

  it('closes the context after commit: later queries are refused before touching the client', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);
    let kept: { isActive: boolean; query: (text: string) => Promise<unknown> } | undefined;

    await manager.withTransaction((context) => {
      kept = context;
      return Promise.resolve();
    });

    const logged = client.log.length;
    expect(kept?.isActive).toBe(false);
    const error = await failureOf(() => kept?.query('SELECT 1') ?? Promise.resolve());
    expect(error).toBeInstanceOf(TransactionError);
    expect((error as TransactionError).reason).toBe('CONTEXT_CLOSED');
    expect(client.log).toHaveLength(logged);
  });

  it('treats COMMIT answered with the ROLLBACK command tag as a rejected commit, not a success', async () => {
    const client = new ScriptedClient((text) =>
      text === 'COMMIT' ? { rows: [], rowCount: null, command: 'ROLLBACK' } : rows(text),
    );
    const { manager } = managerFor(client);

    const error = await failureOf(() => manager.withTransaction(() => Promise.resolve('x')));
    expect((error as TransactionError).reason).toBe('COMMIT_REJECTED');
    expect(client.released).toEqual([false]);
  });
});

describe('TransactionManager — rollback path', () => {
  it('rolls back, releases cleanly and rethrows the callback error unchanged', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);
    const boom = new Error('business failure');

    const error = await failureOf(() =>
      manager.withTransaction(async (context) => {
        await context.query('INSERT INTO t VALUES (1)');
        throw boom;
      }),
    );

    expect(error).toBe(boom);
    expect(client.log.at(-1)).toBe('ROLLBACK');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toEqual([false]);
  });

  it('also handles a callback that throws synchronously', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);
    const boom = new Error('sync failure');

    const error = await failureOf(() =>
      manager.withTransaction(() => {
        throw boom;
      }),
    );

    expect(error).toBe(boom);
    expect(client.released).toEqual([false]);
  });

  it('destroys the client when ROLLBACK itself fails and still reports the original error', async () => {
    const client = new ScriptedClient((text) => {
      if (text === 'ROLLBACK') {
        throw new Error('socket closed');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);
    const boom = new Error('business failure');

    const error = await failureOf(() => manager.withTransaction(() => Promise.reject(boom)));

    expect(error).toBe(boom);
    expect(client.released).toEqual([true]);
  });

  it('never runs the callback a second time (no automatic retry) for 40001 and 40P01', async () => {
    for (const [code, reason] of [
      ['40001', 'SERIALIZATION_FAILURE'],
      ['40P01', 'DEADLOCK_DETECTED'],
    ] as const) {
      const client = new ScriptedClient();
      const { manager } = managerFor(client);
      let calls = 0;

      const error = await failureOf(() =>
        manager.withTransaction(() => {
          calls += 1;
          return Promise.reject(serverError(code));
        }),
      );

      expect(calls).toBe(1);
      expect(error).toBeInstanceOf(TransactionError);
      expect((error as TransactionError).reason).toBe(reason);
      expect((error as TransactionError).sqlState).toBe(code);
      expect(JSON.stringify(error)).not.toContain('SECRET');
      expect((error as Error).message).not.toContain('SECRET');
      expect(client.released).toEqual([false]);
    }
  });

  it('keeps other server errors as they are, so callers can map their own constraints', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);
    const duplicate = serverError('23505');

    const error = await failureOf(() => manager.withTransaction(() => Promise.reject(duplicate)));
    expect(error).toBe(duplicate);
  });
});

describe('TransactionManager — connection faults', () => {
  it('fails BEGIN safely: BEGIN_FAILED, client destroyed, callback never runs', async () => {
    const client = new ScriptedClient((text) => {
      if (text === 'BEGIN') {
        throw new Error('connect ECONNRESET with SECRET');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);
    let ran = false;

    const error = await failureOf(() =>
      manager.withTransaction(() => {
        ran = true;
        return Promise.resolve();
      }),
    );

    expect((error as TransactionError).reason).toBe('BEGIN_FAILED');
    expect((error as Error).message).not.toContain('SECRET');
    expect(ran).toBe(false);
    expect(client.released).toEqual([true]);
  });

  it('reports ACQUIRE_FAILED and has nothing to release when no connection can be had', async () => {
    const manager = new TransactionManager(
      { acquire: () => Promise.reject(new Error('timeout exceeded when trying to connect')) },
      OPTIONS,
    );
    const error = await failureOf(() => manager.withTransaction(() => Promise.resolve()));
    expect((error as TransactionError).reason).toBe('ACQUIRE_FAILED');
  });

  it('turns a dropped connection during a callback query into CONNECTION_LOST and destroys the client', async () => {
    const client = new ScriptedClient((text) => {
      if (text.startsWith('SELECT broken')) {
        throw new Error('Connection terminated unexpectedly');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction((context) => context.query('SELECT broken')),
    );

    expect((error as TransactionError).reason).toBe('CONNECTION_LOST');
    expect(client.log).not.toContain('ROLLBACK');
    expect(client.released).toEqual([true]);
  });

  it('treats a FATAL server error as a lost connection', async () => {
    const client = new ScriptedClient((text) => {
      if (text.startsWith('SELECT fatal')) {
        throw serverError('57P01', 'FATAL');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction((context) => context.query('SELECT fatal')),
    );

    expect((error as TransactionError).reason).toBe('CONNECTION_LOST');
    expect((error as TransactionError).sqlState).toBe('57P01');
    expect(client.released).toEqual([true]);
  });

  it('does not send COMMIT over a connection that reported an error, and destroys it', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction((context) => {
        client.emitError(new Error('terminating connection due to idle-in-transaction timeout'));
        return context.query('SELECT 1');
      }),
    );

    expect((error as TransactionError).reason).toBe('CONNECTION_LOST');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toEqual([true]);
    expect(client.listeners.size).toBe(0);
  });

  it('destroys the client when a swallowed query failure left its state unknown', async () => {
    const client = new ScriptedClient((text) => {
      if (text.startsWith('SELECT slow')) {
        throw new Error('Query read timeout');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction(async (context) => {
        await context.query('SELECT slow').catch(() => undefined);
        return 'looks fine';
      }),
    );

    expect((error as TransactionError).reason).toBe('CLIENT_STATE_UNKNOWN');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toEqual([true]);
  });
});

describe('TransactionManager — COMMIT outcomes', () => {
  it('reports an UNKNOWN outcome (503 TRANSACTION_OUTCOME_UNKNOWN) when COMMIT gets no answer, without retry', async () => {
    const client = new ScriptedClient((text) => {
      if (text === 'COMMIT') {
        throw Object.assign(new Error('read ECONNRESET SECRET'), { code: 'ECONNRESET' });
      }
      return rows(text);
    });
    const { manager, source } = managerFor(client);
    let calls = 0;

    const error = await failureOf(() =>
      manager.withTransaction(async (context) => {
        calls += 1;
        await context.query('INSERT INTO t VALUES (1)');
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect((error as AppError).status).toBe(503);
    expect((error as Error).message).not.toContain('SECRET');
    expect(calls).toBe(1);
    expect(source.acquired).toBe(1);
    expect(client.log.filter((text) => text === 'COMMIT')).toHaveLength(1);
    expect(client.log).not.toContain('ROLLBACK');
    expect(client.released).toEqual([true]);
  });

  it('reports a rejected COMMIT as a known failure and releases the client normally', async () => {
    const client = new ScriptedClient((text) => {
      if (text === 'COMMIT') {
        throw serverError('23505');
      }
      return rows(text);
    });
    const { manager } = managerFor(client);

    const error = await failureOf(() => manager.withTransaction(() => Promise.resolve()));

    expect(error).toBeInstanceOf(TransactionError);
    expect((error as TransactionError).reason).toBe('COMMIT_REJECTED');
    expect((error as TransactionError).sqlState).toBe('23505');
    expect(client.released).toEqual([false]);
  });

  it('maps serialization failures and FATAL answers at COMMIT time', async () => {
    const serialization = new ScriptedClient((text) => {
      if (text === 'COMMIT') {
        throw serverError('40001');
      }
      return rows(text);
    });
    const fatal = new ScriptedClient((text) => {
      if (text === 'COMMIT') {
        throw serverError('57P01', 'FATAL');
      }
      return rows(text);
    });

    const first = await failureOf(() =>
      managerFor(serialization).manager.withTransaction(() => Promise.resolve()),
    );
    const second = await failureOf(() =>
      managerFor(fatal).manager.withTransaction(() => Promise.resolve()),
    );

    expect((first as TransactionError).reason).toBe('SERIALIZATION_FAILURE');
    expect(serialization.released).toEqual([false]);
    expect((second as TransactionError).reason).toBe('COMMIT_REJECTED');
    expect(fatal.released).toEqual([true]);
  });
});

describe('TransactionManager — deadline', () => {
  it('closes the context at the deadline, rolls back, and a late callback can no longer reach the client', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client, { timeoutMs: 30, idleInTransactionTimeoutMs: 500 });
    const gate = deferred();
    const lateResult = deferred<unknown>();

    const error = await failureOf(() =>
      manager.withTransaction(async (context) => {
        await context.query('INSERT INTO t VALUES (1)');
        await gate.promise; // not a query: the callback is simply slow
        lateResult.resolve(
          await context.query('INSERT INTO t VALUES (2)').then(
            () => 'executed',
            (late: unknown) => late,
          ),
        );
      }),
    );

    expect((error as TransactionError).reason).toBe('DEADLINE_EXCEEDED');
    expect(client.log.at(-1)).toBe('ROLLBACK');
    expect(client.released).toEqual([false]);
    const logged = [...client.log];

    gate.resolve();
    const late = await lateResult.promise;
    expect(late).toBeInstanceOf(TransactionError);
    expect((late as TransactionError).reason).toBe('CONTEXT_CLOSED');
    expect(client.log).toEqual(logged);
    expect(client.released).toEqual([false]);
  });

  it('destroys the connection instead of rolling back when a query is still running at the deadline', async () => {
    const hang = deferred<QueryRows>();
    const client = new ScriptedClient((text) => (text === 'SELECT slow' ? hang.promise : rows(text)));
    const { manager } = managerFor(client, { timeoutMs: 30, idleInTransactionTimeoutMs: 500 });

    const error = await failureOf(() =>
      manager.withTransaction((context) => context.query('SELECT slow')),
    );

    expect((error as TransactionError).reason).toBe('DEADLINE_EXCEEDED');
    expect(client.log).not.toContain('ROLLBACK');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toEqual([true]);

    // The abandoned query settling later must not release or touch anything again.
    hang.reject(new Error('Connection terminated'));
    await Promise.resolve();
    expect(client.released).toEqual([true]);
  });

  it('does not let a callback that fails after the deadline become an unhandled rejection', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client, { timeoutMs: 20, idleInTransactionTimeoutMs: 500 });
    const gate = deferred();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      await failureOf(() =>
        manager.withTransaction(async () => {
          await gate.promise;
          throw new Error('late failure');
        }),
      );
      gate.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
  });
});

describe('TransactionManager — participant boundary', () => {
  it('hands participants a query capability only: no client, pool, manager or transaction control', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);

    await manager.withTransaction((context) => {
      const own = Object.getOwnPropertyNames(context);
      const inherited = Object.getOwnPropertyNames(Object.getPrototypeOf(context) as object);
      expect(own).toEqual([]);
      expect(inherited.sort()).toEqual(['constructor', 'isActive', 'query']);
      for (const forbidden of [
        'release',
        'client',
        'pool',
        'manager',
        'commit',
        'rollback',
        'begin',
        'withTransaction',
        'savepoint',
      ]) {
        expect(forbidden in context).toBe(false);
      }
      expect(context.isActive).toBe(true);
      return Promise.resolve();
    });
  });

  it('refuses a nested withTransaction (no silent independent transaction) and rolls the outer one back', async () => {
    const client = new ScriptedClient();
    const { manager, source } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction(() => manager.withTransaction(() => Promise.resolve('inner'))),
    );

    expect((error as TransactionError).reason).toBe('NESTED_TRANSACTION');
    expect(source.acquired).toBe(1);
    expect(client.log.at(-1)).toBe('ROLLBACK');
  });

  it('allows sequential transactions after one finished', async () => {
    const client = new ScriptedClient();
    const { manager, source } = managerFor(client);

    await manager.withTransaction(() => Promise.resolve(1));
    await manager.withTransaction(() => Promise.resolve(2));

    expect(source.acquired).toBe(2);
    expect(client.released).toEqual([false, false]);
  });

  it.each([
    'COMMIT',
    ' rollback',
    'BEGIN',
    'end',
    'ABORT',
    'START TRANSACTION',
    'SAVEPOINT s1',
    'RELEASE s1',
    'PREPARE TRANSACTION \'x\'',
    '/* note */ COMMIT',
    '-- note\nROLLBACK',
    'SELECT 1; COMMIT',
    'INSERT INTO t VALUES (1);rollback',
  ])('refuses the transaction-control statement %s before it reaches the client', async (text) => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);

    const error = await failureOf(() => manager.withTransaction((context) => context.query(text)));

    expect((error as TransactionError).reason).toBe('CONTROL_STATEMENT');
    // Only the manager's own BEGIN and setup precede the rollback; the statement never went out.
    expect(client.log.slice(2)).toEqual(['ROLLBACK']);
  });

  it('lets ordinary statements through, including SET LOCAL', async () => {
    const client = new ScriptedClient();
    const { manager } = managerFor(client);

    await manager.withTransaction(async (context) => {
      await context.query('SET LOCAL lock_timeout = 250');
      await context.query("SELECT 'commit' AS word");
      await context.query('SELECT pg_advisory_xact_lock($1, $2)', [1, 2]);
    });

    expect(client.log).toContain('SET LOCAL lock_timeout = 250');
  });

  it('fails when the callback returns while a query it never awaited is still running', async () => {
    const hang = deferred<QueryRows>();
    const client = new ScriptedClient((text) => (text === 'SELECT detached' ? hang.promise : rows(text)));
    const { manager } = managerFor(client);

    const error = await failureOf(() =>
      manager.withTransaction((context) => {
        void context.query('SELECT detached').catch(() => undefined);
        return Promise.resolve('returned early');
      }),
    );

    expect((error as TransactionError).reason).toBe('DETACHED_QUERY');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toEqual([true]);
    hang.resolve(rows('SELECT'));
  });
});

describe('TransactionManager — construction', () => {
  it('rejects non-positive or fractional timeouts', () => {
    const source = sourceOf(new ScriptedClient());
    expect(() => new TransactionManager(source, { timeoutMs: 0, idleInTransactionTimeoutMs: 5 })).toThrow(
      RangeError,
    );
    expect(() => new TransactionManager(source, { timeoutMs: 5, idleInTransactionTimeoutMs: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('classifies programming errors as internal and infrastructure failures as unavailable', () => {
    expect(new TransactionError('CONTEXT_CLOSED').kind).toBe('internal');
    expect(new TransactionError('NESTED_TRANSACTION').kind).toBe('internal');
    expect(new TransactionError('DEADLINE_EXCEEDED').kind).toBe('unavailable');
    expect(new TransactionError('CONNECTION_LOST', '57P01').kind).toBe('unavailable');
    expect(new TransactionError('COMMIT_REJECTED', 'SECRET_MARKER').sqlState).toBeUndefined();
  });
});
