import { describe, expect, it, jest } from '@jest/globals';
import {
  CLIENT_AUTH_ROUTE_PREFIX,
  CLIENT_PROFILE_ROUTE_PREFIXES,
  clientAuthTransportMiddleware,
} from './client-auth-transport.middleware';

describe('clientAuthTransportMiddleware', () => {
  it('sets the no-store transport headers and continues', () => {
    const headers: Record<string, string> = {};
    const next = jest.fn();
    clientAuthTransportMiddleware({}, { setHeader: (name, value) => (headers[name] = value) }, next);
    expect(headers).toEqual({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses the client-auth prefix', () => {
    expect(CLIENT_AUTH_ROUTE_PREFIX).toBe('client-auth');
  });

  it('also covers exactly the own-profile routes (M01.05), the customer address book (M05) and the Shop onboarding service-area list, each as a whole-segment prefix', () => {
    expect([...CLIENT_PROFILE_ROUTE_PREFIXES]).toEqual(['customer/me/profile', 'customers/me', 'driver/me', 'onboarding/shop/service-areas']);
  });
});
