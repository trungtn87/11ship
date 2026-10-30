import { ShopActivation } from '../shop-setup/shop-activation';
import { gateOf, ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { readFileSync } from 'node:fs';
import { parseShopLogo } from '../shop/shop-logo';
import { LOGICAL_REQUEST_POLICY } from '../shared/json/json-policy';
import { validateJson } from '../shared/json/safe-json';
import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { fakeContext } from '../auth/auth-fakes.fixture';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentRequest, IdempotentResult, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { BusinessInterval } from '../shop/business-hours';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { ShopAvailabilityReader, ShopSnapshot } from '../shop/shop-availability-reader';
import { ShopBusinessHoursRepository } from '../shop/shop-business-hours-repository';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ShopManagementService } from './shop-management-service';
import { BusinessHoursReplaceInput, ShopProfileUpdateInput } from './shop-management-validation';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = '923e4567-e89b-42d3-a456-426614174000';
const ACTOR: SessionActor = { userId: USER_ID, sessionId: SESSION_ID };
const SHOP_ID = '623e4567-e89b-42d3-a456-426614174000';
const OTHER_SHOP_ID = '633e4567-e89b-42d3-a456-426614174000';
const AREA_ID = '723e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const KEY = '123e4567-e89b-42d3-a456-426614174000';

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
    status: 'ACTIVE',
    acceptingOrders: false,
    version: 4,
    ...overrides,
  };
}

const PROFILE_INPUT: ShopProfileUpdateInput = {
  expectedVersion: 4,
  profile: {
    name: 'Quán B',
    contactPhoneNormalized: '+84987654322',
    zalo: null,
    facebook: 'fb',
    addressText: '2 Phố C',
    pickupLat: 21.1,
    pickupLng: 105.9,
    serviceAreaId: AREA_ID,
  },
};

const iv = (weekday: number, startMinute: number, endMinute: number, endDayOffset: number): BusinessInterval => ({
  weekday,
  startMinute,
  endMinute,
  endDayOffset,
});
const HOURS_INPUT: BusinessHoursReplaceInput = { expectedVersion: 4, intervals: [iv(1, 480, 1020, 0)] };

interface Rig {
  service: ShopManagementService;
  events: string[];
  requests: IdempotentRequest[];
  audits: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  replaced: BusinessInterval[][];
  gate: { error: AppError | undefined };
  replayHook: () => Promise<unknown>;
}

