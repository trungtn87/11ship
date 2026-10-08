import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { fakeContext } from '../auth/auth-fakes.fixture';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentRequest, IdempotentResult } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { ShopOnboardingService } from './shop-onboarding-service';
import { ShopCompleteInput, ShopProfileInput } from './shop-onboarding-validation';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = '923e4567-e89b-42d3-a456-426614174000';
const ACTOR: SessionActor = { userId: USER_ID, sessionId: SESSION_ID };
const SHOP_ID = '623e4567-e89b-42d3-a456-426614174000';
const AREA_ID = '723e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const KEY = '123e4567-e89b-42d3-a456-426614174000';

const PROFILE: ShopProfileInput = {
  name: 'Quán A',
  contactPhoneNormalized: '+84987654321',
  zalo: null,
  facebook: null,
  addressText: '1 Phố B',
  pickupLat: 21,
  pickupLng: 105.8,
  serviceAreaId: AREA_ID,
  expectedVersion: null,
};

function shopRow(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    shopId: SHOP_ID,
    name: 'Quán A',
    contactPhoneNormalized: '+84987654321',
    zalo: null,
    facebook: null,
    addressText: '1 Phố B',
    pickupLat: 21,
    pickupLng: 105.8,
    serviceAreaId: AREA_ID,
    status: 'INCOMPLETE',
    acceptingOrders: false,
    version: 1,
    ...overrides,
  };
}

interface Rig {
  service: ShopOnboardingService;
  events: string[];
  requests: IdempotentRequest[];
  audits: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  /** Every actor the coordinator asked the session-authorization participant to lock and check. */
  authorized: SessionActor[];
  /** Set an error to make the NEXT authorization (a command or a replay hook) refuse. */
  gate: { error: AppError | undefined };
}

