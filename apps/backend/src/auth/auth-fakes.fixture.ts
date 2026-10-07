import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

// Test-only fakes for the Auth service unit specs (excluded from the build). They let a spec prove ORDER and
// BOUNDARY facts (what runs inside a transaction, which lock comes first) without a database. Everything about
// real SQL and real locking is proven by the PostgreSQL integration suites instead.

export interface FakeTransactions {
  readonly manager: TransactionManager;
  readonly state: { inTransaction: boolean; transactions: number };
  readonly events: string[];
}

/** A clock row is answered for any query, which is all freshClockMs needs from the context. */
export function fakeContext(nowMs = 1_000_000, events: string[] = []): TransactionContext {
  return {
    isActive: true,
    query: async () => {
      events.push('clock');
      return { rows: [{ now_ms: String(nowMs) }] as never[], rowCount: 1 };
    },
  };
}

export function fakeTransactions(nowMs = 1_000_000): FakeTransactions {
  const state = { inTransaction: false, transactions: 0 };
  const events: string[] = [];
  const manager = {
    withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => {
      state.inTransaction = true;
      state.transactions += 1;
      try {
        return await work(fakeContext(nowMs, events));
      } finally {
        state.inTransaction = false;
      }
    },
  } as unknown as TransactionManager;
  return { manager, state, events };
}
