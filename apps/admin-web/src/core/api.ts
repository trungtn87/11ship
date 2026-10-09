// HTTP client of the administration authentication (/v1/admin-auth). It knows the seven routes and their exact
// bodies, and turns every outcome into a closed result type: the controller never sees a raw Response.
//
// Credentials travel ONLY as the backend's HttpOnly cookies (credentials: 'same-origin'); there is no bearer token
// and nothing is written to localStorage/sessionStorage here. Origin is set by the browser, never by this code. The
// CSRF token is passed in by the caller from memory and sent as x-csrf-token on mutations.

export const API_BASE = '/v1/admin-auth';

export type AdminRole = 'SYSTEM' | 'ADMIN';
export type NextStep = 'ENROLL_TOTP' | 'VERIFY_TOTP';

export interface LoginData {
  readonly nextStep: NextStep;
  readonly expiresAt: string;
  readonly csrfToken: string;
}

export type StateData =
  | { readonly state: 'SESSION'; readonly expiresAt: string; readonly csrfToken: string }
  | { readonly state: 'PREAUTH'; readonly nextStep: NextStep; readonly expiresAt: string; readonly csrfToken: string };

export interface EnrollmentData {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly expiresAt: string;
}

export interface SessionData {
  readonly userId: string;
  readonly adminRole: AdminRole;
  readonly expiresAt: string;
  readonly csrfToken: string;
}

/**
 * ok: the server answered with the expected success shape.
 * error: the server answered with an error envelope (or a bare 5xx); `code` is the backend code.
 * network: no usable answer at all (connection failed, aborted, unreadable or unexpected body). The request may or
 * may not have been executed by the server.
 */
export type ApiResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'error'; readonly status: number; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly kind: 'network' };

export interface TransportRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly csrf?: string;
}

export interface TransportResponse {
  readonly status: number;
  header(name: string): string | null;
  /** The parsed JSON body, or undefined when there is none or it is not JSON. */
  json(): Promise<unknown>;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** The browser transport: same-origin fetch, cookies included, never cached, no redirect followed. */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async (request) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    if (request.csrf !== undefined) {
      headers['x-csrf-token'] = request.csrf;
    }
    const response = await fetchImpl(`${API_BASE}${request.path}`, {
      method: request.method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    return {
      status: response.status,
      header: (name) => response.headers.get(name),
      json: async () => {
        const text = await response.text();
        if (text === '') {
          return undefined;
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return undefined;
        }
      },
    };
  };
}

const NEXT_STEPS: readonly string[] = ['ENROLL_TOTP', 'VERIFY_TOTP'];
const ROLES: readonly string[] = ['SYSTEM', 'ADMIN'];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Retry-After as whole seconds >= 1, or undefined when absent or not a plain positive integer. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^[0-9]{1,9}$/.test(header.trim())) {
    return undefined;
  }
  const seconds = Number(header.trim());
  return seconds >= 1 ? seconds : undefined;
}

export class AdminAuthApi {
  constructor(private readonly transport: Transport) {}

  state(): Promise<ApiResult<StateData>> {
    return this.#call({ method: 'GET', path: '/state' }, (data) => {
      const state = data.state;
      const expiresAt = str(data.expires_at);
      const csrfToken = str(data.csrf_token);
      if (expiresAt === undefined || csrfToken === undefined) {
        return undefined;
      }
      if (state === 'SESSION' && data.next_step === null) {
        return { state, expiresAt, csrfToken };
      }
      if (state === 'PREAUTH' && typeof data.next_step === 'string' && NEXT_STEPS.includes(data.next_step)) {
        return { state, nextStep: data.next_step as NextStep, expiresAt, csrfToken };
      }
      return undefined;
    });
  }

  login(phone: string, password: string, deviceId: string): Promise<ApiResult<LoginData>> {
    return this.#call(
      {
        method: 'POST',
        path: '/login',
        body: { phone, password, device: { device_id: deviceId, platform: 'WEB', app: 'ADMIN_WEB' } },
      },
      (data) => {
        const nextStep = data.next_step;
        const expiresAt = str(data.expires_at);
        const csrfToken = str(data.csrf_token);
        if (typeof nextStep !== 'string' || !NEXT_STEPS.includes(nextStep) || expiresAt === undefined || csrfToken === undefined) {
          return undefined;
        }
        return { nextStep: nextStep as NextStep, expiresAt, csrfToken };
      },
    );
  }

  startEnrollment(csrf: string): Promise<ApiResult<EnrollmentData>> {
    return this.#call({ method: 'POST', path: '/totp/enrollment', body: {}, csrf }, (data) => {
      const secret = str(data.secret);
      const otpauthUri = str(data.otpauth_uri);
      const expiresAt = str(data.expires_at);
      if (secret === undefined || otpauthUri === undefined || !otpauthUri.startsWith('otpauth://totp/') || expiresAt === undefined) {
        return undefined;
      }
      return { secret, otpauthUri, expiresAt };
    });
  }

  completeEnrollment(csrf: string, code: string): Promise<ApiResult<SessionData>> {
    return this.#call({ method: 'POST', path: '/totp/enrollment/verify', body: { code }, csrf }, sessionData);
  }

  verify(csrf: string, code: string): Promise<ApiResult<SessionData>> {
    return this.#call({ method: 'POST', path: '/totp/verify', body: { code }, csrf }, sessionData);
  }

  me(): Promise<ApiResult<SessionData>> {
    return this.#call({ method: 'GET', path: '/me' }, sessionData);
  }

  /** 204 is the only success. */
  async logout(csrf: string): Promise<ApiResult<null>> {
    let response: TransportResponse;
    try {
      response = await this.transport({ method: 'POST', path: '/logout', body: {}, csrf });
    } catch {
      return { kind: 'network' };
    }
    if (response.status === 204) {
      return { kind: 'ok', data: null };
    }
    return this.#error(response);
  }

  async #call<T>(request: TransportRequest, parse: (data: Record<string, unknown>) => T | undefined): Promise<ApiResult<T>> {
    let response: TransportResponse;
    try {
      response = await this.transport(request);
    } catch {
      return { kind: 'network' };
    }
    if (response.status === 200) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'network' };
      }
      const data = record(record(body)?.data);
      const parsed = data === undefined ? undefined : parse(data);
      return parsed === undefined ? { kind: 'network' } : { kind: 'ok', data: parsed };
    }
    return this.#error(response);
  }

  async #error(response: TransportResponse): Promise<ApiResult<never>> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const code = str(record(record(body)?.error)?.code);
    if (code === undefined) {
      // A bare 5xx (proxy down, gateway error) is the generic unavailable answer; anything else unexplained is unusable.
      return response.status >= 500 ? { kind: 'error', status: response.status, code: 'SERVICE_UNAVAILABLE' } : { kind: 'network' };
    }
    const retryAfterSeconds = response.status === 429 ? parseRetryAfter(response.header('retry-after')) : undefined;
    return retryAfterSeconds === undefined
      ? { kind: 'error', status: response.status, code }
      : { kind: 'error', status: response.status, code, retryAfterSeconds };
  }
}

function sessionData(data: Record<string, unknown>): SessionData | undefined {
  const userId = str(data.user_id);
  const adminRole = data.admin_role;
  const expiresAt = str(data.expires_at);
  const csrfToken = str(data.csrf_token);
  if (userId === undefined || typeof adminRole !== 'string' || !ROLES.includes(adminRole) || expiresAt === undefined || csrfToken === undefined) {
    return undefined;
  }
  return { userId, adminRole: adminRole as AdminRole, expiresAt, csrfToken };
}
