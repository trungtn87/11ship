import { REAL_TIMERS, Timers } from '../health.js';
import { parseRetryAfter } from './contract.js';

// One HTTP call of the client authentication. The rules, in one place:
//  * a time limit on every call (default 15 s), enforced twice: AbortController AND a deadline that wins even if the
//    injected fetch ignores the signal;
//  * `cache: 'no-store'`, `credentials: 'omit'` (the bearer travels only in the Authorization header, never in a cookie),
//    `redirect: 'error'`, `referrerPolicy: 'no-referrer'`;
//  * the URL is a fixed path: no phone, password, OTP, proof or token is ever put in it or in a query string;
//  * the body is read with a size limit and parsed as JSON; anything else is "no usable body", never an exception;
//  * the call NEVER throws and NEVER retries: a lost response is reported as such and the caller decides (a keyed mutation
//    keeps its key and body; nothing here creates a key or sends a POST twice);
//  * nothing is logged and no telemetry is sent.

export const AUTH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 65_536;

export interface TransportOptions {
  readonly fetch: typeof fetch;
  /** '' = same origin. No trailing slash. */
  readonly baseUrl?: string;
  readonly timers?: Timers;
  readonly timeoutMs?: number;
}

export interface TransportRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** The exact JSON text to send. The caller serializes once, so a retry of the same intent sends the same bytes. */
  readonly body?: string;
  readonly bearer?: string;
  readonly idempotencyKey?: string;
  /** Aborting this signal ends the call as `aborted` (logout cancels the authenticated calls that are still running). */
  readonly signal?: AbortSignal;
}

export type TransportResult =
  | { readonly kind: 'response'; readonly status: number; /** Parsed JSON, or undefined when there is no usable JSON body. */ readonly body: unknown; readonly retryAfterSeconds?: number }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network' }
  | { readonly kind: 'aborted' };

export interface AuthTransport {
  send(request: TransportRequest): Promise<TransportResult>;
}

export function createTransport(options: TransportOptions): AuthTransport {
  const timers = options.timers ?? REAL_TIMERS;
  const timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT_MS;
  const base = options.baseUrl ?? '';

  return {
    async send(request) {
      if (request.signal?.aborted === true) {
        return { kind: 'aborted' };
      }
      const controller = new AbortController();
      const onOuterAbort = (): void => controller.abort();
      request.signal?.addEventListener('abort', onOuterAbort, { once: true });
      let deadlineHandle: unknown;
      let aborted: (() => void) | undefined;
      const interruption = new Promise<'timeout' | 'aborted'>((resolve) => {
        deadlineHandle = timers.set(() => {
          controller.abort();
          resolve('timeout');
        }, timeoutMs);
        aborted = () => resolve('aborted');
        request.signal?.addEventListener('abort', aborted, { once: true });
      });

      const attempt = async (): Promise<TransportResult> => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (request.body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }
        if (request.bearer !== undefined) {
          headers.Authorization = `Bearer ${request.bearer}`;
        }
        if (request.idempotencyKey !== undefined) {
          headers['Idempotency-Key'] = request.idempotencyKey;
        }
        let response: Response;
        try {
          response = await options.fetch(`${base}${request.path}`, {
            method: request.method,
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers,
            ...(request.body === undefined ? {} : { body: request.body }),
            signal: controller.signal,
          });
        } catch {
          return controller.signal.aborted ? { kind: 'aborted' } : { kind: 'network' };
        }
        const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'), timers.now());
        let body: unknown;
        if (response.status !== 204) {
          try {
            const text = await response.text();
            const type = response.headers.get('Content-Type') ?? '';
            if (text.length <= MAX_BODY_CHARS && /^application\/json\b/i.test(type)) {
              body = JSON.parse(text);
            }
          } catch {
            body = undefined;
          }
        }
        return retryAfterSeconds === undefined ? { kind: 'response', status: response.status, body } : { kind: 'response', status: response.status, body, retryAfterSeconds };
      };

      try {
        const settled = await Promise.race([attempt(), interruption]);
        if (settled === 'timeout') {
          return { kind: 'timeout' };
        }
        return settled === 'aborted' ? { kind: 'aborted' } : settled;
      } finally {
        timers.clear(deadlineHandle);
        request.signal?.removeEventListener('abort', onOuterAbort);
        if (aborted !== undefined) {
          request.signal?.removeEventListener('abort', aborted);
        }
      }
    },
  };
}
