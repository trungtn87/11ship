import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { AdminTopupService } from '../admin-topups/admin-topup-service';
import { OutboxEventInput } from '../outbox/outbox-event';
import { OutboxPublishEvent } from '../outbox/outbox-publisher';
import { API_KEY, buildService, CODE, DRIVER_ID, freshStore, NOW, REQUEST_ID, SECRET, WALLET_ID } from '../sepay/sepay-test-harness';
import { TransactionContext } from '../transaction/transaction-context';
import { NotificationEventService } from './notification-event-service';
import { DEFAULT_CONFIG, NewNotification } from './notification-repository';

const DRIVER_USER_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_USER_ID = '55555555-5555-4555-8555-555555555555';
const BANK_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';

function toPublishEvent(event: OutboxEventInput): OutboxPublishEvent {
  return {
    eventId: randomUUID(),
    eventType: event.eventType,
    eventSchemaVersion: event.eventSchemaVersion,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    resourceVersion: event.resourceVersion,
    occurredAt: new Date().toISOString(),
    payload: event.payload,
    attemptCount: 1,
  };
}

function createNotificationHarness(getFacts: (requestId: string) => { userId: string; actualAmountVnd: bigint | null } | undefined) {
  const claimed = new Set<string>();
  const dedupeKeys = new Set<string>();
  const notifications: NewNotification[] = [];
  const queuedPushes: unknown[] = [];

  const service = new NotificationEventService(
    { withTransaction: async <T>(work: (c: TransactionContext) => Promise<T>) => work({} as TransactionContext) } as never,
    {
      readConfig: async () => DEFAULT_CONFIG,
      claimEvent: async (_c: unknown, eventId: string) => {
        if (claimed.has(eventId)) return false;
        claimed.add(eventId);
        return true;
      },
      hasNoticeOfFamily: async () => false,
      insertNotification: async (_c: unknown, n: NewNotification) => {
        const key = `${n.recipientUserId}|${n.app}|${n.dedupeKey}`;
        if (dedupeKeys.has(key)) {
          return { notificationId: n.notificationId, created: false };
        }
        dedupeKeys.add(key);
        notifications.push(n);
        return { notificationId: n.notificationId, created: true };
      },
    } as never,
    {
      topupFacts: async (_c: unknown, requestId: string) => getFacts(requestId),
    } as never,
    {} as never,
    {} as never,
    {
      queue: async (_c: unknown, input: unknown) => {
        queuedPushes.push(input);
      },
    } as never,
    {} as never,
    {} as never,
  );

  return { service, notifications, queuedPushes };
}

function sepayWebhookBody(transferAmount: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: 92704,
      gateway: 'MBBank',
      transactionDate: '2026-11-25 10:00:00',
      accountNumber: '0123456789',
      subAccount: '',
      code: CODE,
      content: `${CODE} nap vi`,
      transferType: 'in',
      description: '',
      transferAmount,
      accumulated: 0,
      referenceCode: 'FT2611250001',
    }),
    'utf8',
  );
}

