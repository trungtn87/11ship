// Unit-test helpers for the admin web core (compiled only by tsconfig.test.json; never shipped to the browser build,
// which excludes nothing but *.spec.ts - this file has no DOM or Node dependency and is harmless if bundled).
import { AdminActivationApi } from './activation-api.js';
import { AdminAuthApi, Transport, TransportRequest, TransportResponse } from './api.js';
import { Clock } from './controller.js';
import { AdminProvisioningApi } from './provisioning-api.js';

export interface Scripted {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

type Step = Scripted | 'network' | Promise<Scripted | 'network'>;

/**
 * A scripted transport: each call takes the next answer queued for "METHOD /path". Every request is recorded. A path
 * without a queued answer fails the test loudly.
 */
export class FakeServer {
  readonly requests: TransportRequest[] = [];
  readonly #queues = new Map<string, Step[]>();

  on(method: 'GET' | 'POST', path: string, ...answers: Step[]): this {
    const key = `${method} ${path}`;
    this.#queues.set(key, [...(this.#queues.get(key) ?? []), ...answers]);
    return this;
  }

  count(method: 'GET' | 'POST', path: string): number {
    return this.requests.filter((request) => request.method === method && request.path === path).length;
  }

  readonly transport: Transport = async (request) => {
    this.requests.push(request);
    const queue = this.#queues.get(`${request.method} ${request.path}`);
    const next = queue?.shift();
    if (next === undefined) {
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
    const answer = await next;
    if (answer === 'network') {
      throw new TypeError('Failed to fetch');
    }
    return response(answer);
  };

  api(): AdminAuthApi {
    return new AdminAuthApi(this.transport);
  }

  provisioningApi(): AdminProvisioningApi {
    return new AdminProvisioningApi(this.transport);
  }

  activationApi(): AdminActivationApi {
    return new AdminActivationApi(this.transport);
  }
}

function response(answer: Scripted): TransportResponse {
  const headers = Object.fromEntries(Object.entries(answer.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status: answer.status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    json: async () => answer.body,
  };
}

export const ok = (data: Record<string, unknown>): Scripted => ({ status: 200, body: { data } });
export const noContent: Scripted = { status: 204 };
export const fail = (status: number, code: string, headers?: Record<string, string>): Scripted => ({
  status,
  body: { error: { code, message: 'x', request_id: 'r', details: {} } },
  ...(headers === undefined ? {} : { headers }),
});

const FUTURE = '2999-01-01T00:00:00.000Z';
export const sessionState = (csrf = 'csrf-session-1') => ok({ state: 'SESSION', next_step: null, expires_at: FUTURE, csrf_token: csrf });
export const preauthState = (step: 'ENROLL_TOTP' | 'VERIFY_TOTP', csrf = 'csrf-pre-1') =>
  ok({ state: 'PREAUTH', next_step: step, expires_at: FUTURE, csrf_token: csrf });
export const loginOk = (step: 'ENROLL_TOTP' | 'VERIFY_TOTP', csrf = 'csrf-pre-1') => ok({ next_step: step, expires_at: FUTURE, csrf_token: csrf });
export const meOk = (role: 'SYSTEM' | 'ADMIN' = 'SYSTEM', csrf = 'csrf-session-1') =>
  ok({ user_id: 'user-1', admin_role: role, expires_at: FUTURE, csrf_token: csrf });
export const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const enrollmentOk = () =>
  ok({ secret: SECRET, otpauth_uri: `otpauth://totp/11Ship%20Admin:%2B84912345678?secret=${SECRET}&issuer=11Ship%20Admin`, expires_at: FUTURE });
export const noSession = () => fail(401, 'ADMIN_SESSION_INVALID');

/** A manual clock: timers run only when the test advances time. */
export class FakeClock implements Clock {
  #now = Date.parse('2026-10-09T09:00:00.000Z');
  #timers: { at: number; callback: () => void; id: number }[] = [];
  #id = 0;

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    this.#id += 1;
    this.#timers.push({ at: this.#now + ms, callback, id: this.#id });
    return this.#id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers = this.#timers.filter((timer) => timer.id !== handle);
  }

  /** Number of timers still scheduled (a finished request must leave none behind). */
  pending(): number {
    return this.#timers.length;
  }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const due = this.#timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      this.#timers = this.#timers.filter((timer) => timer !== due);
      this.#now = due.at;
      due.callback();
    }
    this.#now = target;
  }
}

