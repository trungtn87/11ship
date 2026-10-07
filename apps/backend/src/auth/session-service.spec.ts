import { randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { fakeTransactions } from './auth-fakes.fixture';
import { SessionRepository, SessionView } from './session-repository';
import { bearerTokenFrom, SessionService } from './session-service';
import { digestToken, generateToken } from './tokens';

const VIEW: SessionView = {
  sessionId: '123e4567-e89b-42d3-a456-426614174000',
  userId: '223e4567-e89b-42d3-a456-426614174000',
  activeRole: null,
  revoked: false,
  expired: false,
  userStatus: 'ACTIVE',
  phoneNormalized: '+84987654321',
};

describe('bearerTokenFrom', () => {
  const { token } = generateToken();

  it('accepts exactly "Bearer <canonical token>" (scheme case-insensitive, one space)', () => {
    expect(bearerTokenFrom(`Bearer ${token}`)).toBe(token);
    expect(bearerTokenFrom(`bearer ${token}`)).toBe(token);
    expect(bearerTokenFrom(`BEARER ${token}`)).toBe(token);
  });

  it('refuses everything else', () => {
    const bad: Array<string | string[] | undefined> = [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      token,
      `Basic ${token}`,
      `Bearer  ${token}`,
      ` Bearer ${token}`,
      `Bearer ${token} `,
      `Bearer ${token}=`,
      `Bearer ${token}, Bearer ${token}`,
      `Bearer ${token.slice(1)}`,
      `Bearer ${token}A`,
      `Bearer ${randomBytes(32).toString('base64')}`,
      [`Bearer ${token}`],
      [`Bearer ${token}`, `Bearer ${token}`],
    ];
    for (const header of bad) {
      expect([JSON.stringify(header), bearerTokenFrom(header)]).toEqual([JSON.stringify(header), undefined]);
    }
  });
});

describe('SessionService.authenticate', () => {
  function serviceFor(view: SessionView | undefined) {
    const { manager } = fakeTransactions();
    const seen: string[] = [];
    const sessions = {
      findByDigest: async (_context: unknown, digest: string) => {
        seen.push(digest);
        return view;
      },
    } as unknown as SessionRepository;
    return { service: new SessionService(manager, sessions), seen };
  }

  async function codeOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      if (error instanceof AppError) {
        return error.code;
      }
      throw error;
    }
    return 'OK';
  }

  it('looks the session up by the SHA-256 digest of the token and returns the principal', async () => {
    const { token } = generateToken();
    const { service, seen } = serviceFor({ ...VIEW, activeRole: 'DRIVER' });
    const principal = await service.authenticate(`Bearer ${token}`);
    expect(seen).toEqual([digestToken(token)]);
    expect(principal).toEqual({
      userId: VIEW.userId,
      sessionId: VIEW.sessionId,
      activeRole: 'DRIVER',
      phoneNormalized: VIEW.phoneNormalized,
    });
  });

  it('a missing or malformed header never reaches the database', async () => {
    const { service, seen } = serviceFor(VIEW);
    expect(await codeOf(() => service.authenticate(undefined))).toBe('SESSION_INVALID');
    expect(await codeOf(() => service.authenticate('Bearer nope'))).toBe('SESSION_INVALID');
    expect(seen).toEqual([]);
  });

  it('an unknown token is SESSION_INVALID', async () => {
    const { token } = generateToken();
    expect(await codeOf(() => serviceFor(undefined).service.authenticate(`Bearer ${token}`))).toBe('SESSION_INVALID');
  });

  it('reports revoked, then expired, then disabled', async () => {
    const { token } = generateToken();
    const header = `Bearer ${token}`;
    expect(await codeOf(() => serviceFor({ ...VIEW, revoked: true }).service.authenticate(header))).toBe('SESSION_REVOKED');
    expect(await codeOf(() => serviceFor({ ...VIEW, expired: true }).service.authenticate(header))).toBe('SESSION_EXPIRED');
    expect(await codeOf(() => serviceFor({ ...VIEW, userStatus: 'DISABLED' }).service.authenticate(header))).toBe('ACCOUNT_DISABLED');
    expect(await codeOf(() => serviceFor({ ...VIEW, revoked: true, expired: true }).service.authenticate(header))).toBe('SESSION_REVOKED');
    expect(await codeOf(() => serviceFor({ ...VIEW, expired: true, userStatus: 'DISABLED' }).service.authenticate(header))).toBe('SESSION_EXPIRED');
  });
});