function buildAdminTopupHarness(initialAmountRequestedVnd = 100000n) {
  let state: 'PENDING' | 'CONFIRMED' | 'REJECTED' = 'PENDING';
  let version = 1;
  let actualAmountVnd: bigint | null = null;
  const outboxEvents: OutboxEventInput[] = [];
  const context = {
    query: async (sql: string) => {
      if (sql.includes('clock_timestamp')) {
        return { rows: [{ now_ms: String(Date.now()) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as TransactionContext;

  const service = new AdminTopupService(
    { withTransaction: async <T>(work: (c: TransactionContext) => Promise<T>) => work(context) } as never,
    { execute: async (_opts: unknown, work: (c: TransactionContext) => Promise<unknown>) => ({ status: 200, replayed: false, body: await work(context) }) } as never,
    {
      precheck: async () => ({ userId: ADMIN_USER_ID, sessionId: 'sess-1' }),
      lock: async () => ({ known: { userId: ADMIN_USER_ID, sessionId: 'sess-1' }, checked: { membership: { adminRole: 'ADMIN' } } }),
    } as never,
    { require: async () => undefined } as never,
    { lockById: async () => ({ driverId: DRIVER_ID, status: 'ACTIVE' }) } as never,
    {
      findById: async () => ({ requestId: REQUEST_ID, walletId: WALLET_ID, driverId: DRIVER_ID, amountRequestedVnd: initialAmountRequestedVnd, state, version, createdAtMs: 1000, resolvedAtMs: null, reportedAtMs: null }),
      lockById: async () => ({ requestId: REQUEST_ID, walletId: WALLET_ID, driverId: DRIVER_ID, amountRequestedVnd: initialAmountRequestedVnd, state, version, createdAtMs: 1000, resolvedAtMs: null, reportedAtMs: null }),
      resolve: async (_c: unknown, requestId: string, expectedVersion: number, nextState: 'CONFIRMED' | 'REJECTED') => {
        if (state !== 'PENDING' || version !== expectedVersion) return undefined;
        state = nextState;
        version += 1;
        return { requestId, walletId: WALLET_ID, driverId: DRIVER_ID, amountRequestedVnd: initialAmountRequestedVnd, state, version, createdAtMs: 1000, resolvedAtMs: 2000, reportedAtMs: null };
      },
      findForAdmin: async () => ({ requestId: REQUEST_ID, walletId: WALLET_ID, driverId: DRIVER_ID, amountRequestedVnd: initialAmountRequestedVnd, state, version, createdAtMs: 1000, resolvedAtMs: 2000, reportedAtMs: null, actualAmountVnd, receivedAtMs: 2000 }),
    } as never,
    {
      lockWalletOf: async () => true,
      creditTopup: async (_c: unknown, input: { actualAmountVnd: bigint }) => {
        actualAmountVnd = input.actualAmountVnd;
        return { topupId: 'topup-1', sequenceNo: 1, balanceAfterVnd: input.actualAmountVnd };
      },
    } as never,
    { accountNumberOf: async () => undefined } as never,
    { append: async () => undefined } as never,
    {
      append: async (_c: unknown, event: OutboxEventInput) => {
        outboxEvents.push(event);
        return randomUUID();
      },
    } as never,
    { linkManualConfirmation: async () => undefined } as never,
    { idempotency: { businessLockTimeoutMs: 5000 } } as never,
  );

  return { service, outboxEvents, getActualAmountVnd: () => actualAmountVnd };
}

describe('M08 top-up credit notifications (SePay and Admin branches)', () => {
  it('SePay automatic credit emits wallet.topup_request.changed.v1 and creates "Đã nạp 100.000đ vào ví" notification + push', async () => {
    const store = freshStore({ requestAmount: 100000n });
    const { service: webhookService } = buildService(store);
    const raw = sepayWebhookBody(100000);
    const timestamp = String(NOW);
    const signature = `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`;

    const res = await webhookService.receive({
      rawBody: raw,
      timestampHeader: timestamp,
      signatureHeader: signature,
      nowSeconds: NOW,
      env: { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv,
    });

    expect(res).toEqual({ status: 200, body: { success: true } });
    expect(store.outboxEvents).toHaveLength(1);
    expect(store.outboxEvents[0]).toMatchObject({
      eventType: 'wallet.topup_request.changed.v1',
      resourceType: 'wallet_topup_request',
      resourceId: REQUEST_ID,
      payload: { request_id: REQUEST_ID, state: 'CONFIRMED', version: 2, actual_amount_vnd: 100000 },
    });

    const harness = createNotificationHarness((id) => (id === REQUEST_ID ? { userId: DRIVER_USER_ID, actualAmountVnd: 100000n } : undefined));
    await harness.service.consume(toPublishEvent(store.outboxEvents[0]!));

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0]).toMatchObject({
      recipientUserId: DRIVER_USER_ID,
      app: 'SHIP',
      kind: 'TOPUP_CONFIRMED',
      category: 'WALLET_PROFILE',
      title: 'Nạp tiền thành công',
      body: 'Đã nạp 100.000đ vào ví',
      targetType: 'WALLET_TXN',
      targetId: REQUEST_ID,
      dedupeKey: `topup:${REQUEST_ID}:CONFIRMED:2`,
    });
    expect(harness.queuedPushes).toHaveLength(1);
  });

  it('SePay held transfer or rolled-back credit emits no outbox event and creates no notification', async () => {
    const heldStore = freshStore({ requestAmount: 100000n });
    const rawMismatch = sepayWebhookBody(99000);
    const timestamp = String(NOW);
    const signatureMismatch = `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(rawMismatch).digest('hex')}`;
    await buildService(heldStore).service.receive({
      rawBody: rawMismatch,
      timestampHeader: timestamp,
      signatureHeader: signatureMismatch,
      nowSeconds: NOW,
      env: { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv,
    });
    expect(heldStore.outboxEvents).toHaveLength(0);

    const failStore = freshStore({ requestAmount: 100000n, creditError: new Error('db failure') });
    const rawOk = sepayWebhookBody(100000);
    const signatureOk = `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(rawOk).digest('hex')}`;
    await expect(
      buildService(failStore).service.receive({
        rawBody: rawOk,
        timestampHeader: timestamp,
        signatureHeader: signatureOk,
        nowSeconds: NOW,
        env: { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow('db failure');
    expect(failStore.outboxEvents).toHaveLength(0);
  });

  it('Admin confirmation emits wallet.topup_request.changed.v1 and creates "Đã nạp 100.000đ vào ví" notification + push', async () => {
    const admin = buildAdminTopupHarness(100000n);
    const receivedAtIso = new Date(Date.now() - 60_000).toISOString();
    await admin.service.confirm(
      'sess-token',
      'csrf-token',
      REQUEST_ID,
      {
        expectedVersion: 1,
        actualAmountVnd: 100000,
        bankId: 'VCB',
        systemAccountId: BANK_ACCOUNT_ID,
        canonicalTransactionId: 'FT2611250002',
        receivedAtIso,
        receivedAtMs: Date.parse(receivedAtIso),
      },
      'idem-admin-1',
      { requestId: 'req-trace-1' },
    );

    expect(admin.outboxEvents).toHaveLength(1);
    expect(admin.outboxEvents[0]).toMatchObject({
      eventType: 'wallet.topup_request.changed.v1',
      resourceType: 'wallet_topup_request',
      resourceId: REQUEST_ID,
      payload: { request_id: REQUEST_ID, state: 'CONFIRMED', version: 2, actual_amount_vnd: 100000 },
    });

    const harness = createNotificationHarness((id) => (id === REQUEST_ID ? { userId: DRIVER_USER_ID, actualAmountVnd: admin.getActualAmountVnd() } : undefined));
    await harness.service.consume(toPublishEvent(admin.outboxEvents[0]!));

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0]).toMatchObject({
      recipientUserId: DRIVER_USER_ID,
      app: 'SHIP',
      kind: 'TOPUP_CONFIRMED',
      category: 'WALLET_PROFILE',
      title: 'Nạp tiền thành công',
      body: 'Đã nạp 100.000đ vào ví',
      targetType: 'WALLET_TXN',
      targetId: REQUEST_ID,
      dedupeKey: `topup:${REQUEST_ID}:CONFIRMED:2`,
    });
    expect(harness.queuedPushes).toHaveLength(1);
  });

  it('Admin confirmation uses the actual credited amount when different from requested amount, and DB amount takes precedence over payload', async () => {
    const admin = buildAdminTopupHarness(100000n);
    const receivedAtIso = new Date(Date.now() - 60_000).toISOString();
    await admin.service.confirm(
      'sess-token',
      'csrf-token',
      REQUEST_ID,
      {
        expectedVersion: 1,
        actualAmountVnd: 60000,
        bankId: 'VCB',
        systemAccountId: BANK_ACCOUNT_ID,
        canonicalTransactionId: 'FT2611250003',
        receivedAtIso,
        receivedAtMs: Date.parse(receivedAtIso),
      },
      'idem-admin-2',
      { requestId: 'req-trace-2' },
    );

    expect(admin.outboxEvents[0]?.payload).toMatchObject({ state: 'CONFIRMED', actual_amount_vnd: 60000 });
    const harness = createNotificationHarness((id) => (id === REQUEST_ID ? { userId: DRIVER_USER_ID, actualAmountVnd: 60000n } : undefined));
    const publishEvent = toPublishEvent(admin.outboxEvents[0]!);
    await harness.service.consume({ ...publishEvent, payload: { ...publishEvent.payload, actual_amount_vnd: 999999 } });

    expect(harness.notifications[0]?.body).toBe('Đã nạp 60.000đ vào ví');
  });

  it('Admin rejection emits REJECTED without credited amount and creates TOPUP_REJECTED notification', async () => {
    const admin = buildAdminTopupHarness(100000n);
    await admin.service.reject(
      'sess-token',
      'csrf-token',
      REQUEST_ID,
      { expectedVersion: 1, reasonCode: 'NOT_RECEIVED' },
      'idem-admin-3',
      { requestId: 'req-trace-3' },
    );

    expect(admin.outboxEvents).toHaveLength(1);
    expect(admin.outboxEvents[0]?.payload).toEqual({ request_id: REQUEST_ID, state: 'REJECTED', version: 2 });

    const harness = createNotificationHarness((id) => (id === REQUEST_ID ? { userId: DRIVER_USER_ID, actualAmountVnd: null } : undefined));
    await harness.service.consume(toPublishEvent(admin.outboxEvents[0]!));

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0]).toMatchObject({
      kind: 'TOPUP_REJECTED',
      title: 'Yêu cầu nạp tiền bị từ chối',
    });
    expect(harness.notifications[0]?.body).not.toContain('Đã nạp');
  });
});
