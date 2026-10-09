// Shared helpers of the web client tests: a fake fetch that records every call and a tiny session.
import { createSession } from '../../apps/web/src/core/session.js';
import { createApiClient } from '../../apps/web/src/api/client.js';

export function jsonResponse(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

export const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

export function errorEnvelope(status, code, requestId = REQUEST_ID) {
  return jsonResponse(status, { error: { code, message: 'English server text, never shown', request_id: requestId, details: {} } });
}

export function makeClient(handler, { timeoutMs = 50, token = null } = {}) {
  const calls = [];
  const session = createSession();
  if (token !== null) session.setToken(token);
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  const api = createApiClient({ baseUrl: '', timeoutMs, session, fetchImpl });
  return { api, session, calls };
}
