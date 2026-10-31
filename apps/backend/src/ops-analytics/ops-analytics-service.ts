import { Inject, Injectable } from '@nestjs/common';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { DAY_MS, Period, resolvePeriod, startOfVietnamDay, vietnamDay } from '../admin-m12/vietnam-time';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ShipperLocationRepository } from '../delivery/shipper-location';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { PERMISSION_REPORT_READ } from '../finance-access/finance-access-constants';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { FunnelCohort, OpsAnalyticsRepository, SourceFilter } from './ops-analytics-repository';
import { OpsAnomalySettingsRepository } from './ops-anomaly-repository';

export type AnalyticsRange = 'today' | '7d' | '30d' | 'custom';
export interface AnalyticsQuery {
  readonly range: AnalyticsRange;
  readonly from?: string;
  readonly to?: string;
  readonly source: SourceFilter;
}

const ONLINE_LIST_LIMIT = 5000;
const STEPS_ORDER = ['AWAITING_SHOP', 'CONFIRMED', 'SEARCHING', 'ASSIGNED', 'PICKED_UP'] as const;
const STEPS_DIRECT = ['SEARCHING', 'ASSIGNED', 'PICKED_UP'] as const;

/** A rate with its numerator and denominator; no denominator = null ("chưa đủ dữ liệu"), never 0 %. */
const rate = (numerator: number, denominator: number): JsonObject => ({ numerator, denominator, pct: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10 });

/**
 * Issue #241: "Bảng phân tích vận hành" of the Mini Business. Four questions: how many requests found no Shipper, which shops confirm slowly, which hours are short of
 * Shippers, where Orders are cancelled. Read only; `report.read` opens it and each block needs the APP views of the sides it counts (shop side: SHOP; delivery side: SHOP and
 * DRIVER), otherwise that block is FORBIDDEN (never a total of the whole system). Vietnam days; the running day is not "finished": Orders and requests still in flight are
 * counted apart and never as failures or cancellations. The wait limit of a shop is the one each Order carries (no second SLA); thresholds for "low sample" come from the
 * anomaly settings (one place for the minimum sample).
 */
