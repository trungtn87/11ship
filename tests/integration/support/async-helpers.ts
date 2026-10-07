export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** A barrier controlled by the test: concurrency order is decided by it, not by sleeping. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Polls a condition about EXTERNAL state (for example a PostgreSQL backend going away) until it holds.
 * It is a bounded wait for the server, never a stand-in for ordering two test-controlled actions.
 */
export async function eventually(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 8000,
  stepMs = 25,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs} ms: ${description}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, stepMs));
  }
}

export async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}
