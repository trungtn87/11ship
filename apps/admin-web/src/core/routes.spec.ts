import { describe, expect, it } from '@jest/globals';
import { formatRoute, parseRoute, tokenFromFragment } from './routes';
import { INVITATION_ID, TOKEN } from './test-support';

describe('admin web routes', () => {
  it('parses and formats every route', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/activate')).toEqual({ name: 'activate' });
    expect(parseRoute('/invitations')).toEqual({ name: 'invitations' });
    expect(parseRoute('/invitations', '?status=PENDING')).toEqual({ name: 'invitations', status: 'PENDING' });
    expect(parseRoute('/invitations', '?status=BOGUS')).toEqual({ name: 'invitations' });
    expect(parseRoute('/invitations/new')).toEqual({ name: 'invitation-new' });
    expect(parseRoute(`/invitations/${INVITATION_ID}`)).toEqual({ name: 'invitation', id: INVITATION_ID });
    expect(parseRoute(`/invitations/${INVITATION_ID}/reissue/`)).toEqual({ name: 'invitation-reissue', id: INVITATION_ID });
    expect(parseRoute(`/invitations/${INVITATION_ID}/revoke`)).toEqual({ name: 'invitation-revoke', id: INVITATION_ID });
    expect(parseRoute('/invitations/not-a-uuid')).toEqual({ name: 'home' });
    expect(parseRoute('/reset')).toEqual({ name: 'reset' });
    expect(parseRoute('/accounts/users')).toEqual({ name: 'users' });
    expect(parseRoute('/accounts/users', '?status=LOCKED')).toEqual({ name: 'users', status: 'LOCKED' });
    expect(parseRoute('/accounts/users', '?status=ACTIVE')).toEqual({ name: 'users' });
    expect(parseRoute(`/accounts/users/${INVITATION_ID}/`)).toEqual({ name: 'user', id: INVITATION_ID });
    expect(parseRoute('/accounts/users/not-a-uuid')).toEqual({ name: 'home' });
    expect(parseRoute('/accounts/administrators')).toEqual({ name: 'administrators' });
    expect(parseRoute('/system/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('/system/parameters/otp')).toEqual({ name: 'otp-policy' });
    expect(parseRoute('/system/zones')).toEqual({ name: 'zones' });
    expect(parseRoute(`/system/zones/${INVITATION_ID}`)).toEqual({ name: 'zone', id: INVITATION_ID });
    expect(parseRoute('/system/zones/not-a-uuid')).toEqual({ name: 'home' });
    expect(formatRoute({ name: 'zones' })).toBe('/system/zones');
    expect(formatRoute({ name: 'zone', id: INVITATION_ID })).toBe(`/system/zones/${INVITATION_ID}`);
    expect(formatRoute({ name: 'otp-policy' })).toBe('/system/parameters/otp');
    expect(parseRoute('/catalog/categories')).toEqual({ name: 'categories' });
    expect(parseRoute('/catalog/categories/')).toEqual({ name: 'categories' });
    expect(parseRoute('/system/settings/')).toEqual({ name: 'settings' });
    expect(parseRoute('/system/other')).toEqual({ name: 'home' });
    for (const route of [{ name: 'invitations', status: 'EXPIRED' } as const, { name: 'invitation-new' } as const, { name: 'invitation-revoke', id: INVITATION_ID } as const, { name: 'users', status: 'LOCKED' } as const, { name: 'user', id: INVITATION_ID } as const, { name: 'administrators' } as const, { name: 'settings' } as const, { name: 'categories' } as const, { name: 'reset' } as const]) {
      expect(parseRoute(...(formatRoute(route).split(/(?=\?)/) as [string, string?]))).toEqual(route);
    }
  });

  it('parses and formats the M04 finance routes; a bad tab or id falls back, never to a blank page', () => {
    const topup = '3f1c2a10-0000-4000-8000-000000000001';
    expect(parseRoute('/finance')).toEqual({ name: 'finance' });
    expect(parseRoute('/finance/wallets/')).toEqual({ name: 'finance-wallets' });
    expect(parseRoute('/finance/topups')).toEqual({ name: 'finance-topups' });
    expect(parseRoute('/finance/topups', '?tab=DONE')).toEqual({ name: 'finance-topups', tab: 'DONE' });
    expect(parseRoute('/finance/topups', '?tab=BOGUS')).toEqual({ name: 'finance-topups' });
    expect(parseRoute(`/finance/topups/${topup}`)).toEqual({ name: 'finance-topup', id: topup });
    expect(parseRoute('/finance/topups/not-a-uuid')).toEqual({ name: 'home' });
    expect(parseRoute('/finance/withdrawals', '?tab=NEEDS_RECONCILE')).toEqual({ name: 'finance-withdrawals', tab: 'NEEDS_RECONCILE' });
    expect(parseRoute(`/finance/withdrawals/${topup}`)).toEqual({ name: 'finance-withdrawal', id: topup });
    expect(parseRoute('/finance/transactions')).toEqual({ name: 'finance-transactions' });
    expect(parseRoute('/finance/transactions', '?shipper=Nguy%E1%BB%85n%20V%C4%83n%20A')).toEqual({ name: 'finance-transactions', shipper: 'Nguyễn Văn A' });
    expect(parseRoute('/finance/reconciliation')).toEqual({ name: 'finance-reconciliation' });
    expect(parseRoute('/system/parameters/wallet')).toEqual({ name: 'wallet-params' });
    expect(parseRoute('/finance/other')).toEqual({ name: 'home' });
    for (const route of [
      { name: 'finance' } as const,
      { name: 'finance-wallets' } as const,
      { name: 'finance-topups', tab: 'ALL' } as const,
      { name: 'finance-topup', id: topup } as const,
      { name: 'finance-withdrawals', tab: 'PROCESSING' } as const,
      { name: 'finance-withdrawal', id: topup } as const,
      { name: 'finance-transactions', shipper: 'Nguyễn Văn A' } as const,
      { name: 'finance-reconciliation' } as const,
      { name: 'wallet-params' } as const,
    ]) {
      expect(parseRoute(...(formatRoute(route).split(/(?=\?)/) as [string, string?]))).toEqual(route);
    }
  });

  it('reads only a 43-character base64url fragment as the token', () => {
    expect(tokenFromFragment(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment('')).toBeUndefined();
    expect(tokenFromFragment(`#t=${TOKEN}x`)).toBeUndefined();
    expect(tokenFromFragment(`#t=${TOKEN.slice(1)}`)).toBeUndefined();
    expect(tokenFromFragment(`#token=${TOKEN}`)).toBeUndefined();
    expect(tokenFromFragment(`#t=${TOKEN.slice(0, 42)}!`)).toBeUndefined();
  });
});
