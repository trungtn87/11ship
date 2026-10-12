import { describe, expect, it } from '@jest/globals';
import { AuthPrincipal } from '../auth/auth-principal';
import { fakeTransactions } from '../auth/auth-fakes.fixture';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { ActiveServiceAreaRow, ServiceAreaRepository } from '../shop/service-area-repository';
import { ShopServiceAreaQueryService } from './shop-service-area-query-service';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = '423e4567-e89b-42d3-a456-426614174000';
const AREA_A = '723e4567-e89b-42d3-a456-426614174001';
const AREA_B = '723e4567-e89b-42d3-a456-426614174002';

const PRINCIPAL: AuthPrincipal = { userId: USER_ID, sessionId: SESSION_ID, activeRole: 'CUSTOMER', phoneNormalized: '+84987654321' };

function rig(options: { areas?: ActiveServiceAreaRow[]; hasCustomerRole?: boolean; authorityError?: AppError } = {}) {
  const { manager, state } = fakeTransactions();
  const events: string[] = [];
  const authority = {
    lock: async (_context: unknown, principal: AuthPrincipal, mode: string) => {
      events.push(`authority:${mode}:${state.inTransaction ? 'tx' : 'no-tx'}`);
      if (options.authorityError !== undefined) {
        throw options.authorityError;
      }
      return { userId: principal.userId, sessionId: principal.sessionId, app: 'FOOD', storedActiveRole: null, expiresAtMs: 0 };
    },
  } as unknown as ClientSessionAuthority;
  const users = {
    hasRole: async (_context: unknown, userId: string, role: string) => {
      events.push(`role:${role}:${userId}`);
      return options.hasCustomerRole ?? true;
    },
  } as unknown as UserRepository;
  const areas = {
    listActive: async () => {
      events.push('areas');
      return options.areas ?? [];
    },
  } as unknown as ServiceAreaRepository;
  return { service: new ShopServiceAreaQueryService(manager, authority, users, areas), events, state };
}

describe('ShopServiceAreaQueryService.activeChoices (GET /v1/onboarding/shop/service-areas)', () => {
  it('authorizes the caller (shared locks), requires CUSTOMER and then reads the areas, all in one transaction and in that order', async () => {
    const r = rig({ areas: [{ serviceAreaId: AREA_A, name: 'Khu A' }] });
    await r.service.activeChoices(PRINCIPAL);
    expect(r.events).toEqual(['authority:share:tx', `role:CUSTOMER:${USER_ID}`, 'areas']);
    expect(r.state.transactions).toBe(1);
  });

  it('answers exactly service_area_id and name, in the order the repository gave', async () => {
    const r = rig({
      areas: [
        { serviceAreaId: AREA_A, name: 'Khu A' },
        { serviceAreaId: AREA_B, name: 'Khu B' },
      ],
    });
    const choices = await r.service.activeChoices(PRINCIPAL);
    expect(choices).toEqual([
      { service_area_id: AREA_A, name: 'Khu A' },
      { service_area_id: AREA_B, name: 'Khu B' },
    ]);
    for (const choice of choices) {
      expect(Object.keys(choice).sort()).toEqual(['name', 'service_area_id']);
    }
  });

  it('an empty list is a successful empty answer, not an error', async () => {
    expect(await rig({ areas: [] }).service.activeChoices(PRINCIPAL)).toEqual([]);
  });

  it('refuses an account without the CUSTOMER role and reads no area', async () => {
    const r = rig({ hasCustomerRole: false, areas: [{ serviceAreaId: AREA_A, name: 'Khu A' }] });
    await expect(r.service.activeChoices(PRINCIPAL)).rejects.toMatchObject({ code: 'ROLE_NOT_AVAILABLE' });
    expect(r.events).not.toContain('areas');
  });

  it('a session the authority refuses is refused before any role or area read', async () => {
    const r = rig({ authorityError: new AppError('SESSION_REVOKED') });
    await expect(r.service.activeChoices(PRINCIPAL)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(r.events).toEqual(['authority:share:tx']);
  });
});