/** Lets pending promise continuations run. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

/** A promise the test resolves by hand (to look at the screen while a request is in flight). */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// ---- 1B (invitations) fixtures ----

export const INVITATION_ID = '11111111-1111-4111-8111-111111111111';
export const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
export const KEY_1 = '33333333-3333-4333-8333-333333333333';
export const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456789'.slice(0, 43);
export const LINK = `https://localhost:8443/activate#t=${TOKEN}`;

export const permissionWire = (app: 'CUSTOMER' | 'SHOP' | 'DRIVER' = 'SHOP', rights: { view?: boolean; review?: boolean; lock?: boolean } = {}) => ({
  app,
  can_view: rights.view ?? true,
  can_review_profile: rights.review ?? false,
  can_lock: rights.lock ?? false,
});

export const invitationWire = (overrides: Record<string, unknown> = {}) => ({
  invitation_id: INVITATION_ID,
  status: 'PENDING',
  version: 1,
  full_name: 'Nguyễn Văn A',
  phone_masked: '09•• ••• 678',
  note: null,
  permissions: [permissionWire('SHOP')],
  created_at: '2026-10-10T08:00:00.000Z',
  expires_at: '2026-10-17T08:00:00.000Z',
  terminal_at: null,
  successor_id: null,
  expired: false,
  ...overrides,
});

export const operationCreated = (): Scripted => ({
  status: 201,
  body: { data: { operation_id: OPERATION_ID, action: 'CREATE_INVITATION', status: 'PENDING', expires_at: '2026-10-09T09:02:00.000Z' } },
});
export const operationCreatedFor = (action: 'CREATE_INVITATION' | 'REISSUE_INVITATION' | 'REVOKE_INVITATION'): Scripted => ({
  status: 201,
  body: { data: { operation_id: OPERATION_ID, action, status: 'PENDING', expires_at: '2026-10-09T09:02:00.000Z' } },
});
export const operationVerified = () => ok({ operation_id: OPERATION_ID, status: 'VERIFIED', expires_at: '2026-10-09T09:02:00.000Z' });
export const operationView = (flags: { verifiable: boolean; usable: boolean; status?: string }) =>
  ok({
    operation_id: OPERATION_ID,
    action: 'CREATE_INVITATION',
    status: flags.status ?? (flags.usable ? 'VERIFIED' : 'PENDING'),
    expires_at: '2026-10-09T09:02:00.000Z',
    expired: false,
    verifiable: flags.verifiable,
    usable: flags.usable,
    attempts_remaining: 4,
    verified_at: null,
    consumed_at: null,
    invalidated_reason: null,
  });
export const issuedCreated = (): Scripted => ({ status: 201, body: { data: { invitation: invitationWire(), activation_link: LINK } } });
export const issuedReissued = (): Scripted => ({
  status: 201,
  body: { data: { invitation: invitationWire({ invitation_id: '44444444-4444-4444-8444-444444444444', version: 1 }), superseded_invitation_id: INVITATION_ID, activation_link: LINK } },
});
export const revokedOk = (): Scripted => ok({ invitation: invitationWire({ status: 'REVOKED', version: 2, terminal_at: '2026-10-09T09:01:00.000Z' }) });
export const listOk = (items: unknown[] = [invitationWire()], next: string | null = null) => ok({ items, next_cursor: next });

// ---- 1C (activation) fixtures ----

export const startedFresh = (): Scripted => ({ status: 201, body: { data: { state: 'STARTED', csrf_token: 'csrf-act-1', expires_at: FUTURE } } });
export const actState = (state: string, extra: Record<string, unknown> = {}): Scripted =>
  ok({ state, ...(state === 'COMPLETED' || state === 'INVALIDATED' ? {} : { expires_at: FUTURE, csrf_token: 'csrf-act-1' }), ...extra });
export const otpStatus = (status: string, extra: Record<string, unknown> = {}, expiresAt: string = FUTURE) =>
  actState('STARTED', { expires_at: expiresAt, otp: { status, ...extra } });
export const actError = (status: number, code: string, details: Record<string, unknown> = {}, headers?: Record<string, string>): Scripted => ({
  status,
  body: { error: { code, message: 'x', request_id: 'r', details } },
  ...(headers === undefined ? {} : { headers }),
});
export const ACT_SECRET = SECRET;
export const actEnrollment = (): Scripted => ok({ state: 'TOTP_ISSUED', otpauth_uri: `otpauth://totp/11Ship%20Admin:%2B84912345678?secret=${SECRET}&issuer=11Ship%20Admin`, secret: SECRET });
