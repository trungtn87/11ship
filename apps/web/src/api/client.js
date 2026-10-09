// The only transport of the client (task FE0 section 5). One base URL (allowlisted by core/config.js), the bearer of
// the CURRENT session, JSON in and out, a timeout, and a typed result:
//   { ok: true,  status, data, requestId, stale }
//   { ok: false, kind: 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response', status?, code?, requestId?, stale }
// It never throws for a transport or HTTP problem, never retries a POST or PUT, and never logs a body, a header or a
// token. `stale` is true when the session generation moved while the request was in flight: the caller must then
// ignore the result (it belongs to an older login or role context).

const PATH = /^\/[A-Za-z0-9/_-]*$/;
const REQUEST_ID = /^[0-9A-Fa-f-]{36}$/;
const MAX_BODY_CHARS = 1_000_000;

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createApiClient({
  baseUrl,
  timeoutMs,
  session,
  fetchImpl = (...args) => globalThis.fetch(...args),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  async function request({ method, path, body, idempotencyKey, auth = true, signal }) {
    if (typeof path !== 'string' || !PATH.test(path) || path.includes('..') || path.includes('//')) {
      throw new Error('API_PATH_INVALID');
    }
    const generation = session.generation;
    const finish = (result) => ({ ...result, stale: session.generation !== generation });

    const headers = { Accept: 'application/json' };
    if (auth) {
      if (session.token === null) {
        // No token to send: behave as the server would for a missing bearer, without calling it.
        return finish({ ok: false, kind: 'http', status: 401, code: 'SESSION_INVALID', requestId: null });
      }
      headers.Authorization = `Bearer ${session.token}`;
    }
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimer(timer);
        return finish({ ok: false, kind: 'aborted', requestId: null });
      }
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const response = await fetchImpl(`${baseUrl}/v1${path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      const headerId = response.headers?.get?.('X-Request-ID') ?? null;
      const headerRequestId = headerId !== null && REQUEST_ID.test(headerId) ? headerId : null;
      const text = await response.text();
      if (text.length > MAX_BODY_CHARS) {
        return finish({ ok: false, kind: 'invalid_response', status: response.status, requestId: headerRequestId });
      }
      const parsed = parseJson(text);

      if (response.ok) {
        if (!parsed.ok || !isPlainObject(parsed.value) || !Object.hasOwn(parsed.value, 'data')) {
          return finish({ ok: false, kind: 'invalid_response', status: response.status, requestId: headerRequestId });
        }
        return finish({ ok: true, status: response.status, data: parsed.value.data, requestId: headerRequestId });
      }

      const error = parsed.ok && isPlainObject(parsed.value) ? parsed.value.error : undefined;
      if (isPlainObject(error) && typeof error.code === 'string' && error.code !== '') {
        const bodyId = typeof error.request_id === 'string' && REQUEST_ID.test(error.request_id) ? error.request_id : null;
        return finish({
          ok: false,
          kind: 'http',
          status: response.status,
          code: error.code.slice(0, 64),
          requestId: bodyId ?? headerRequestId,
        });
      }
      return finish({ ok: false, kind: 'invalid_response', status: response.status, requestId: headerRequestId });
    } catch {
      if (timedOut) {
        return finish({ ok: false, kind: 'timeout', requestId: null });
      }
      if (controller.signal.aborted) {
        return finish({ ok: false, kind: 'aborted', requestId: null });
      }
      return finish({ ok: false, kind: 'network', requestId: null });
    } finally {
      clearTimer(timer);
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  return { request };
}
