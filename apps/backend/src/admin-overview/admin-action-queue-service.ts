import { Inject, Injectable, Logger } from '@nestjs/common';
import { FINANCE_ADJUSTMENT_RIGHT } from '../admin-feedback/admin-feedback-service';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { DriverRepository } from '../driver/driver-repository';
import {
  FINANCE_PERMISSION_READ,
  FINANCE_PERMISSION_TOPUP_RECORD,
  FINANCE_PERMISSION_WITHDRAWAL_CONFIRM,
  FINANCE_PERMISSION_WITHDRAWAL_PROCESS,
  FINANCE_PERMISSION_WITHDRAWAL_RECONCILE,
  SHOP_ENTITLEMENT_MANAGE,
  SHOP_PAYMENT_READ,
  SHOP_PAYMENT_RECORD,
} from '../finance-access/finance-access-constants';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ShopRepository } from '../shop/shop-repository';
import { WalletReportReader } from '../wallet/wallet-report-reader';
import { AdminActionQueueReader, QueueRecord } from './admin-action-queue-reader';
import { ActionQueueQuery, QUEUE_KINDS, QueueKind } from './admin-overview-validation';

/** Records read per source. One more is read to learn whether the source holds more than is shown: the figure is then flagged, never silently cut. */
const SOURCE_LIMIT = 100;

type Link = { readonly area: string; readonly query: Readonly<Record<string, string>> };

interface Item {
  readonly kind: QueueKind;
  readonly key: string;
  readonly code: string;
  readonly status: string;
  readonly reason: string;
  readonly waitingSinceMs: number;
  readonly overdue: boolean | null;
  readonly waitingOn: string | null;
  readonly link: Link;
  readonly canHandle: boolean;
  readonly detail: JsonObject;
  /** The Order behind the file, when it has one: an Order and its Delivery are one file in the order flow. */
  readonly orderId: string | null;
}

type Source = { readonly status: 'OK'; readonly items: Item[]; readonly truncated: boolean } | { readonly status: 'FORBIDDEN' } | { readonly status: 'ERROR' };

const GOODS_TEXT: Record<string, string> = {
  WITH_SHIPPER: 'hàng còn ở shipper',
  RETURNED_TO_SHOP: 'shipper báo đã trả quán, quán chưa xác nhận',
  HANDED_TO_RECIPIENT: 'shipper báo đã giao người nhận',
  LOST_OR_DAMAGED: 'hàng mất hoặc hư',
};

const REASON_TEXT: Record<string, string> = {
  ORDER_AWAITING_SHOP: 'Quán chưa xác nhận đơn',
  DELIVERY_STOPPED: 'Ngừng tìm shipper, chưa ai gọi lại',
  SHIPPER_SUBMITTED: 'Hồ sơ shipper đã nộp, chờ duyệt',
  COMPLAINT_OPEN: 'Phản ánh chưa xử lý',
  COMPLAINT_AWAITING_SUBMITTER: 'Chờ người gửi bổ sung thông tin',
  COMPLAINT_AWAITING_SHOP: 'Chờ quán bổ sung thông tin',
  COMPLAINT_AWAITING_SHIPPER: 'Chờ shipper bổ sung thông tin',
  COMPLAINT_AWAITING_INFO: 'Chờ bổ sung thông tin',
  COMPLAINT_RECONSIDERATION: 'Có yêu cầu xem xét lại chưa trả lời',
  ADJUSTMENT_INSUFFICIENT_BALANCE: 'Thiếu số dư khả dụng để khấu trừ điều chỉnh',
  ADJUSTMENT_M04_UNAVAILABLE: 'Ví chưa xử lý được điều chỉnh, cần làm lại sau',
  TOPUP_AWAITING_CONFIRMATION: 'Yêu cầu nạp ví chờ xác nhận tiền',
  WITHDRAWAL_PENDING: 'Yêu cầu rút tiền chờ xử lý',
  WITHDRAWAL_PROCESSING: 'Đang chuyển khoản, chờ xác nhận đã chuyển',
  WITHDRAWAL_RECONCILIATION: 'Chờ đối soát kết quả chuyển khoản',
  SHOP_PAYMENT_AWAITING_CONFIRMATION: 'Quán báo đã thanh toán, chờ xác nhận tiền',
  SHOP_PAYMENT_AWAITING_GRANT: 'Đã xác nhận tiền, chờ cấp quyền mở rộng thực đơn',
};

