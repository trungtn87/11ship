import { describe, expect, it } from '@jest/globals';
import { JsonLogger } from '../logging/json-logger';
import {
  createRequestContextMiddleware,
  RequestWithContext,
  safeMethod,
} from './request-context.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const logs: string[] = [];
  const middleware = createRequestContextMiddleware(
    new JsonLogger((line) => {
      logs.push(line);
    }),
  );

  const headers: Record<string, string> = {};
  const finishListeners: Array<() => void> = [];
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    on(_event: 'finish', listener: () => void) {
      finishListeners.push(listener);
    },
  };

  return { logs, middleware, headers, finishListeners, response };
}

describe('request context middleware', () => {
  it('assigns a server-generated UUID and returns it as X-Request-ID', () => {
    const { middleware, headers, response } = setup();
    const request: RequestWithContext = { method: 'GET' };
    let called = false;

    middleware(request, response, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(request.requestId).toMatch(UUID);
    expect(headers['X-Request-ID']).toBe(request.requestId);
  });

  it('creates a different id for every request', () => {
    const first = setup();
    const second = setup();
    const a: RequestWithContext = { method: 'GET' };
    const b: RequestWithContext = { method: 'GET' };
    first.middleware(a, first.response, () => undefined);
    second.middleware(b, second.response, () => undefined);
    expect(a.requestId).not.toBe(b.requestId);
  });

  it('ignores an X-Request-ID supplied by the client and never logs it', () => {
    const { middleware, headers, finishListeners, response, logs } = setup();
    const attackerValue = 'attacker<script>alert(1)</script>';
    const request = {
      method: 'GET',
      headers: { 'x-request-id': attackerValue },
    } as RequestWithContext;

    middleware(request, response, () => undefined);
    finishListeners.forEach((listener) => listener());

    expect(headers['X-Request-ID']).toMatch(UUID);
    expect(headers['X-Request-ID']).not.toContain('attacker');
    expect(logs.join('\n')).not.toContain('attacker');
  });

  it('writes one access log line with whitelisted metadata only', () => {
    const { middleware, finishListeners, response, logs } = setup();
    const request: RequestWithContext = { method: 'GET' };
    response.statusCode = 404;

    middleware(request, response, () => undefined);
    finishListeners.forEach((listener) => listener());

    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
    expect(entry.event).toBe('request_completed');
    expect(entry.request_id).toBe(request.requestId);
    expect(entry.method).toBe('GET');
    expect(entry.status).toBe(404);
    expect(typeof entry.duration_ms).toBe('number');
    expect(Object.keys(entry).sort()).toEqual(
      ['duration_ms', 'event', 'level', 'method', 'request_id', 'status', 'time'].sort(),
    );
  });
});

describe('safeMethod', () => {
  it('passes well-known methods and collapses anything else to OTHER', () => {
    expect(safeMethod('GET')).toBe('GET');
    expect(safeMethod('DELETE')).toBe('DELETE');
    expect(safeMethod('FOO<script>')).toBe('OTHER');
    expect(safeMethod(undefined)).toBe('OTHER');
    expect(safeMethod(42)).toBe('OTHER');
  });
});
