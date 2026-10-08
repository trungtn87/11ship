import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { fakeContext } from '../auth/auth-fakes.fixture';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { AppError } from '../common/app-errors';
import { DriverRepository, DriverRow, NewDriverFields } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentRequest, IdempotentResult } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverOnboardingService } from './driver-onboarding-service';
import { DriverOnboardingInput } from './driver-onboarding-validation';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const DRIVER_ID = '623e4567-e89b-42d3-a456-426614174000';
const AREA_A = '123e4567-e89b-42d3-a456-426614174001';
const AREA_B = '123e4567-e89b-42d3-a456-426614174002';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const KEY = '923e4567-e89b-42d3-a456-426614174000';

const INPUT: DriverOnboardingInput = { fullName: 'Nguyễn Văn A', plateNumber: '11B1-12345', serviceAreaIds: [AREA_A, AREA_B] };

function driverRow(overrides: Partial<DriverRow> = {}): DriverRow {
  return {
    driverId: DRIVER_ID,
    userId: USER_ID,
    fullName: 'Existing',
    plateNumber: null,
    driverType: 'EXTERNAL',
    status: 'PENDING',
    acceptingDeliveries: false,
    version: 1,
    ...overrides,
  };
}

interface Rig {
  service: DriverOnboardingService;
  events: string[];
  requests: IdempotentRequest[];
  audits: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  inserted: NewDriverFields[];
  areaRows: Array<{ driverId: string; ids: readonly string[] }>;
  lockedAreas: string[];
}

