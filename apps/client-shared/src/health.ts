import { HealthFailureReason, HealthPhase } from './errors.js';

// Backend reachability for the two phone apps (catalog F05/F06/S06, C03).
//
//   GET /v1/health/live  -> 200 {"data":{"status":"ok"}}
//   GET /v1/health/ready -> 200 {"data":{"status":"ready"}}   or   HTTP 503 (process alive, not ready to serve)
//
// Rules this file enforces:
//  * every request has a time limit (5 s) and is sent with `cache: 'no-store'`: a health answer is never reused;
//  * no credentials, cookies or tokens are sent (`credentials: 'omit'`): health is public and carries no session;
//  * the body is checked exactly: a 200 whose body is not the agreed one is a failure, never "ok";
//  * a result is applied only if it belongs to the NEWEST check (generation guard), so a slow old answer can never
//    overwrite the state a newer check already set;
//  * a result carries a reason from a closed list, never an exception message or server text.
//
// No DOM here: it runs in the browser and in the Node tests (including against the real backend).

export const HEALTH_TIMEOUT_MS = 5000;
export const LIVE_PATH = '/v1/health/live';
export const READY_PATH = '/v1/health/ready';

/** Largest health body that is read. The real ones are about 30 bytes; anything bigger is not a health answer. */
const MAX_BODY_CHARS = 4096;

export type ProbeResult =
  | { readonly state: 'pending' }
  | { readonly state: 'skipped' }
  | { readonly state: 'ok'; readonly httpStatus: number; readonly elapsedMs: number }
  | { readonly state: 'failed'; readonly reason: HealthFailureReason; readonly httpStatus?: number; readonly elapsedMs: number };

export interface HealthSnapshot {
  readonly phase: HealthPhase;
  /** Number of the check this snapshot belongs to (0 = nothing was checked yet). */
  readonly generation: number;
  readonly live: ProbeResult;
  readonly ready: ProbeResult;
  /** When the last check FINISHED (epoch ms). Kept while a new check runs so the screen can say "last check". */
  readonly lastCheckedAt: number | undefined;
}

export interface Timers {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const REAL_TIMERS: Timers = {
  set: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clear: (handle) => globalThis.clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
  now: () => Date.now(),
};

export interface HealthOptions {
  readonly fetch: typeof fetch;
  readonly timers?: Timers;
  /** '' = same origin (the app and /v1 are served from one address). No trailing slash. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Re-check every N ms while `start()` is active. 0 / undefined = only on demand. */
  readonly intervalMs?: number;
  /** Polling pauses while this returns false (for example a hidden tab). Default: always poll. */
  readonly shouldPoll?: () => boolean;
}

const PENDING: ProbeResult = { state: 'pending' };

export function initialSnapshot(): HealthSnapshot {
  return { phase: 'checking', generation: 0, live: PENDING, ready: PENDING, lastCheckedAt: undefined };
}

/** True for exactly `{"data":{"status":<expected>}}` (an object, a `data` object, a string `status`). */
export function isHealthBody(value: unknown, expected: 'ok' | 'ready'): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const data = (value as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  return (data as { status?: unknown }).status === expected;
}

/** What the person is told, from the two probe results. Pure, so every combination is testable. */
export function derivePhase(live: ProbeResult, ready: ProbeResult): HealthPhase {
  if (live.state === 'pending') {
    return 'checking';
  }
  if (live.state === 'failed') {
    return phaseOfReason(live.reason, false);
  }
  if (live.state !== 'ok') {
    return 'checking';
  }
  if (ready.state === 'ok') {
    return 'ready';
  }
  if (ready.state === 'failed') {
    return phaseOfReason(ready.reason, true);
  }
  return 'checking';
}

function phaseOfReason(reason: HealthFailureReason, liveWasOk: boolean): HealthPhase {
  switch (reason) {
    case 'OFFLINE':
      return 'offline';
    case 'TIMEOUT':
      return 'timeout';
    case 'NOT_READY':
      return liveWasOk ? 'backend_not_ready' : 'bad_response';
    case 'BAD_RESPONSE':
    case 'UNEXPECTED_STATUS':
      return 'bad_response';
  }
}

/**
 * One GET with its own deadline. It always resolves to a result and never decides whether the result is still wanted: that
 * is the monitor's job (generation guard). `outer` only stops the network work early when a newer check replaced this one.
 */
async function probe(
  url: string,
  expected: 'ok' | 'ready',
  options: { readonly fetch: typeof fetch; readonly timers: Timers; readonly timeoutMs: number; readonly outer: AbortSignal },
): Promise<ProbeResult> {
  const { timers, outer } = options;
  const startedAt = timers.now();
  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort();
  if (outer.aborted) {
    controller.abort();
  } else {
    outer.addEventListener('abort', onOuterAbort, { once: true });
  }

  let timeoutHandle: unknown;
  let timedOut = false;
  const deadline = new Promise<'timeout'>((resolve) => {
    timeoutHandle = timers.set(() => {
      timedOut = true;
      controller.abort();
      resolve('timeout');
    }, options.timeoutMs);
  });
  const elapsed = (): number => Math.max(0, timers.now() - startedAt);
  const failed = (reason: HealthFailureReason, httpStatus?: number): ProbeResult =>
    httpStatus === undefined ? { state: 'failed', reason, elapsedMs: elapsed() } : { state: 'failed', reason, httpStatus, elapsedMs: elapsed() };

  const attempt = async (): Promise<ProbeResult> => {
    let response: Response;
    try {
      response = await options.fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      // Network failure, refused connection, DNS, CORS, a redirect we refuse, or our own abort: the message is never used.
      return failed('OFFLINE');
    }
    const status = response.status;
    if (expected === 'ready' && status === 503) {
      return failed('NOT_READY', 503);
    }
    if (status !== 200) {
      return failed('UNEXPECTED_STATUS', status);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      return failed('OFFLINE', status);
    }
    if (text.length > MAX_BODY_CHARS) {
      return failed('BAD_RESPONSE', status);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return failed('BAD_RESPONSE', status);
    }
    return isHealthBody(body, expected) ? { state: 'ok', httpStatus: status, elapsedMs: elapsed() } : failed('BAD_RESPONSE', status);
  };

  try {
    const outcome = await Promise.race([attempt(), deadline]);
    if (outcome === 'timeout' || timedOut) {
      return failed('TIMEOUT');
    }
    return outcome;
  } finally {
    timers.clear(timeoutHandle);
    outer.removeEventListener('abort', onOuterAbort);
  }
}

export type HealthListener = (snapshot: HealthSnapshot) => void;

export class HealthMonitor {
  readonly #fetch: typeof fetch;
  readonly #timers: Timers;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #intervalMs: number;
  readonly #shouldPoll: () => boolean;
  readonly #listeners = new Set<HealthListener>();
  #snapshot: HealthSnapshot = initialSnapshot();
  #generation = 0;
  #controller: AbortController | undefined;
  #running = false;
  #pollHandle: unknown;