function rig(options: {
  shop?: ShopRow | undefined;
  area?: { serviceAreaId: string; status: 'ACTIVE' | 'INACTIVE' } | undefined;
  membershipInserted?: boolean;
  lockFailure?: AppError;
} = {}): Rig {
  const events: string[] = [];
  const requests: IdempotentRequest[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const shop = 'shop' in options ? options.shop : undefined;
  const area = 'area' in options ? options.area : { serviceAreaId: AREA_ID, status: 'ACTIVE' as const };

  const executor = {
    execute: async (request: IdempotentRequest, work: (context: TransactionContext) => Promise<IdempotentResult>) => {
      requests.push(request);
      events.push('executor');
      const result = await work(fakeContext(1, []));
      return { status: result.status, payload: result.payload, replayed: false, persisted: true };
    },
  } as unknown as IdempotencyExecutor;
  const authorized: SessionActor[] = [];
  const gate: { error: AppError | undefined } = { error: options.lockFailure };
  const sessionAuth = {
    lockAuthorizedActor: async (_c: unknown, actor: SessionActor) => {
      events.push('actor.authorize');
      authorized.push(actor);
      if (gate.error !== undefined) {
        throw gate.error;
      }
    },
  } as unknown as SessionAuthorizationParticipant;
  const roleGrants = {
    grant: async (_c: unknown, _u: string, role: string) => void events.push(`role.grant:${role}`),
  } as unknown as RoleGrantParticipant;
  const shops = {
    lockOwnedShop: async () => {
      events.push('shop.lock');
      return shop;
    },
    insertDraft: async () => void events.push('shop.insert'),
    insertOwnerMembership: async () => {
      events.push('member.insert');
      return options.membershipInserted ?? true;
    },
    updateDraft: async (_c: unknown, _s: string, expected: number) => {
      events.push('shop.update');
      return expected + 1;
    },
    activate: async (_c: unknown, _s: string, expected: number) => {
      events.push('shop.activate');
      return expected + 1;
    },
  } as unknown as ShopRepository;
  const serviceAreas = {
    lockShared: async () => {
      events.push('area.lock');
      return area;
    },
  } as unknown as ServiceAreaRepository;
  const audit = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('audit'), audits.push(entry)),
  } as unknown as AuditWriter;
  const outboxWriter = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('outbox'), outbox.push(entry)),
  } as unknown as OutboxWriter;

  return {
    service: new ShopOnboardingService(executor, sessionAuth, roleGrants, shops, serviceAreas, audit, outboxWriter),
    events,
    requests,
    audits,
    outbox,
    authorized,
    gate,
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

const save = (r: Rig, input: ShopProfileInput = PROFILE) => r.service.saveProfile(ACTOR, input, KEY, REQUEST_ID);
const complete = (r: Rig, input: ShopCompleteInput = { expectedVersion: 1 }) =>
  r.service.complete(ACTOR, input, KEY, REQUEST_ID);

describe('ShopOnboardingService.saveProfile', () => {
  it('create: user lock, owner lookup, service area (FOR SHARE), shop, membership, audit — in that order', async () => {
    const r = rig();
    const outcome = await save(r);
    expect(r.events).toEqual([
      'executor',
      'actor.authorize',
      'shop.lock',
      'area.lock',
      'shop.insert',
      'member.insert',
      'audit',
    ]);
    expect(outcome.status).toBe(201);
    expect(outcome.payload).toMatchObject({ status: 'INCOMPLETE', version: 1, role_granted: false });
    expect(r.outbox).toHaveLength(0); // the outbox event belongs to completion only
    expect(r.audits[0]).toMatchObject({
      action: 'onboarding.shop.profile.save.v1',
      resourceType: 'shop',
      outcome: 'SUCCESS',
      actorId: USER_ID,
      requestId: REQUEST_ID,
      metadata: { created: true },
    });
  });

  it('is scoped to the authenticated user under the locked operation id, with the normalized request', async () => {
    const r = rig();
    await save(r);
    expect(r.requests[0]).toMatchObject({
      scopeType: 'user',
      scopeId: USER_ID,
      operationId: 'onboarding.shop.profile.save.v1',
      idempotencyKey: KEY,
    });
    expect(r.requests[0]?.logicalRequest).toEqual({
      name: 'Quán A',
      contact_phone: '+84987654321',
      zalo: null,
      facebook: null,
      address_text: '1 Phố B',
      pickup_lat: 21,
      pickup_lng: 105.8,
      service_area_id: AREA_ID,
      expected_version: null,
    });
  });

  it('skips the service area lock when no area was supplied', async () => {
    const r = rig();
    await save(r, { ...PROFILE, serviceAreaId: null, pickupLat: null, pickupLng: null });
    expect(r.events).not.toContain('area.lock');
  });

  it('update: exact version required, 200, new version', async () => {
    const r = rig({ shop: shopRow({ version: 4 }) });
    const outcome = await save(r, { ...PROFILE, expectedVersion: 4 });
    expect(outcome.status).toBe(200);
    expect(outcome.payload).toMatchObject({ shop_id: SHOP_ID, version: 5 });
    expect(r.events).toContain('shop.update');
    expect(r.events).not.toContain('shop.insert');
    expect(r.audits[0]).toMatchObject({ metadata: { created: false }, resourceVersion: 5 });
  });

  it('refusals write nothing', async () => {
    const cases: Array<[string, Rig, ShopProfileInput, string]> = [
      ['create but a shop exists', rig({ shop: shopRow() }), PROFILE, 'SHOP_ONBOARDING_EXISTS'],
      ['expected_version but no draft', rig(), { ...PROFILE, expectedVersion: 1 }, 'VERSION_CONFLICT'],
      ['stale version', rig({ shop: shopRow({ version: 3 }) }), { ...PROFILE, expectedVersion: 2 }, 'VERSION_CONFLICT'],
      ['ACTIVE shop is immutable', rig({ shop: shopRow({ status: 'ACTIVE' }) }), { ...PROFILE, expectedVersion: 1 }, 'SHOP_ONBOARDING_EXISTS'],
      ['DISABLED shop is immutable', rig({ shop: shopRow({ status: 'DISABLED' }) }), { ...PROFILE, expectedVersion: 1 }, 'SHOP_ONBOARDING_EXISTS'],
      ['unknown area', rig({ area: undefined }), PROFILE, 'INVALID_SERVICE_AREA'],
      ['inactive area', rig({ area: { serviceAreaId: AREA_ID, status: 'INACTIVE' } }), PROFILE, 'INVALID_SERVICE_AREA'],
      ['membership conflict', rig({ membershipInserted: false }), PROFILE, 'SHOP_ONBOARDING_EXISTS'],
      ['disabled account', rig({ lockFailure: new AppError('ACCOUNT_DISABLED') }), PROFILE, 'ACCOUNT_DISABLED'],
    ];
    for (const [label, r, input, expected] of cases) {
      expect([label, await codeOf(() => save(r, input))]).toEqual([label, expected]);
      expect([label, r.audits.length, r.outbox.length]).toEqual([label, 0, 0]);
    }
  });
});

describe('ShopOnboardingService.complete', () => {
  it('locks user, owner, shop, area, activates, grants SHOP, audits and publishes shop.onboarded.v1', async () => {
    const r = rig({ shop: shopRow() });
    const outcome = await complete(r);
    expect(r.events).toEqual([
      'executor',
      'actor.authorize',
      'shop.lock',
      'area.lock',
      'shop.activate',
      'role.grant:SHOP',
      'audit',
      'outbox',
    ]);
    expect(outcome.status).toBe(200);
    expect(outcome.payload).toEqual({
      shop_id: SHOP_ID,
      status: 'ACTIVE',
      accepting_orders: false,
      role_granted: true,
      version: 2,
    });
    expect(r.requests[0]).toMatchObject({
      scopeType: 'user',
      scopeId: USER_ID,
      operationId: 'onboarding.shop.complete.v1',
      logicalRequest: { expected_version: 1 },
    });
    expect(r.audits[0]).toMatchObject({ action: 'onboarding.shop.complete.v1', resourceId: SHOP_ID, resourceVersion: 2 });
    expect(r.outbox[0]).toMatchObject({
      eventType: 'shop.onboarded.v1',
      eventSchemaVersion: 1,
      resourceType: 'shop',
      resourceId: SHOP_ID,
      payload: { shop_id: SHOP_ID, user_id: USER_ID },
    });
    expect(Object.keys(r.outbox[0]?.payload as object).sort()).toEqual(['shop_id', 'user_id']);
  });

  it('refusals write and grant nothing', async () => {
    const cases: Array<[string, Rig, ShopCompleteInput, string]> = [
      ['no shop', rig(), { expectedVersion: 1 }, 'SHOP_PROFILE_INCOMPLETE'],
      ['already ACTIVE', rig({ shop: shopRow({ status: 'ACTIVE', version: 2 }) }), { expectedVersion: 2 }, 'SHOP_ONBOARDING_EXISTS'],
      ['stale version', rig({ shop: shopRow({ version: 2 }) }), { expectedVersion: 1 }, 'VERSION_CONFLICT'],
      ['no GPS', rig({ shop: shopRow({ pickupLat: null, pickupLng: null }) }), { expectedVersion: 1 }, 'SHOP_PROFILE_INCOMPLETE'],
      ['no area', rig({ shop: shopRow({ serviceAreaId: null }) }), { expectedVersion: 1 }, 'SHOP_PROFILE_INCOMPLETE'],
      ['inactive area', rig({ shop: shopRow(), area: { serviceAreaId: AREA_ID, status: 'INACTIVE' } }), { expectedVersion: 1 }, 'INVALID_SERVICE_AREA'],
      ['vanished area', rig({ shop: shopRow(), area: undefined }), { expectedVersion: 1 }, 'INVALID_SERVICE_AREA'],
      ['disabled account', rig({ shop: shopRow(), lockFailure: new AppError('ACCOUNT_DISABLED') }), { expectedVersion: 1 }, 'ACCOUNT_DISABLED'],
    ];
    for (const [label, r, input, expected] of cases) {
      expect([label, await codeOf(() => complete(r, input))]).toEqual([label, expected]);
      expect(r.events.filter((event) => event.startsWith('role.grant') || event === 'shop.activate')).toEqual([]);
      expect([label, r.audits.length, r.outbox.length]).toEqual([label, 0, 0]);
    }
  });
});

describe('ShopOnboardingService session authorization (post-merge repair, section 1)', () => {
  it('save and complete authorize the server-authenticated user AND session first, before any business read', async () => {
    const created = rig();
    await save(created);
    expect(created.authorized).toEqual([ACTOR]);
    expect(created.events.slice(0, 2)).toEqual(['executor', 'actor.authorize']);

    const completed = rig({ shop: shopRow() });
    await complete(completed);
    expect(completed.authorized).toEqual([ACTOR]);
    expect(completed.events.slice(0, 2)).toEqual(['executor', 'actor.authorize']);
  });

  it('a revoked, expired or foreign session refuses the command before any business effect', async () => {
    for (const code of ['SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_INVALID', 'ACCOUNT_DISABLED'] as const) {
      const saved = rig({ lockFailure: new AppError(code) });
      expect([code, await codeOf(() => save(saved))]).toEqual([code, code]);
      expect(saved.events).toEqual(['executor', 'actor.authorize']);
      expect([saved.audits.length, saved.outbox.length]).toEqual([0, 0]);

      const completed = rig({ shop: shopRow(), lockFailure: new AppError(code) });
      expect([code, await codeOf(() => complete(completed))]).toEqual([code, code]);
      expect(completed.events).toEqual(['executor', 'actor.authorize']);
      expect([completed.audits.length, completed.outbox.length]).toEqual([0, 0]);
    }
  });

  it.each(['save', 'complete'] as const)(
    'the sensitive replay hook of %s runs the same authorization with the CURRENT session, before it allows anything',
    async (operation) => {
      const r = rig({ shop: shopRow() });
      await (operation === 'save' ? save(r) : complete(r));
      const replay = r.requests[0]?.replay;
      if (replay?.kind !== 'sensitive') {
        throw new Error('expected a sensitive replay policy');
      }

      r.events.length = 0;
      r.authorized.length = 0;
      await expect(replay.authorize(fakeContext(1, []), { user_id: USER_ID })).resolves.toBe(true);
      expect(r.events).toEqual(['actor.authorize']);
      expect(r.authorized).toEqual([ACTOR]);

      // A revoked or expired session is refused by the hook itself: the executor never reaches decryption.
      r.gate.error = new AppError('SESSION_REVOKED');
      const denied = await replay.authorize(fakeContext(1, []), { user_id: USER_ID }).catch((error: unknown) => error);
      expect(denied).toBeInstanceOf(AppError);
      expect((denied as AppError).code).toBe('SESSION_REVOKED');
    },
  );

  it('the replay guard names the user only: the session id is neither in the guard, the logical request nor the scope', async () => {
    const r = rig();
    await save(r);
    const request = r.requests[0];
    expect(request?.scopeId).toBe(USER_ID);
    expect(JSON.stringify(request?.logicalRequest)).not.toContain(SESSION_ID);
    const outcome = await r.service.saveProfile(ACTOR, PROFILE, KEY, REQUEST_ID);
    expect(JSON.stringify(outcome)).not.toContain(SESSION_ID);
  });

  it('a replay guard of another user is an internal error and never reaches the authorization', async () => {
    const r = rig();
    await save(r);
    const replay = r.requests[0]?.replay;
    if (replay?.kind !== 'sensitive') {
      throw new Error('expected a sensitive replay policy');
    }
    r.events.length = 0;
    const failure = await replay
      .authorize(fakeContext(1, []), { user_id: '123e4567-e89b-42d3-a456-426614174999' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(r.events).toEqual([]);
  });
});
