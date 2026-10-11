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
    for (const route of [{ name: 'invitations', status: 'EXPIRED' } as const, { name: 'invitation-new' } as const, { name: 'invitation-revoke', id: INVITATION_ID } as const]) {
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
