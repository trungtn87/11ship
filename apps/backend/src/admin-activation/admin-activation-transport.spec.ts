import { describe, expect, it } from '@jest/globals';
import { activationTransportMiddleware } from './admin-activation.controller';

function harness(): {
  request: { headers: Record<string, string | string[] | undefined> };
  response: { headers: Map<string, string>; setHeader(n: string, v: string): void; removeHeader(n: string): void; writeHead: (...a: unknown[]) => unknown };
  written: unknown[][];
} {
  const headers = new Map<string, string>();
  const written: unknown[][] = [];
  return {
    request: { headers: { 'if-none-match': '*', 'if-modified-since': 'x', cookie: 'a=b' } },
    response: {
      headers,
      setHeader: (name, value) => void headers.set(name.toLowerCase(), value),
      removeHeader: (name) => void headers.delete(name.toLowerCase()),
      writeHead: (...args) => {
        written.push(args);
        return undefined;
      },
    },
    written,
  };
}

describe('activation transport middleware (contract 6.1)', () => {
  it('sets the no-store family, drops the conditional request headers and keeps the rest', () => {
    const { request, response } = harness();
    let called = false;
    activationTransportMiddleware(request, response, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(request.headers['if-none-match']).toBeUndefined();
    expect(request.headers['if-modified-since']).toBeUndefined();
    expect(request.headers.cookie).toBe('a=b');
  });

  it('strips a validator that the framework generates anyway just before the head is written', () => {
    const { request, response, written } = harness();
    activationTransportMiddleware(request, response, () => undefined);
    response.setHeader('ETag', 'W/"1"');
    response.setHeader('Last-Modified', 'x');
    response.writeHead(200);
    expect(response.headers.has('etag')).toBe(false);
    expect(response.headers.has('last-modified')).toBe(false);
    expect(written).toEqual([[200]]);
  });
});