@Injectable()
export class OpsAnalyticsService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly rightsReader: AdminRightsReader,
    private readonly repo: OpsAnalyticsRepository,
    private readonly settings: OpsAnomalySettingsRepository,
    private readonly drivers: DriverAdminQueryRepository,
    private readonly locations: ShipperLocationRepository,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  #period(query: AnalyticsQuery, nowMs: number): Period {
    if (query.range === '30d') {
      const today = startOfVietnamDay(nowMs);
      return resolvePeriod('custom', nowMs, { from: vietnamDay(today - 29 * DAY_MS), to: vietnamDay(today) });
    }
    return resolvePeriod(query.range, nowMs, query.range === 'custom' && query.from !== undefined && query.to !== undefined ? { from: query.from, to: query.to } : undefined);
  }

  async #rights(token: string | undefined): Promise<{ rights: AdminRights; nowMs: number }> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rightsReader.read(context, known);
      rights.require(PERMISSION_REPORT_READ);
      return { rights, nowMs: rights.nowMs };
    });
  }

  async overview(token: string | undefined, query: AnalyticsQuery): Promise<JsonObject> {
    const { rights, nowMs } = await this.#rights(token);
    const period = this.#period(query, nowMs);
    const shopSide = rights.canViewApp('SHOP');
    const both = shopSide && rights.canViewApp('DRIVER');
    const forbidden = { status: 'FORBIDDEN' } as JsonObject;
    return this.transactions.withTransaction(async (context) => {
      const minSamples = (await this.settings.read(context)).minSamples;
      const block = async (allowed: boolean, build: () => Promise<JsonObject>): Promise<JsonObject> => (allowed ? { status: 'OK', ...(await build()) } : forbidden);
      const search = await block(both, async () => {
        const s = await this.repo.searchSummary(context, period.fromMs, period.toMs, query.source);
        const closed = s.total - s.searching;
        return {
          requests: s.total,
          still_searching: s.searching,
          matched: s.matched,
          failed: rate(s.failed, closed),
          failed_after_release: s.failedAfterRelease,
          cancelled_by_creator: s.cancelledByCreator,
          cancelled_by_system: s.cancelledBySystem,
          shipper_releases: s.releases,
          match_seconds: { median: s.matchMedianSeconds, p90: s.matchP90Seconds },
          causes: [{ code: 'SEARCH_TIMEOUT', label: 'Hết thời gian tìm shipper (đã ghi nhận)', count: s.failed + s.failedAfterRelease }],
          causes_note: 'Chỉ nguyên nhân hệ thống đã ghi nhận; không suy đoán nguyên nhân khác.',
          low_sample: closed < minSamples,
        };
      });
      const confirm =
        query.source === 'DIRECT'
          ? ({ status: 'NOT_APPLICABLE', note: 'Gọi ship trực tiếp không có bước quán xác nhận.' } as JsonObject)
          : await block(shopSide, async () => {
              const c = await this.repo.confirmSummary(context, period.fromMs, period.toMs);
              const decided = c.summary.total - c.summary.waiting;
              return {
                orders: c.summary.total,
                waiting: c.summary.waiting,
                confirmed: c.summary.confirmed,
                slow: rate(c.summary.slow, c.summary.confirmed - c.summary.noSnapshot),
                expired: rate(c.summary.expired, decided),
                rejected: c.summary.rejected,
                cancelled_by_customer_before_confirm: c.summary.cancelledByCustomer,
                confirm_seconds: { median: c.summary.medianSeconds, p90: c.summary.p90Seconds },
                slow_rule: 'Chậm = xác nhận sau mốc nhắc đầu tiên của chính đơn đó (không đặt SLA thứ hai). Đơn hẹn giờ không tính.',
                shops: c.shops.map((s) => ({
                  shop_id: s.shopId, name: s.shopName, samples: s.samples, confirmed: s.confirmed, slow: s.slow, expired: s.expired, rejected: s.rejected,
                  median_seconds: s.medianSeconds, p90_seconds: s.p90Seconds, low_sample: s.samples < minSamples,
                })),
                low_sample: decided < minSamples,
              };
            });
      const heat = await block(both, async () => {
        const h = await this.repo.heatmap(context, period.fromMs, period.toMs, query.source);
        return {
          cells: h.cells.map((c) => ({
            weekday: c.weekday, hour: c.hour, requests: c.requests, not_matched: c.notMatched, not_matched_pct: c.requests === 0 ? null : Math.round((c.notMatched / c.requests) * 1000) / 10,
            median_match_seconds: c.medianMatchSeconds, supply_avg_online: c.supplyAvgOnline, supply_avg_ready: c.supplyAvgReady, supply_slots: c.supplySlots, low_sample: c.requests < minSamples,
          })),
          supply_available: h.snapshotsInPeriod > 0,
          note: h.snapshotsInPeriod > 0 ? 'Cung shipper lấy từ đếm Online mỗi 15 phút (chỉ số lượng). Ô thiếu số liệu cung nghĩa là chưa ghi nhận, không phải 0.' : 'Chưa có số liệu nguồn cung trong kỳ: "nghi thiếu shipper" chỉ dựa trên kết quả tìm, chưa xác nhận.',
        };
      });
      const funnel = await block(both, async () => {
        const order = query.source === 'DIRECT' ? undefined : await this.repo.orderFunnel(context, period.fromMs, period.toMs);
        const direct = query.source === 'ORDER' ? undefined : await this.repo.directFunnel(context, period.fromMs, period.toMs);
        const view = (cohort: FunnelCohort | undefined, steps: readonly string[]): JsonObject | null =>
          cohort === undefined
            ? null
            : {
                steps: steps.map((step) => {
                  const entered = cohort.entered[step] ?? 0;
                  const byActor = cohort.cancelledAt[step] ?? {};
                  const cancelled = Object.values(byActor).reduce((sum, n) => sum + n, 0);
                  return { step, entered, cancelled: rate(cancelled, entered), by_actor: byActor };
                }),
                completed: cohort.completed,
                in_progress: cohort.inProgress,
              };
        return {
          order: view(order, STEPS_ORDER),
          direct: view(direct, STEPS_DIRECT),
          direct_note: 'Gọi ship trực tiếp không có bước chờ quán xác nhận / đã xác nhận: các bước này là N/A, không phải 0 %.',
        };
      });
      return {
        generated_at: new Date(nowMs).toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        period: { from_day: period.fromDay, to_day: period.toDay, includes_today: period.toMs > nowMs },
        source: query.source,
        min_samples: minSamples,
        search_failures: search,
        shop_confirmation: confirm,
        supply_demand: heat,
        cancellations: funnel,
      };
    });
  }

  async drilldown(token: string | undefined, query: AnalyticsQuery, kind: 'search_failed' | 'slow_confirm' | 'expired_confirm' | 'cancelled_at_step', step: string | null, limit: number, offset: number): Promise<JsonObject> {
    const { rights, nowMs } = await this.#rights(token);
    const shopSide = rights.canViewApp('SHOP');
    const both = shopSide && rights.canViewApp('DRIVER');
    if ((kind === 'slow_confirm' || kind === 'expired_confirm') ? !shopSide : !both) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    const period = this.#period(query, nowMs);
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const page = await this.repo.drilldown(context, kind, period.fromMs, period.toMs, query.source, step, limit, offset);
      return {
        total: page.total, limit, offset,
        items: page.rows.map((r) => ({ code: r.code, kind: r.kind, shop_name: r.shopName, state: r.state, at: new Date(r.atMs).toISOString(), detail: r.detail })),
      };
    });
  }

  /** The 15-minute Online count (called by the runtime; idempotent per slot). */
  async recordOnlineSnapshot(nowMs: number): Promise<boolean> {
    const slotMs = Math.floor(nowMs / (15 * 60_000)) * 15 * 60_000;
    return this.transactions.withTransaction(async (context) => {
      const online = await this.drivers.onlineDriverIds(context, ONLINE_LIST_LIMIT);
      const ready = await this.locations.countFreshAmong(context, online);
      const inserted = await this.repo.recordSnapshot(context, slotMs, online.length, ready);
      // Counts older than 180 days have no use: the table never grows without bound.
      await this.repo.purgeSnapshotsBefore(context, nowMs - 180 * DAY_MS);
      return inserted;
    });
  }

}
