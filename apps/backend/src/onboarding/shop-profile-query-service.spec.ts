import { describe, expect, it } from '@jest/globals';
import { fakeTransactions } from '../auth/auth-fakes.fixture';
import { AppError } from '../common/app-errors';
import { SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { ShopProfileQueryService } from './shop-profile-query-service';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = '423e4567-e89b-42d3-a456-426614174000';
const ACTOR = { userId: USER_ID, sessionId: SESSION_ID };
const SHOP_ID = '623e4567-e89b-42d3-a456-426614174000';
const AREA_ID = '723e4567-e89b-42d3-a456-426614174000';

function shopRow(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    shopId: SHOP_ID,
    name: 'Quán A',
    contactPhoneNormalized: '+84987654321',
    zalo: 'zalo.example',
    facebook: null,
    addressText: '1 Phố B',
    pickupLat: 21.0285,
    pickupLng: 105.8542,
    serviceAreaId: AREA_ID,
    status: 'INCOMPLETE',
    acceptingOrders: false,
    version: 3,
    ...overrides,
  };
}

function rig(shop: ShopRow | undefined, authorize: () => Promise<void> = async () => undefined) {
  const { manager, state } = fakeTransactions();
  const calls: Array<{ userId: string; inTransaction: boolean }> = [];
  const order: string[] = [];
  const shops = {
    findOwnedShop: async (_context: unknown, userId: string) => {
      order.push('read');
      calls.push({ userId, inTransaction: state.inTransaction });
      return shop;
    },
  } as unknown as ShopRepository;
  const sessionAuth = {
    lockAuthorizedActorShared: async () => {
      order.push('authorize');
      await authorize();
      return { activeRole: null, phoneVerificationStatus: 'VERIFIED' };
    },
  } as unknown as SessionAuthorizationParticipant;
  return { service: new ShopProfileQueryService(manager, shops, sessionAuth), calls, state, order };
}

describe('ShopProfileQueryService.ownedProfile (GET /v1/onboarding/shop/profile)', () => {
  it('a user without a shop gets null, from one read inside one transaction', async () => {
    const r = rig(undefined);
    expect(await r.service.ownedProfile(ACTOR)).toBeNull();
    expect(r.calls).toEqual([{ userId: USER_ID, inTransaction: true }]);
    expect(r.state.transactions).toBe(1);
  });

  it('returns the whole draft with its version, the contact phone in its stored normalized form', async () => {
    const r = rig(shopRow());
    expect(await r.service.ownedProfile(ACTOR)).toEqual({
      shop_id: SHOP_ID,
      name: 'Quán A',
      contact_phone: '+84987654321',
      zalo: 'zalo.example',
      facebook: null,
      address_text: '1 Phố B',
      pickup_lat: 21.0285,
      pickup_lng: 105.8542,
      service_area_id: AREA_ID,
      status: 'INCOMPLETE',
      accepting_orders: false,
      version: 3,
    });
    expect(r.calls).toHaveLength(1);
  });

  it('keeps unset optional fields as null (a draft saved without GPS and area)', async () => {
    const view = await rig(shopRow({ zalo: null, pickupLat: null, pickupLng: null, serviceAreaId: null, version: 1 })).service.ownedProfile(ACTOR);
    expect(view).toMatchObject({ zalo: null, facebook: null, pickup_lat: null, pickup_lng: null, service_area_id: null, version: 1 });
  });

  it('returns an ACTIVE and a DISABLED owned shop as they are', async () => {
    expect(await rig(shopRow({ status: 'ACTIVE', version: 4 })).service.ownedProfile(ACTOR)).toMatchObject({ status: 'ACTIVE', version: 4 });
    expect(await rig(shopRow({ status: 'DISABLED', version: 5 })).service.ownedProfile(ACTOR)).toMatchObject({ status: 'DISABLED', version: 5 });
  });

  it('has exactly the documented fields: no user id, no membership field, no audit or idempotency metadata', async () => {
    const view = await rig(shopRow()).service.ownedProfile(ACTOR);
    expect(Object.keys(view ?? {}).sort()).toEqual([
      'accepting_orders',
      'address_text',
      'contact_phone',
      'facebook',
      'name',
      'pickup_lat',
      'pickup_lng',
      'service_area_id',
      'shop_id',
      'status',
      'version',
      'zalo',
    ]);
    expect(JSON.stringify(view)).not.toContain(USER_ID);
  });

  it('re-authorizes the session inside the transaction BEFORE the shop is read, with no role requirement (a roleless draft owner reads)', async () => {
    const r = rig(shopRow());
    expect(await r.service.ownedProfile(ACTOR)).not.toBeNull();
    expect(r.order).toEqual(['authorize', 'read']);
  });

  it.each(['SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_INVALID', 'ACCOUNT_DISABLED'] as const)(
    'a session that stopped being valid after the guard (%s) is refused and the profile is never read',
    async (code) => {
      const r = rig(shopRow(), async () => {
        throw new AppError(code);
      });
      await expect(r.service.ownedProfile(ACTOR)).rejects.toMatchObject({ code });
      expect(r.order).toEqual(['authorize']);
      expect(r.calls).toEqual([]);
    },
  );
});
