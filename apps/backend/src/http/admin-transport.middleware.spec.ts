import { describe, expect, it, jest } from '@jest/globals';
import { adminTransportMiddleware } from './admin-transport.middleware';

describe('adminTransportMiddleware', () => {
  it('sets exactly the four transport headers, touches nothing else and continues', () => {
    const headers: Record<string, string> = {};
    const next = jest.fn();
    const request = { headers: { origin: 'https://x', cookie: 'a=b' }, method: 'POST' };
    adminTransportMiddleware(request, { setHeader: (name: string, value: string) => (headers[name] = value) }, next);
    expect(headers).toEqual({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(next).toHaveBeenCalledTimes(1);
    // Origin, cookies and method (the Auth/Origin/CSRF inputs) are left exactly as received.
    expect(request).toEqual({ headers: { origin: 'https://x', cookie: 'a=b' }, method: 'POST' });
  });
});
