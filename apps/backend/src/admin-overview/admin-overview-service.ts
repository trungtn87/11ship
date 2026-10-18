import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { Period, resolvePeriod } from '../admin-m12/vietnam-time';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { COMMISSION_VND } from '../delivery/delivery-constants';
import { AdminDeliveryFilter, DeliveryRepository } from '../delivery/delivery-repository';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { DriverBankRepository } from '../driver/driver-bank-repository';
import { DriverRepository } from '../driver/driver-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { evaluateEligibility } from '../shipping-policy/shipping-eligibility';
import { EligibilityParametersRepository } from '../shipping-policy/eligibility-parameters-repository';
import { AVAILABLE_BALANCE_PORT, AvailableBalancePort, SHIPPER_LOCATION_PORT, SHIPPER_WORK_PORT, ShipperLocationPort, ShipperWorkPort } from '../shipping-policy/shipping-ports';
import { ShopDiscoveryReader } from '../shop/shop-discovery-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { WalletReportReader } from '../wallet/wallet-report-reader';
import { OverviewQuery } from './admin-overview-validation';
import { FINANCE_PERMISSION_READ } from '../finance-access/finance-access-constants';

/** A shortcut to the list that makes the number: the web opens `area` with `query`, and the list answers with the same filter (the tile and the list share one definition). */
interface Link {
  readonly area: 'deliveries' | 'shippers' | 'finance-topups';
  readonly query: Readonly<Record<string, string>>;
}

type Metric =
  | { readonly status: 'OK'; readonly value: number; readonly link?: Link; readonly detail?: JsonObject }
  | { readonly status: 'FORBIDDEN' }
  | { readonly status: 'NOT_READY'; readonly reason: string }
  | { readonly status: 'ERROR' };

interface Measured {
  readonly value: number;
  readonly link?: Link;
  readonly detail?: JsonObject;
}

/** Shippers inspected for "eligible to take deliveries": more than this and the figure is refused as ERROR instead of being cut silently. */
const ELIGIBILITY_SCAN_LIMIT = 2000;

const notReady = (reason: string): Metric => ({ status: 'NOT_READY', reason });
const iso = (ms: number): string => new Date(ms).toISOString();

const jsonMetric = (metric: Metric): JsonObject => {
  if (metric.status !== 'OK') {
    return { ...metric };
  }
  const out: JsonObject = { status: 'OK', value: metric.value };
  if (metric.link !== undefined) {
    out.link = { area: metric.link.area, query: { ...metric.link.query } };
  }
  if (metric.detail !== undefined) {
    out.detail = metric.detail;
  }
  return out;
};

/**
 * M12-A: the overview of the administration. Every number is read from the module that OWNS it (M07 deliveries through its repository, M02 shops, M03
 * Shippers, M04 wallets and ledger) and nothing is stored here. Two kinds of figures are never mixed on the screen: the ones that happened in the chosen
 * period (by the moment named in their label) and the CURRENT state at the time of the read (`generated_at`).
 *
 * Every figure is its own metric with its own status: a section the actor may not see is FORBIDDEN, a module that is not built is NOT_READY, and a read that failed
 * is ERROR. None of them is ever turned into 0: the web shows "—" with the reason. Rights are read once under the actor's locks (so a right revoked a moment
 * ago is not used), and each metric then reads in its own short transaction, so one failing read cannot take the others down.
 */