/**
 * M12 "Việc cần xử lý": the files that still wait, from the module that OWNS each of them, with why they wait, since when and where to open them. It is READ-ONLY: it
 * writes no money, fee, entitlement or order result; every button on the page reaches the owning endpoint, which checks the right and the version again.
 *
 * Rules kept here:
 *  - One row per file. The same file read twice is the same row (its key is its identity), a chat message or event is never a row, and an Order together with
 *    the Delivery made for it is ONE file of the order flow.
 *  - A source the administrator may not see is FORBIDDEN, one that failed is ERROR; neither is ever turned into an empty list or a 0.
 *  - A file is called late ONLY by a rule the system already has (today: the 30-minute reminder of a shop payment); no threshold is guessed.
 *  - What may be done is decided from the CURRENT rights read under the actor's locks: with the view right alone a row only offers "Xem chi tiết".
 */
@Injectable()
export class AdminActionQueueService {
  readonly #log = new Logger(AdminActionQueueService.name);
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly rightsReader: AdminRightsReader,
    private readonly deliveries: DeliveryRepository,
    private readonly driverQueries: DriverAdminQueryRepository,
    private readonly drivers: DriverRepository,
    private readonly shops: ShopRepository,
    private readonly wallets: WalletReportReader,
    private readonly reader: AdminActionQueueReader,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async queue(sessionToken: string | undefined, query: ActionQueueQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    const rights = await this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      return this.rightsReader.read(context, known);
    });
    const sources = new Map<QueueKind, Source>();
    for (const kind of QUEUE_KINDS) {
      sources.set(kind, await this.#source(kind, rights));
    }

    // An Order and its Delivery are one file: the Delivery (the later step) wins, the Order row of the same Order is dropped.
    const delivered = new Set<string>();
    for (const source of sources.values()) {
      if (source.status === 'OK') {
        source.items.filter((item) => item.kind === 'DELIVERY_STOPPED' && item.orderId !== null).forEach((item) => delivered.add(item.orderId as string));
      }
    }
    const all: Item[] = [];
    for (const [kind, source] of sources) {
      if (source.status === 'OK') {
        const items = kind === 'ORDER_AWAITING_CONFIRMATION' ? source.items.filter((item) => item.orderId === null || !delivered.has(item.orderId)) : source.items;
        all.push(...items);
      }
    }

    const shown = all
      .filter((item) => query.kind === null || item.kind === query.kind)
      .filter((item) => query.status === null || item.status === query.status)
      .filter((item) => (query.fromMs === null || item.waitingSinceMs >= query.fromMs) && (query.toMs === null || item.waitingSinceMs < query.toMs))
      .sort((a, b) => (query.sort === 'oldest' ? a.waitingSinceMs - b.waitingSinceMs : b.waitingSinceMs - a.waitingSinceMs) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    return {
      generated_at: new Date(rights.nowMs).toISOString(),
      sources: QUEUE_KINDS.map((kind): JsonObject => {
        const source = sources.get(kind) as Source;
        if (source.status !== 'OK') {
          return { kind, status: source.status };
        }
        const count = all.filter((item) => item.kind === kind).length;
        return { kind, status: 'OK', count, truncated: source.truncated };
      }),
      total: shown.length,
      items: shown.map((item) => ({
        key: item.key,
        kind: item.kind,
        code: item.code,
        status: item.status,
        reason: item.reason,
        waiting_since: new Date(item.waitingSinceMs).toISOString(),
        age_seconds: Math.max(0, Math.floor((rights.nowMs - item.waitingSinceMs) / 1000)),
        overdue: item.overdue,
        waiting_on: item.waitingOn,
        action: item.canHandle ? 'HANDLE' : 'VIEW',
        link: { area: item.link.area, query: { ...item.link.query } },
        detail: item.detail,
      })),
    };
  }

  /** Reads one source in its own transaction: FORBIDDEN before any read, ERROR when the read fails. Never an empty list standing for either. */
  async #source(kind: QueueKind, rights: AdminRights): Promise<Source> {
    if (!this.#mayView(kind, rights)) {
      return { status: 'FORBIDDEN' };
    }
    try {
      const read = await this.transactions.withTransaction((context) => this.#read(kind, rights, context));
      return { status: 'OK', items: read.slice(0, SOURCE_LIMIT), truncated: read.length > SOURCE_LIMIT };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ADMIN_SESSION_INVALID') {
        throw error;
      }
      this.#log.warn(`action queue source ${kind} failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`);
      return { status: 'ERROR' };
    }
  }

  /** The shop's name comes from M02, not from a join here. A shop without a readable name is still listed, by a neutral label. */
  async #withShopNames(context: TransactionContext, records: QueueRecord[]): Promise<QueueRecord[]> {
    const names = await this.shops.namesOf(context, records.flatMap((record) => (record.subject?.kind === 'shop' ? [record.subject.id] : [])));
    return records.map((record) => ({ ...record, code: record.subject === null ? record.code : (names.get(record.subject.id) ?? 'Quán') }));
  }

  #mayView(kind: QueueKind, rights: AdminRights): boolean {
    switch (kind) {
      case 'DELIVERY_STOPPED':
      case 'ORDER_AWAITING_CONFIRMATION':
      case 'GOODS_OPEN':
      case 'COMPLAINT':
        return rights.canViewDeliveries;
      case 'SHIPPER_REVIEW':
        return rights.canReviewShippers;
      case 'ADJUSTMENT_PENDING_FINANCE':
        return rights.has(FINANCE_PERMISSION_READ) || rights.has(FINANCE_ADJUSTMENT_RIGHT);
      case 'TOPUP_PENDING':
      case 'WITHDRAWAL_OPEN':
        return rights.has(FINANCE_PERMISSION_READ);
      case 'SHOP_PAYMENT_PENDING':
        return rights.has(SHOP_PAYMENT_READ);
      case 'SHOP_PAYMENT_AWAITING_GRANT':
        return rights.has(SHOP_PAYMENT_READ) || rights.has(SHOP_ENTITLEMENT_MANAGE);
    }
  }

  async #read(kind: QueueKind, rights: AdminRights, context: TransactionContext): Promise<Item[]> {
    const limit = SOURCE_LIMIT + 1;
    const of = (record: QueueRecord, link: Link, canHandle: boolean, extra: { waitingOn?: string | null; orderId?: string | null } = {}): Item => ({
      kind,
      key: `${kind}|${record.key}`,
      code: record.code,
      status: record.status,
      reason: REASON_TEXT[record.reason] ?? 'Đang chờ xử lý',
      waitingSinceMs: record.waitingSinceMs,
      overdue: record.overdue,
      waitingOn: extra.waitingOn === undefined ? 'ADMIN' : extra.waitingOn,
      link,
      canHandle,
      detail: { ...record.detail },
      orderId: extra.orderId ?? null,
    });
    switch (kind) {
      case 'ORDER_AWAITING_CONFIRMATION': {
        const records = await this.reader.ordersAwaitingConfirmation(context, limit);
        return records.map((record) => of(record, { area: 'orders', query: {} }, false, { waitingOn: 'SHOP', orderId: String(record.detail.order_id) }));
      }
      case 'DELIVERY_STOPPED': {
        const page = await this.deliveries.listForAdmin(context, emptyFilter('stopped'), { limit, offset: 0 });
        const codes = await this.reader.orderCodes(context, page.rows.flatMap((row) => (row.delivery.orderId === null ? [] : [row.delivery.orderId])));
        return page.rows.map((row) => {
          const orderCode = row.delivery.orderId === null ? undefined : codes.get(row.delivery.orderId);
          const deliveryCode = row.delivery.displayCode ?? row.delivery.code;
          const since = row.delivery.searchStoppedAtMs ?? row.delivery.endedAtMs ?? row.delivery.updatedAtMs;
          const record: QueueRecord = { key: row.delivery.deliveryId, code: orderCode ?? deliveryCode, status: 'search_stopped', reason: 'DELIVERY_STOPPED', waitingSinceMs: since, targetId: null, subject: null, overdue: null, detail: { delivery_code: deliveryCode, order_code: orderCode ?? null, shop_name: row.delivery.shopName } };
          return of(record, { area: 'deliveries', query: { group: 'stopped' } }, false, { waitingOn: null, orderId: row.delivery.orderId });
        });
      }
      case 'GOODS_OPEN': {
        const page = await this.deliveries.listForAdmin(context, emptyFilter('custody_open'), { limit, offset: 0 });
        const incidents = await this.reader.openIncidents(context, page.rows.map((row) => row.delivery.deliveryId));
        const codes = await this.reader.orderCodes(context, page.rows.flatMap((row) => (row.delivery.orderId === null ? [] : [row.delivery.orderId])));
        const items: Item[] = [];
        for (const row of page.rows) {
          const incident = incidents.get(row.delivery.deliveryId);
          if (incident === undefined) {
            continue; // closed between the two reads: it has left the queue
          }
          const orderCode = row.delivery.orderId === null ? undefined : codes.get(row.delivery.orderId);
          const deliveryCode = row.delivery.displayCode ?? row.delivery.code;
          const record: QueueRecord = { key: row.delivery.deliveryId, code: orderCode ?? deliveryCode, status: 'OPEN', reason: 'GOODS_OPEN', waitingSinceMs: incident.sinceMs, targetId: null, subject: null, overdue: null, detail: { delivery_code: deliveryCode, order_code: orderCode ?? null, shop_name: row.delivery.shopName, goods_condition: incident.goods, reason_code: incident.reason } };
          const item = of(record, { area: 'deliveries', query: { group: 'custody_open' } }, rights.canReviewDeliveries);
          items.push({ ...item, reason: `Hàng chưa bàn giao xong: ${GOODS_TEXT[incident.goods] ?? 'chờ xử lý hàng'}` });
        }
        return items;
      }
      case 'SHIPPER_REVIEW': {
        const rows = await this.driverQueries.list(context, { pattern: null, status: 'SUBMITTED' }, { limit, offset: 0 });
        return rows.map((row) => of({ key: row.driver.driverId, code: row.driver.shipperCode, status: 'SUBMITTED', reason: 'SHIPPER_SUBMITTED', waitingSinceMs: row.driver.submittedAtMs ?? row.driver.updatedAtMs, targetId: row.driver.driverId, subject: null, overdue: null, detail: {} }, { area: 'shipper', query: { id: row.driver.driverId } }, true));
      }
      case 'COMPLAINT': {
        const handle = rights.canReviewApp('SHOP') || rights.canReviewApp('DRIVER');
        const records = await this.reader.complaints(context, limit);
        return records.map((record) => of(record, { area: 'complaints', query: {} }, handle, { waitingOn: waitingOnOf(record.reason) }));
      }
      case 'ADJUSTMENT_PENDING_FINANCE': {
        const records = await this.reader.pendingAdjustments(context, limit);
        return records.map((record) => of(record, { area: 'complaints', query: {} }, rights.has(FINANCE_ADJUSTMENT_RIGHT)));
      }
      case 'TOPUP_PENDING': {
        const topups = await this.wallets.pendingTopupList(context, limit);
        const shipperCodes = await this.drivers.identitiesOf(context, topups.map((topup) => topup.driverId));
        const records = topups.map((topup): QueueRecord => ({ key: `topup:${topup.requestId}`, code: shipperCodes.get(topup.driverId)?.shipperCode ?? 'Shipper', status: 'PENDING', reason: 'TOPUP_AWAITING_CONFIRMATION', waitingSinceMs: topup.sinceMs, targetId: topup.requestId, subject: null, overdue: null, detail: { amount_vnd: topup.amountVnd } }));
        return records.map((record) => of(record, { area: 'finance-topup', query: { id: record.targetId as string } }, rights.has(FINANCE_PERMISSION_TOPUP_RECORD)));
      }
      case 'WITHDRAWAL_OPEN': {
        const withdrawals = await this.wallets.openWithdrawalList(context, limit);
        const shipperCodes = await this.drivers.identitiesOf(context, withdrawals.map((withdrawal) => withdrawal.driverId));
        const records = withdrawals.map((withdrawal): QueueRecord => ({ key: `withdrawal:${withdrawal.withdrawalId}`, code: shipperCodes.get(withdrawal.driverId)?.shipperCode ?? 'Shipper', status: withdrawal.state, reason: `WITHDRAWAL_${withdrawal.state}`, waitingSinceMs: withdrawal.sinceMs, targetId: withdrawal.withdrawalId, subject: null, overdue: null, detail: { amount_vnd: withdrawal.amountVnd } }));
        return records.map((record) => {
          const right = record.status === 'PENDING' ? FINANCE_PERMISSION_WITHDRAWAL_PROCESS : record.status === 'PROCESSING' ? FINANCE_PERMISSION_WITHDRAWAL_CONFIRM : FINANCE_PERMISSION_WITHDRAWAL_RECONCILE;
          return of(record, { area: 'finance-withdrawal', query: { id: record.targetId as string } }, rights.has(right));
        });
      }
      case 'SHOP_PAYMENT_PENDING': {
        const records = await this.#withShopNames(context, await this.reader.pendingShopPayments(context, limit));
        return records.map((record) => of(record, { area: 'business-finance', query: { request: record.targetId as string } }, rights.has(SHOP_PAYMENT_RECORD)));
      }
      case 'SHOP_PAYMENT_AWAITING_GRANT': {
        const records = await this.#withShopNames(context, await this.reader.confirmedAwaitingGrant(context, limit));
        return records.map((record) => of(record, { area: 'business-finance', query: { request: record.targetId as string } }, rights.has(SHOP_ENTITLEMENT_MANAGE)));
      }
    }
  }
}

function waitingOnOf(reason: string): string {
  if (reason === 'COMPLAINT_AWAITING_SUBMITTER' || reason === 'COMPLAINT_AWAITING_SHOP' || reason === 'COMPLAINT_AWAITING_SHIPPER') {
    return reason.slice('COMPLAINT_AWAITING_'.length);
  }
  return 'ADMIN';
}

function emptyFilter(group: 'stopped' | 'custody_open'): Parameters<DeliveryRepository['listForAdmin']>[1] {
  return { q: '', state: null, goods: null, basis: 'created', fromMs: null, toMs: null, shop: '', shopId: null, driverIds: null, source: null, group };
}