  constructor(options: HealthOptions) {
    this.#fetch = options.fetch;
    this.#timers = options.timers ?? REAL_TIMERS;
    this.#baseUrl = options.baseUrl ?? '';
    this.#timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
    this.#intervalMs = options.intervalMs ?? 0;
    this.#shouldPoll = options.shouldPoll ?? (() => true);
  }

  snapshot(): HealthSnapshot {
    return this.#snapshot;
  }

  /** Listener is called on every change. It is NOT called with the current value when subscribing. Returns the unsubscribe. */
  subscribe(listener: HealthListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Begins periodic checking (if an interval was given) and runs a check now. */
  start(): void {
    this.#running = true;
    void this.check();
  }

  /** Stops periodic checking and cancels a check in flight (its answer will not be applied). */
  stop(): void {
    this.#running = false;
    this.#clearPoll();
    this.#invalidate();
  }

  /**
   * Starts a new check and returns the state when THIS check finishes. If a newer check (or `markOffline`) replaced it
   * first, this one stops and returns whatever the current state is at that moment, without changing it. The previous
   * check, if still running, is cancelled and its answer is dropped. While the new check runs the state is `checking`:
   * the old "Sẵn sàng" is gone immediately, it is never shown next to a check that has not answered.
   */
  async check(): Promise<HealthSnapshot> {
    this.#clearPoll();
    const generation = this.#invalidate();
    const controller = new AbortController();
    this.#controller = controller;
    this.#set({ phase: 'checking', generation, live: PENDING, ready: PENDING, lastCheckedAt: this.#snapshot.lastCheckedAt });

    const common = { fetch: this.#fetch, timers: this.#timers, timeoutMs: this.#timeoutMs, outer: controller.signal };
    const live = await probe(`${this.#baseUrl}${LIVE_PATH}`, 'ok', common);
    // Generation guard: a newer check (or markOffline / stop) already took over, so this answer is old and is dropped.
    if (generation !== this.#generation) {
      return this.#snapshot;
    }
    // Interim state: liveness is known, readiness is being asked. The person still sees "checking".
    this.#set({ phase: 'checking', generation, live, ready: PENDING, lastCheckedAt: this.#snapshot.lastCheckedAt });

    let ready: ProbeResult;
    if (live.state === 'ok') {
      ready = await probe(`${this.#baseUrl}${READY_PATH}`, 'ready', common);
      if (generation !== this.#generation) {
        return this.#snapshot;
      }
    } else {
      // The process did not answer /live: asking /ready would only wait for a second timeout.
      ready = { state: 'skipped' };
    }
    this.#set({ phase: derivePhase(live, ready), generation, live, ready, lastCheckedAt: this.#timers.now() });
    this.#schedulePoll(generation);
    return this.#snapshot;
  }

  /**
   * The browser says the network is gone: cancel what is in flight and show "offline" at once, without waiting for a
   * timeout. A later `check()` (for example when the network returns) replaces it.
   */
  markOffline(): void {
    const generation = this.#invalidate();
    const failed: ProbeResult = { state: 'failed', reason: 'OFFLINE', elapsedMs: 0 };
    this.#set({ phase: 'offline', generation, live: failed, ready: { state: 'skipped' }, lastCheckedAt: this.#snapshot.lastCheckedAt });
  }

  #invalidate(): number {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = undefined;
    return this.#generation;
  }

  #set(snapshot: HealthSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of [...this.#listeners]) {
      listener(snapshot);
    }
  }

  #clearPoll(): void {
    if (this.#pollHandle !== undefined) {
      this.#timers.clear(this.#pollHandle);
      this.#pollHandle = undefined;
    }
  }

  #schedulePoll(generation: number): void {
    if (!this.#running || this.#intervalMs <= 0 || generation !== this.#generation) {
      return;
    }
    this.#pollHandle = this.#timers.set(() => {
      this.#pollHandle = undefined;
      if (!this.#running) {
        return;
      }
      if (this.#shouldPoll()) {
        void this.check();
      } else {
        this.#schedulePoll(this.#generation);
      }
    }, this.#intervalMs);
  }
}