@Injectable()
export class AdminOverviewService {
  readonly #log = new Logger(AdminOverviewService.name);
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly rightsReader: AdminRightsReader,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly driverQueries: DriverAdminQueryRepository,
    private readonly banks: DriverBankRepository,
    private readonly shops: ShopDiscoveryReader,
    private readonly wallets: WalletReportReader,
    private readonly parameters: EligibilityParametersRepository,
    @Inject(SHIPPER_WORK_PORT) private readonly work: ShipperWorkPort,
    @Inject(SHIPPER_LOCATION_PORT) private readonly locations: ShipperLocationPort,
    @Inject(AVAILABLE_BALANCE_PORT) private readonly balances: AvailableBalancePort,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async overview(sessionToken: string | undefined, query: OverviewQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    const rights = await this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      return this.rightsReader.read(context, known);
    });
    // The period is resolved on the clock the rights were read with (the database clock), never on the web server's.
    const period = resolvePeriod(query.range, rights.nowMs, query.custom);
    const created = (group: AdminDeliveryFilter['group'], extra: Partial<AdminDeliveryFilter> = {}): AdminDeliveryFilter => ({
      q: '', state: null, goods: null, basis: 'created', fromMs: null, toMs: null, shop: '', shopId: null, driverIds: null, source: null, group, ...extra,
    });
    const seeDeliveries = rights.canViewDeliveries;
    const dayQuery = { from: period.fromDay, to: period.toDay };

    const deliveriesCreated = await this.#metric(seeDeliveries, async (context) => ({
      value: await this.deliveries.countForAdmin(context, created(null, { fromMs: period.fromMs, toMs: period.toMs })),
      link: { area: 'deliveries', query: { ...dayQuery, basis: 'created' } },
    }));
    const outcome = async (state: 'completed' | 'failed'): Promise<Metric> =>
      this.#metric(seeDeliveries, async (context) => ({
        value: await this.deliveries.countForAdmin(context, created(null, { state, basis: 'ended', fromMs: period.fromMs, toMs: period.toMs })),
        link: { area: 'deliveries', query: { ...dayQuery, basis: 'ended', state } },
      }));
    const completed = await outcome('completed');
    const failed = await outcome('failed');
    const current = async (group: NonNullable<AdminDeliveryFilter['group']>): Promise<Metric> =>
      this.#metric(seeDeliveries, async (context) => ({ value: await this.deliveries.countForAdmin(context, created(group)), link: { area: 'deliveries', query: { group } } }));

    const money = await this.#money(rights, period);
    const partners = await this.#partners(rights);
    const todo = await this.#todo(rights, current);

    return {
      generated_at: iso(rights.nowMs),
      time_zone: 'Asia/Ho_Chi_Minh',
      period: { range: period.range, from: iso(period.fromMs), to: iso(period.toMs), from_day: period.fromDay, to_day: period.toDay },
      groups: {
        orders: {
          scope: 'PERIOD',
          // M10 (Order) does not exist yet: there is no table to count, so nothing is invented and nothing is 0.
          metrics: { created: jsonMetric(notReady('M10_ORDER_NOT_CONNECTED')), awaiting_confirmation: jsonMetric(notReady('M10_ORDER_NOT_CONNECTED')) },
        },
        deliveries_period: {
          scope: 'PERIOD',
          basis: { created: 'Ngày tạo delivery', completed: 'Ngày kết thúc', failed: 'Ngày kết thúc' },
          metrics: {
            created: jsonMetric(deliveriesCreated),
            completed: jsonMetric(completed),
            failed: jsonMetric(failed),
          },
          // Stated denominator: completed + failed that ENDED in the period (cancelled by the shop and stopped searches are not outcomes of a delivery run).
          success_rate: completed.status === 'OK' && failed.status === 'OK' ? { numerator: completed.value, denominator: completed.value + failed.value } : { status: completed.status === 'OK' ? failed.status : completed.status },
        },
        deliveries_now: {
          scope: 'CURRENT',
          metrics: {
            searching: jsonMetric(await current('searching')),
            waiting_pickup: jsonMetric(await current('waiting_pickup')),
            delivering: jsonMetric(await current('delivering')),
          },
        },
        partners_now: { scope: 'CURRENT', metrics: Object.fromEntries(Object.entries(partners).map(([key, metric]) => [key, jsonMetric(metric)])) },
        money_period: {
          scope: 'PERIOD',
          basis: 'Ngày ghi sổ cái (ledger M04)',
          metrics: Object.fromEntries(Object.entries(money.period).map(([key, metric]) => [key, jsonMetric(metric)])),
        },
        money_now: { scope: 'CURRENT', metrics: Object.fromEntries(Object.entries(money.now).map(([key, metric]) => [key, jsonMetric(metric)])) },
      },
      todo: Object.entries(todo).map(([key, metric]) => ({ key, ...jsonMetric(metric) })),
    };
  }

  /** Reads one figure in its own transaction. FORBIDDEN is decided BEFORE any read; a failing read is ERROR and never a number. */
  async #metric(allowed: boolean, read: (context: TransactionContext) => Promise<Measured>): Promise<Metric> {
    if (!allowed) {
      return { status: 'FORBIDDEN' };
    }
    try {
      const measured = await this.transactions.withTransaction(read);
      return { status: 'OK', ...measured };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ADMIN_SESSION_INVALID') {
        throw error;
      }
      this.#log.warn(`overview metric failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`);
      return { status: 'ERROR' };
    }
  }

  async #money(rights: AdminRights, period: Period): Promise<{ period: Record<string, Metric>; now: Record<string, Metric> }> {
    const allowed = rights.has(FINANCE_PERMISSION_READ);
    const ledger = await this.#metricGroup(allowed, (context) => this.wallets.ledgerPeriod(context, period.fromMs, period.toMs));
    const totals = await this.#metricGroup(allowed, (context) => this.wallets.totals(context));
    const pending = await this.#metricGroup(allowed, (context) => this.wallets.pendingTopups(context));
    const pick = <T>(group: { status: Metric['status'] } & { data?: T }, get: (data: T) => Measured): Metric =>
      group.status === 'OK' && group.data !== undefined ? { status: 'OK', ...get(group.data) } : ({ status: group.status } as Metric);
    return {
      period: {
        commission_vnd: pick(ledger, (l) => ({ value: l.commissionVnd, detail: { entries: l.commissionEntries } })),
        adjustment_net_vnd: pick(ledger, (l) => ({ value: l.adjustmentNetVnd, detail: { entries: l.adjustmentEntries } })),
        topup_vnd: pick(ledger, (l) => ({ value: l.topupVnd, detail: { entries: l.topupEntries } })),
        // Withdrawals (M04-C) are not built: the ledger cannot hold a WITHDRAWAL_DEBIT yet, so a 0 here would be a claim about a feature that does not exist.
        withdrawal_vnd: notReady('M04C_WITHDRAWAL_NOT_CONNECTED'),
      },
      now: {
        wallet_balance_vnd: pick(totals, (t) => ({ value: t.balanceVnd, detail: { wallets: t.wallets } })),
        wallet_held_vnd: pick(totals, (t) => ({ value: t.heldVnd })),
        wallet_available_vnd: pick(totals, (t) => ({ value: t.availableVnd })),
        topup_pending: pick(pending, (p) => ({ value: p.count, detail: { requested_vnd: p.requestedVnd }, link: { area: 'finance-topups', query: { status: 'PENDING' } } })),
        withdrawal_pending: notReady('M04C_WITHDRAWAL_NOT_CONNECTED'),
      },
    };
  }

  async #metricGroup<T>(allowed: boolean, read: (context: TransactionContext) => Promise<T>): Promise<{ status: Metric['status']; data?: T }> {
    if (!allowed) {
      return { status: 'FORBIDDEN' };
    }
    try {
      return { status: 'OK', data: await this.transactions.withTransaction(read) };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ADMIN_SESSION_INVALID') {
        throw error;
      }
      this.#log.warn(`overview group failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`);
      return { status: 'ERROR' };
    }
  }

  async #partners(rights: AdminRights): Promise<Record<string, Metric>> {
    const shopsOnline = await this.#metric(rights.canViewApp('SHOP'), async (context) => ({ value: await this.shops.countOnline(context) }));
    const accepting = await this.#metricGroup(rights.canViewApp('DRIVER'), async (context) => {
      const ids = await this.drivers.listAcceptingIds(context, ELIGIBILITY_SCAN_LIMIT);
      if (ids.length > ELIGIBILITY_SCAN_LIMIT) {
        throw new Error('too many accepting shippers to evaluate');
      }
      const params = await this.parameters.read(context);
      let eligible = 0;
      for (const driverId of ids) {
        const driver = await this.drivers.findById(context, driverId);
        if (driver === undefined) {
          continue;
        }
        const bank = await this.banks.find(context, driverId);
        const location = await this.locations.current(context, driverId);
        const open = await this.work.openWork(context, driverId);
        const available = await this.balances.availableVnd(context, driverId);
        const verdict = evaluateEligibility({
          nowMs: rights.nowMs,
          driver: { status: driver.status, acceptingDeliveries: driver.acceptingDeliveries, driverType: driver.driverType, bankVerified: bank?.verificationState === 'VERIFIED' },
          delivery: undefined,
          location: location === undefined ? undefined : { point: location.point, fresh: location.fresh, valid: location.valid },
          activeCount: open?.activeCount,
          availableVnd: available,
          externalMaxDeliveries: params.externalMaxDeliveries,
        });
        // The verdict is evaluated without a delivery, so the delivery-bound reason is expected; every shipper-level reason still counts, and the balance must cover the commission any delivery needs.
        const shipperReasons = verdict.reasons.filter((reason) => reason !== 'DEPENDENCY_NOT_READY' || open === undefined);
        if (shipperReasons.length === 0 && available !== undefined && available >= COMMISSION_VND) {
          eligible += 1;
        }
      }
      return { accepting: ids.length, eligible };
    });
    const driverOnly = (get: (data: { accepting: number; eligible: number }) => Measured): Metric =>
      accepting.status === 'OK' && accepting.data !== undefined ? { status: 'OK', ...get(accepting.data) } : ({ status: accepting.status } as Metric);
    return {
      shops_online: shopsOnline,
      shippers_accepting: driverOnly((d) => ({ value: d.accepting, link: { area: 'shippers', query: { status: 'ACTIVE' } } })),
      shippers_eligible: driverOnly((d) => ({ value: d.eligible })),
    };
  }

  async #todo(rights: AdminRights, current: (group: NonNullable<AdminDeliveryFilter['group']>) => Promise<Metric>): Promise<Record<string, Metric>> {
    const shipperProfiles = await this.#metric(rights.canReviewShippers, async (context) => ({
      value: await this.driverQueries.count(context, { pattern: null, status: 'SUBMITTED' }),
      link: { area: 'shippers', query: { status: 'SUBMITTED' } },
    }));
    const stopped = await current('stopped');
    const custody = await current('custody_open');
    const topups = await this.#metric(rights.has(FINANCE_PERMISSION_READ), async (context) => ({
      value: (await this.wallets.pendingTopups(context)).count,
      link: { area: 'finance-topups', query: { status: 'PENDING' } },
    }));
    return {
      shipper_profiles_pending: shipperProfiles,
      // M02 has no review step for a shop profile (a shop becomes ACTIVE when its owner completes onboarding): there is nothing waiting for approval.
      shop_profiles_pending: notReady('M02_NO_SHOP_REVIEW_FLOW'),
      topups_pending: topups,
      withdrawals_pending: notReady('M04C_WITHDRAWAL_NOT_CONNECTED'),
      deliveries_stopped: stopped,
      custody_open: custody,
      complaints_unhandled: notReady('M11_FEEDBACK_NOT_CONNECTED'),
    };
  }
}