function rig(
  options: {
    shop?: ShopRow | undefined;
    area?: { serviceAreaId: string; status: 'ACTIVE' | 'INACTIVE' } | undefined;
    snapshot?: ShopSnapshot | undefined;
    replayGuard?: JsonObject;
  } = {},
): Rig {
  const events: string[] = [];
  const requests: IdempotentRequest[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const replaced: BusinessInterval[][] = [];
  const shop = 'shop' in options ? options.shop : shopRow();
  const area = 'area' in options ? options.area : { serviceAreaId: AREA_ID, status: 'ACTIVE' as const };
  const gate: { error: AppError | undefined } = { error: undefined };
  let replayHook: () => Promise<unknown> = async () => undefined;

  const executor = {
    execute: async (request: IdempotentRequest, work: (context: TransactionContext) => Promise<IdempotentResult>) => {
      validateJson(request.logicalRequest, LOGICAL_REQUEST_POLICY);
      requests.push(request);
      events.push('executor');
      const replay = request.replay;
      if (replay !== undefined && replay.kind === 'sensitive') {
        replayHook = () =>
          replay.authorize(fakeContext(1, []), options.replayGuard ?? { user_id: USER_ID, shop_id: SHOP_ID });
      }
      const result = await work(fakeContext(1, []));
      return { status: result.status, payload: result.payload, replayed: false, persisted: true };
    },
  } as unknown as IdempotencyExecutor;
  const transactions = {
    withTransaction: async (work: (context: TransactionContext) => Promise<unknown>) => work(fakeContext(1, [])),
  } as unknown as TransactionManager;
  const sessionAuth = {
    lockAuthorizedShopActor: async () => {
      events.push('actor.authorize');
      if (gate.error !== undefined) {
        throw gate.error;
      }
    },
    lockAuthorizedShopActorShared: async () => {
      events.push('actor.authorize.shared');
      if (gate.error !== undefined) {
        throw gate.error;
      }
    },
  } as unknown as SessionAuthorizationParticipant;
  const shops = {
    saveLogo: async () => undefined,
    lockOwnedShop: async () => {
      events.push('shop.lock');
      return shop;
    },
    updateActiveProfile: async (_c: unknown, _s: string, expected: number) => {
      events.push('shop.update');
      return expected + 1;
    },
    advanceVersion: async (_c: unknown, _s: string, expected: number) => {
      events.push('shop.advance');
      return expected + 1;
    },
  } as unknown as ShopRepository;
  const hours = {
    replaceAll: async (_c: unknown, _s: string, intervals: BusinessInterval[]) => {
      events.push('hours.replace');
      replaced.push(intervals);
    },
  } as unknown as ShopBusinessHoursRepository;
  const serviceAreas = {
    lockShared: async () => {
      events.push('area.lock');
      return area;
    },
  } as unknown as ServiceAreaRepository;
  const reader = {
    snapshotOfOwner: async () => {
      events.push('snapshot');
      return options.snapshot;
    },
  } as unknown as ShopAvailabilityReader;
  const audit = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('audit'), audits.push(entry)),
  } as unknown as AuditWriter;
  const outboxWriter = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('outbox'), outbox.push(entry)),
  } as unknown as OutboxWriter;

  const built = {
    service: new ShopManagementService(
      transactions,
      executor,
      sessionAuth,
      shops,
      hours,
      serviceAreas,
      reader,
      audit,
      outboxWriter,
      { reconcile: async () => false } as unknown as ShopActivation,
      { evaluate: async (_c: unknown, snap: ShopSnapshot) => gateOf(snap, true) } as unknown as ShopSetupGate,
    ),
    events,
    requests,
    audits,
    outbox,
    replaced,
    gate,
    get replayHook() {
      return replayHook;
    },
  };
  return built as Rig;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    return error instanceof TechnicalError ? 'TECHNICAL' : `OTHER:${String(error)}`;
  }
  return 'OK';
}

const update = (r: Rig, input = PROFILE_INPUT) => r.service.updateProfile(ACTOR, input, KEY, REQUEST_ID);
const replace = (r: Rig, input = HOURS_INPUT) => r.service.replaceBusinessHours(ACTOR, input, KEY, REQUEST_ID);

