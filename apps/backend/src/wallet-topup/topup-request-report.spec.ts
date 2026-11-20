import { describe, expect, it, jest } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { TopupRequestRow, TopupRequestState } from '../wallet/topup-request-repository';
import { TopupRequestService } from './topup-request-service';

// "Xác nhận đã chuyển tiền" (report) of a Shipper's own top-up request, with the real service and fake ports. Proves: only the owner, only
// while PENDING, a second report writes nothing, and the state and version never change (the settlement sees the same PENDING request).

const OWNER_USER = '11111111-1111-4111-8111-111111111111';
const DRIVER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const REPORTED_MS = Date.UTC(2026, 10, 20, 9, 30);
const CREATED_MS = Date.UTC(2026, 10, 20, 9, 0);

function row(overrides: Partial<TopupRequestRow> & { state?: TopupRequestState } = {}): TopupRequestRow {
  return {
    requestId: REQUEST,
    walletId: '44444444-4444-4444-8444-444444444444',
    driverId: DRIVER,
    amountRequestedVnd: 150000n,
    state: 'PENDING',
    version: 1,
    createdAtMs: CREATED_MS,
    resolvedAtMs: null,
    reportedAtMs: null,
    ...overrides,
  };
}

function harness(current: TopupRequestRow | undefined) {
  const requests = {
    lockOwned: jest.fn(async () => current),
    reportPending: jest.fn(async () => row({ reportedAtMs: REPORTED_MS })),
  };
  const audit = { append: jest.fn(async () => undefined) };
  const outbox = { append: jest.fn(async () => undefined) };
  const actor = { userId: OWNER_USER, sessionId: 's', app: 'SHIP', storedActiveRole: 'DRIVER', expiresAtMs: Date.now() + 60_000, platform: 'ANDROID', lockedDriverLimited: false };
  const authority = { lock: jest.fn(async () => actor) };
  const users = { hasRole: jest.fn(async () => true) };
  const drivers = { lockByUserId: jest.fn(async () => ({ driverId: DRIVER, userId: OWNER_USER, status: 'ACTIVE' })), findByUserId: jest.fn(async () => undefined) };
  const executor = {
    execute: jest.fn(async (_args: unknown, work: (context: unknown) => Promise<{ payload: unknown }>) => {
      const result = await work({});
      return { payload: result.payload };
    }),
  };
  const service = new TopupRequestService(
    {} as never,
    executor as never,
    authority as never,
    users as never,
    drivers as never,
    {} as never,
    requests as never,
    {} as never,
    audit as never,
    outbox as never,
  );
  const principal = { userId: OWNER_USER } as never;
  return { service, requests, audit, outbox, principal };
}

describe('Shipper top-up report (Xác nhận đã chuyển tiền)', () => {
  it('the owner reports a PENDING request once: reported_at is set, state and version stay, one audit line and one event', async () => {
    const h = harness(row());
    const payload = (await h.service.report(h.principal, REQUEST, 'key-1', 'req-1')) as Record<string, unknown>;
    expect(h.requests.reportPending).toHaveBeenCalledTimes(1);
    expect(h.audit.append).toHaveBeenCalledTimes(1);
    expect(h.outbox.append).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ request_id: REQUEST, state: 'PENDING', version: 1, reported_at: new Date(REPORTED_MS).toISOString() });
  });

  it('a second report answers the current request and writes nothing: no new reported_at, no audit line, no event', async () => {
    const h = harness(row({ reportedAtMs: REPORTED_MS }));
    const payload = (await h.service.report(h.principal, REQUEST, 'key-2', 'req-2')) as Record<string, unknown>;
    expect(h.requests.reportPending).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
    expect(h.outbox.append).not.toHaveBeenCalled();
    expect(payload).toMatchObject({ state: 'PENDING', version: 1, reported_at: new Date(REPORTED_MS).toISOString() });
  });

  it('a request that is not the owner’s (or does not exist) is not found, and nothing is written', async () => {
    const h = harness(undefined);
    await expect(h.service.report(h.principal, REQUEST, 'key-3', 'req-3')).rejects.toMatchObject({ code: 'TOPUP_REQUEST_NOT_FOUND' });
    expect(h.requests.reportPending).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
  });

  it.each<TopupRequestState>(['CONFIRMED', 'REJECTED', 'CANCELLED'])('a %s request refuses the report with a clear state conflict and writes nothing', async (state) => {
    const h = harness(row({ state, version: 2, resolvedAtMs: CREATED_MS + 1000 }));
    const failure = await h.service.report(h.principal, REQUEST, 'key-4', 'req-4').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('TOPUP_REQUEST_STATE_CONFLICT');
    expect(h.requests.reportPending).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
  });
});