function rig(
  options: {
    existing?: DriverRow | undefined;
    areas?: Record<string, 'ACTIVE' | 'INACTIVE' | undefined>;
    insertConflict?: boolean;
    lockFailure?: AppError;
  } = {},
): Rig {
  const events: string[] = [];
  const requests: IdempotentRequest[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const inserted: NewDriverFields[] = [];
  const areaRows: Array<{ driverId: string; ids: readonly string[] }> = [];
  const lockedAreas: string[] = [];
  const existing = 'existing' in options ? options.existing : undefined;
  const areas = options.areas ?? { [AREA_A]: 'ACTIVE', [AREA_B]: 'ACTIVE' };

  const executor = {
    execute: async (request: IdempotentRequest, work: (context: TransactionContext) => Promise<IdempotentResult>) => {
      requests.push(request);
      events.push('executor');
      const result = await work(fakeContext(1, []));
      return { status: result.status, payload: result.payload, replayed: false, persisted: true };
    },
  } as unknown as IdempotencyExecutor;
  const roleGrants = {
    lockActiveUser: async () => {
      events.push('user.lock');
      if (options.lockFailure !== undefined) {
        throw options.lockFailure;
      }
    },
    grant: async (_c: unknown, _u: string, role: string) => void events.push(`role.grant:${role}`),
  } as unknown as RoleGrantParticipant;
  const drivers = {
    lockByUserId: async () => {
      events.push('driver.lock');
      return existing;
    },
    insertPending: async (_c: unknown, fields: NewDriverFields) => {
      events.push('driver.insert');
      inserted.push(fields);
      return !(options.insertConflict ?? false);
    },
    insertServiceAreas: async (_c: unknown, driverId: string, ids: readonly string[]) => {
      events.push('areas.insert');
      areaRows.push({ driverId, ids });
    },
  } as unknown as DriverRepository;
  const serviceAreas = {
    lockShared: async (_c: unknown, id: string) => {
      events.push('area.lock');
      lockedAreas.push(id);
      const status = areas[id];
      return status === undefined ? undefined : { serviceAreaId: id, status };
    },
  } as unknown as ServiceAreaRepository;
  const audit = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('audit'), audits.push(entry)),
  } as unknown as AuditWriter;
  const outboxWriter = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('outbox'), outbox.push(entry)),
  } as unknown as OutboxWriter;

  return {
    service: new DriverOnboardingService(executor, roleGrants, drivers, serviceAreas, audit, outboxWriter),
    events,
    requests,
    audits,
    outbox,
    inserted,
    areaRows,
    lockedAreas,
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

const create = (r: Rig, input: DriverOnboardingInput = INPUT) => r.service.create(USER_ID, input, KEY, REQUEST_ID);

describe('DriverOnboardingService.create (A03-26)', () => {
  it('runs in the A2 lock order: user, existing driver, areas (sorted), driver, areas, role, audit, outbox', async () => {
    const r = rig();
    const outcome = await create(r);
    expect(r.events).toEqual([
      'executor',
      'user.lock',
      'driver.lock',
      'area.lock',
      'area.lock',
      'driver.insert',
      'areas.insert',
      'role.grant:DRIVER',
      'audit',
      'outbox',
    ]);
    expect(outcome.status).toBe(201);
    expect(outcome.replayed).toBe(false);
    expect(r.lockedAreas).toEqual([AREA_A, AREA_B]);
  });

  it('answers with exactly the contract payload: EXTERNAL, PENDING, not accepting, role granted, version 1', async () => {
    const outcome = await create(rig());
    expect(outcome.payload).toEqual({
      driver_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      driver_type: 'EXTERNAL',
      status: 'PENDING',
      accepting_deliveries: false,
      role_granted: true,
      version: 1,
    });
    expect(Object.keys(outcome.payload as object).sort()).toEqual([
      'accepting_deliveries',
      'driver_id',
      'driver_type',
      'role_granted',
      'status',
      'version',
    ]);
  });

  it('hands M03 only the validated identity fields: the type, status and flags are not parameters of the insert', async () => {
    const r = rig();
    await create(r);
    expect(r.inserted).toHaveLength(1);
    expect(Object.keys(r.inserted[0] as object).sort()).toEqual(['driverId', 'fullName', 'plateNumber', 'userId']);
    expect(r.inserted[0]).toMatchObject({ userId: USER_ID, fullName: 'Nguyễn Văn A', plateNumber: '11B1-12345' });
    expect(r.areaRows).toEqual([{ driverId: r.inserted[0]?.driverId, ids: [AREA_A, AREA_B] }]);
  });

  it('is scoped to the authenticated user under the locked operation id, with the normalized request', async () => {
    const r = rig();
    await create(r);
    expect(r.requests[0]).toMatchObject({
      scopeType: 'user',
      scopeId: USER_ID,
      operationId: 'onboarding.driver.create.v1',
      idempotencyKey: KEY,
      logicalRequest: { full_name: 'Nguyễn Văn A', plate_number: '11B1-12345', service_area_ids: [AREA_A, AREA_B] },
    });
    expect(r.requests[0]?.replay.kind).toBe('sensitive');
  });

  it('a missing plate number is the same logical request as null', async () => {
    const r = rig();
    await create(r, { ...INPUT, plateNumber: null });
    expect((r.requests[0]?.logicalRequest as Record<string, unknown>).plate_number).toBeNull();
    expect(r.inserted[0]?.plateNumber).toBeNull();
  });

  it('audits driver.create and publishes driver.onboarded.v1 with exactly {driver_id,user_id}', async () => {
    const r = rig();
    await create(r);
    const driverId = r.inserted[0]?.driverId;
    expect(r.audits[0]).toMatchObject({
      action: 'onboarding.driver.create.v1',
      actorType: 'USER',
      actorId: USER_ID,
      requestId: REQUEST_ID,
      resourceType: 'driver',
      resourceId: driverId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { role: 'DRIVER' },
    });
    expect(r.outbox[0]).toMatchObject({
      eventType: 'driver.onboarded.v1',
      eventSchemaVersion: 1,
      resourceType: 'driver',
      resourceId: driverId,
      resourceVersion: 1,
      payload: { driver_id: driverId, user_id: USER_ID },
    });
    expect(Object.keys(r.outbox[0]?.payload as object).sort()).toEqual(['driver_id', 'user_id']);
  });

  it('puts nothing the client typed into the audit row or the event', async () => {
    const r = rig();
    await create(r);
    const written = JSON.stringify([r.audits, r.outbox]);
    for (const secret of ['Nguyễn Văn A', '11B1-12345', AREA_A, AREA_B, KEY]) {
      expect([secret, written.includes(secret)]).toEqual([secret, false]);
    }
  });
});

describe('DriverOnboardingService.create refusals (A03-29)', () => {
  const none = (r: Rig) => [r.audits.length, r.outbox.length, r.inserted.length, r.areaRows.length];

  it('a user who already has a Driver profile gets DRIVER_PROFILE_EXISTS in every status, before any area is locked', async () => {
    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'] as const) {
      const r = rig({ existing: driverRow({ status }) });
      expect([status, await codeOf(() => create(r))]).toEqual([status, 'DRIVER_PROFILE_EXISTS']);
      expect(r.events).toEqual(['executor', 'user.lock', 'driver.lock']);
      expect(none(r)).toEqual([0, 0, 0, 0]);
    }
  });

  it('an unknown or inactive area is INVALID_SERVICE_AREA and writes nothing, grants no role', async () => {
    const cases: Array<[string, Record<string, 'ACTIVE' | 'INACTIVE' | undefined>]> = [
      ['first unknown', { [AREA_B]: 'ACTIVE' }],
      ['second unknown', { [AREA_A]: 'ACTIVE' }],
      ['first inactive', { [AREA_A]: 'INACTIVE', [AREA_B]: 'ACTIVE' }],
      ['second inactive', { [AREA_A]: 'ACTIVE', [AREA_B]: 'INACTIVE' }],
      ['all inactive', { [AREA_A]: 'INACTIVE', [AREA_B]: 'INACTIVE' }],
    ];
    for (const [label, areas] of cases) {
      const r = rig({ areas });
      expect([label, await codeOf(() => create(r))]).toEqual([label, 'INVALID_SERVICE_AREA']);
      expect([label, none(r)]).toEqual([label, [0, 0, 0, 0]]);
      expect(r.events.filter((event) => event.startsWith('role.grant'))).toEqual([]);
    }
  });

  it('a unique-violation on insert (only reachable without the user lock) is DRIVER_PROFILE_EXISTS and grants nothing', async () => {
    const r = rig({ insertConflict: true });
    expect(await codeOf(() => create(r))).toBe('DRIVER_PROFILE_EXISTS');
    expect(r.events).not.toContain('areas.insert');
    expect(r.events.filter((event) => event.startsWith('role.grant'))).toEqual([]);
    expect([r.audits.length, r.outbox.length]).toEqual([0, 0]);
  });

  it('a disabled account is refused at the user lock, before anything else is read', async () => {
    const r = rig({ lockFailure: new AppError('ACCOUNT_DISABLED') });
    expect(await codeOf(() => create(r))).toBe('ACCOUNT_DISABLED');
    expect(r.events).toEqual(['executor', 'user.lock']);
  });
});

describe('DriverOnboardingService boundaries', () => {
  it('only the Driver repository writes the Driver; the service names no SQL and passes no type, status or flag', () => {
    const code = sourceOf('onboarding/driver-onboarding-service.ts');
    expect(code).not.toMatch(/\.query\(|INSERT|UPDATE|SELECT/);
    // The shape of the new driver is M03's statement; the coordinator never passes a type, status or flag.
    expect(code).not.toMatch(/driverType|acceptingDeliveries/);
    expect(code.split('this.executor.execute(').length - 1).toBe(1);
  });
});