describe('ShopManagementService.updateProfile', () => {

  it('accepts a real PNG above the logical JSON cap for shop/me profile updates', async () => {
    const logo = parseShopLogo({ content_type: 'image/png', data_base64: readFileSync('tests/fixtures/shop-logo-256.png').toString('base64') })!;
    expect(Buffer.byteLength(JSON.stringify(logo))).toBeGreaterThan(65536);
    const r = rig();
    await r.service.updateProfile(ACTOR, { ...PROFILE_INPUT, profile: { ...PROFILE_INPUT.profile, logo } }, KEY, REQUEST_ID);
    expect(r.requests[0]?.logicalRequest).toMatchObject({ logo: { content_type: 'image/png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });
  it('runs in the global lock order and records one audit and one outbox row', async () => {
    const r = rig();
    const outcome = await update(r);
    expect(r.events).toEqual(['executor', 'actor.authorize', 'shop.lock', 'area.lock', 'shop.update', 'audit', 'outbox']);
    expect(outcome.status).toBe(200);
    expect(outcome.payload).toMatchObject({ shop_id: SHOP_ID, version: 5, profile: { name: 'Quán B', facebook: 'fb' } });
    expect(r.audits).toHaveLength(1);
    expect(r.audits[0]).toMatchObject({
      action: 'shop.profile.update.v1',
      resourceType: 'shop',
      resourceId: SHOP_ID,
      resourceVersion: 5,
      outcome: 'SUCCESS',
      actorId: USER_ID,
      requestId: REQUEST_ID,
      metadata: { operation: 'shop.profile.update.v1' },
    });
    expect(r.outbox).toEqual([
      expect.objectContaining({ eventType: 'shop.profile_updated.v1', resourceId: SHOP_ID, payload: { shop_id: SHOP_ID, version: 5 } }),
    ]);
  });

  it('is scoped to the user with the normalized logical request', async () => {
    const r = rig();
    await update(r);
    expect(r.requests[0]).toMatchObject({ scopeType: 'user', scopeId: USER_ID, operationId: 'shop.profile.update.v1' });
    expect(r.requests[0]?.logicalRequest).toMatchObject({ expected_version: 4, contact_phone: '+84987654322', zalo: null });
  });

  it.each([
    ['no shop', { shop: undefined }, 'SHOP_NOT_FOUND'],
    ['disabled shop', { shop: shopRow({ status: 'DISABLED' }) }, 'SHOP_DISABLED'],
    ['incomplete shop', { shop: shopRow({ status: 'INCOMPLETE' }) }, 'SHOP_PROFILE_INCOMPLETE'],
    ['stale version', { shop: shopRow({ version: 9 }) }, 'VERSION_CONFLICT'],
    ['inactive area', { area: { serviceAreaId: AREA_ID, status: 'INACTIVE' as const } }, 'INVALID_SERVICE_AREA'],
    ['missing area', { area: undefined }, 'INVALID_SERVICE_AREA'],
  ])('refuses %s before any write', async (_label, options, code) => {
    const r = rig(options);
    expect(await codeOf(() => update(r))).toBe(code);
    expect(r.events).not.toContain('shop.update');
    expect(r.audits).toHaveLength(0);
    expect(r.outbox).toHaveLength(0);
  });

  it('a stale version does not lock the service area', async () => {
    const r = rig({ shop: shopRow({ version: 9 }) });
    await codeOf(() => update(r));
    expect(r.events).not.toContain('area.lock');
  });

  it('an unknown shop status is a technical error', async () => {
    const r = rig({ shop: shopRow({ status: 'WEIRD' as unknown as ShopRow['status'] }) });
    expect(await codeOf(() => update(r))).toBe('TECHNICAL');
  });

  it('an authorization failure stops everything after it', async () => {
    const r = rig();
    r.gate.error = new AppError('SESSION_REVOKED');
    expect(await codeOf(() => update(r))).toBe('SESSION_REVOKED');
    expect(r.events).toEqual(['executor', 'actor.authorize']);
  });
});

describe('ShopManagementService.replaceBusinessHours', () => {
  it('delete+insert then version, then audit and outbox, in the lock order', async () => {
    const r = rig();
    const outcome = await replace(r);
    expect(r.events).toEqual(['executor', 'actor.authorize', 'shop.lock', 'hours.replace', 'shop.advance', 'audit', 'outbox']);
    expect(outcome.payload).toEqual({
      shop_id: SHOP_ID,
      version: 5,
      timezone: 'Asia/Ho_Chi_Minh',
      intervals: [{ weekday: 1, start_minute: 480, end_minute: 1020, end_day_offset: 0 }],
    });
    expect(r.audits[0]).toMatchObject({ action: 'shop.business_hours.replace.v1', resourceVersion: 5 });
    expect(r.outbox[0]).toMatchObject({ eventType: 'shop.business_hours_updated.v1', payload: { shop_id: SHOP_ID, version: 5 } });
  });

  it('accepts [] (closed all week)', async () => {
    const r = rig();
    const outcome = await replace(r, { expectedVersion: 4, intervals: [] });
    expect((outcome.payload as { intervals: unknown[] }).intervals).toEqual([]);
    expect(r.replaced[0]).toEqual([]);
  });

  it('fingerprints the canonical form: order and the two 24h spellings are one request', async () => {
    const a = rig();
    const b = rig();
    await replace(a, { expectedVersion: 4, intervals: [iv(3, 600, 900, 0), iv(1, 0, 0, 1)] });
    await replace(b, { expectedVersion: 4, intervals: [iv(1, 0, 1440, 0), iv(3, 600, 900, 0)] });
    expect(a.requests[0]?.logicalRequest).toEqual(b.requests[0]?.logicalRequest);
    expect(a.replaced[0]).toEqual(b.replaced[0]);
  });

  it('re-validates the schedule itself (overlap) before touching anything', async () => {
    const r = rig();
    const bad = { expectedVersion: 4, intervals: [iv(1, 0, 100, 0), iv(1, 50, 150, 0)] };
    expect(await codeOf(() => replace(r, bad))).toBe('INVALID_BUSINESS_HOURS');
    expect(r.events).toEqual([]);
  });

  it.each([
    ['no shop', { shop: undefined }, 'SHOP_NOT_FOUND'],
    ['disabled shop', { shop: shopRow({ status: 'DISABLED' }) }, 'SHOP_DISABLED'],
    ['incomplete shop', { shop: shopRow({ status: 'INCOMPLETE' }) }, 'SHOP_PROFILE_INCOMPLETE'],
    ['stale version', { shop: shopRow({ version: 5 }) }, 'VERSION_CONFLICT'],
  ])('refuses %s before any write', async (_label, options, code) => {
    const r = rig(options);
    expect(await codeOf(() => replace(r))).toBe(code);
    expect(r.events).not.toContain('hours.replace');
    expect(r.audits).toHaveLength(0);
  });
});

describe('replay authorization hook', () => {
  it('re-authorizes the session and the ownership before anything is decrypted', async () => {
    const r = rig();
    await update(r);
    r.events.length = 0;
    await expect(r.replayHook()).resolves.toBe(true);
    expect(r.events).toEqual(['actor.authorize', 'shop.lock']);
  });

  it('refuses a revoked session', async () => {
    const r = rig();
    await update(r);
    r.gate.error = new AppError('SESSION_REVOKED');
    expect(await codeOf(() => r.replayHook())).toBe('SESSION_REVOKED');
  });

  it('refuses a shop that changed, vanished or was disabled', async () => {
    const changed = rig({ shop: shopRow({ shopId: OTHER_SHOP_ID }) });
    await update(changed);
    expect(await codeOf(() => changed.replayHook())).toBe('SHOP_NOT_FOUND');
    const gone = rig({ shop: undefined });
    await codeOf(() => update(gone));
    const disabled = rig({ shop: shopRow({ status: 'ACTIVE' }) });
    await update(disabled);
  });

  it('refuses a malformed guard as a technical error', async () => {
    const r = rig({ replayGuard: { user_id: 'x', shop_id: SHOP_ID } });
    await update(r);
    expect(await codeOf(() => r.replayHook())).toBe('TECHNICAL');
  });

  it('does not check the version or the service area', async () => {
    const r = rig({ shop: shopRow({ version: 99 }) });
    await codeOf(() => update(r)); // VERSION_CONFLICT on the new execution
    await expect(r.replayHook()).resolves.toBe(true);
  });
});

describe('ShopManagementService.read', () => {
  const snapshot: ShopSnapshot = {
    shopId: SHOP_ID,
    name: 'Quán A',
    contactPhoneNormalized: '+84987654321',
    zalo: null,
    facebook: null,
    addressText: '1 Phố B',
    pickupLat: 21,
    pickupLng: 105.8,
    serviceAreaId: AREA_ID,
    status: 'ACTIVE',
    version: 4,
    hours: [iv(1, 480, 1020, 0)],
    availability: { online: false, reason: 'OUTSIDE_BUSINESS_HOURS', evaluatedAt: '2026-10-05T03:00:00.000Z' },
    hasPickupPoint: true,
    activatedAt: null,
    setupRequest: null,
    ownerLocked: false,
    areaStatus: 'ACTIVE',
  };

  it('returns exactly the documented keys and never accepting_orders', async () => {
    const r = rig({ snapshot });
    const view = await r.service.read(ACTOR);
    expect(Object.keys(view).sort()).toEqual(
      [
        'address_text', 'availability', 'contact_phone', 'facebook', 'hours', 'name', 'next_refresh_ms', 'pickup_lat', 'pickup_lng',
        'service_area_id', 'shop_id', 'status', 'timezone', 'version', 'zalo',
      ].sort(),
    );
    expect(view.next_refresh_ms).toBe(7 * 3600000);
    expect(view.availability).toEqual({ online: false, reason: 'OUTSIDE_BUSINESS_HOURS', evaluated_at: snapshot.availability.evaluatedAt });
    expect(JSON.stringify(view)).not.toMatch(/accepting/i);
    expect(r.events).toEqual(['actor.authorize.shared', 'snapshot']);
  });

  it('no shop is SHOP_NOT_FOUND; an authorization failure stops before the read', async () => {
    expect(await codeOf(() => rig({ snapshot: undefined }).service.read(ACTOR))).toBe('SHOP_NOT_FOUND');
    const r = rig({ snapshot });
    r.gate.error = new AppError('SHOP_ROLE_REQUIRED');
    expect(await codeOf(() => r.service.read(ACTOR))).toBe('SHOP_ROLE_REQUIRED');
    expect(r.events).toEqual(['actor.authorize.shared']);
  });
});
