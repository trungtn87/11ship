import { Injectable } from '@nestjs/common';
import { AdminRights } from '../admin-m12/admin-rights';
import { Period } from '../admin-m12/vietnam-time';
import { DeliveryReportReader, ReportBasis } from '../delivery/delivery-report-reader';
import { DriverRepository } from '../driver/driver-repository';
import { FeedbackReportReader } from '../feedback/feedback-report-reader';
import { OrderReportReader } from '../orders/order-report-reader';
import { FINANCE_PERMISSION_READ, PERMISSION_REPORT_READ } from '../finance-access/finance-access-constants';
import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletReportReader } from '../wallet/wallet-report-reader';

export const REPORT_KINDS = ['deliveries', 'shops', 'shippers', 'quality', 'money'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export type Format = 'count' | 'vnd' | 'signed-vnd' | 'percent' | 'seconds' | 'text';
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly format: Format;
}
export interface SummaryItem {
  readonly key: string;
  readonly label: string;
  /** null = the figure does not exist (its module is not built); `note` says why. Never 0 for that. */
  readonly value: number | string | null;
  readonly format: Format;
  readonly note?: string;
  /** A delivery-list filter that opens the deliveries this number counts (the list answers with the same total). */
  readonly link?: Readonly<Record<string, string>>;
}
export interface ReportRow {
  readonly cells: ReadonlyArray<number | string | null>;
  readonly link?: Readonly<Record<string, string>>;
}
export interface Report {
  readonly kind: ReportKind;
  readonly title: string;
  /** The moment each figure is counted at, in words. */
  readonly basisLabel: string;
  readonly summary: readonly SummaryItem[];
  readonly columns: readonly Column[];
  readonly rows: readonly ReportRow[];
  /** True when more rows existed than were returned; an export carries them all (or fails, never a part). */
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

export const REPORT_TITLE: Record<ReportKind, string> = {
  deliveries: 'Báo cáo giao hàng (delivery)',
  shops: 'Báo cáo theo quán',
  shippers: 'Báo cáo theo shipper',
  quality: 'Báo cáo chất lượng',
  money: 'Báo cáo tiền và đối soát',
};

const percent = (numerator: number, denominator: number): number | null => (denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10);

/** What a kind needs on top of the right to read reports. Money is never opened by a report right alone. */
export function requiredRights(kind: ReportKind): readonly string[] {
  return kind === 'money' ? [PERMISSION_REPORT_READ, FINANCE_PERMISSION_READ] : [PERMISSION_REPORT_READ];
}

/**
 * M12-E: the five reports. Every figure is read from the owner (M07 deliveries, M04 ledger) and states its moment (created / ended / ledger written) and, for a rate, its
 * denominator. Order and delivery are counted apart: Order is not built, so its figure is absent (not 0), and a recall counts as a delivery, never as an Order. The platform's
 * revenue is not derived from deliveries: item and shipping money are between the parties and a top-up is a deposit; only the ledger rows (commission, adjustment, withdrawal) are the platform's money.
 */
@Injectable()
export class ReportBuilder {
  constructor(
    private readonly deliveries: DeliveryReportReader,
    private readonly wallets: WalletReportReader,
    private readonly drivers: DriverRepository,
    private readonly orders: OrderReportReader,
    private readonly feedback: FeedbackReportReader,
  ) {}

  async build(context: TransactionContext, kind: ReportKind, period: Period, basis: ReportBasis, rights: AdminRights, limit: number): Promise<Report> {
    for (const key of requiredRights(kind)) {
      rights.require(key);
    }
    switch (kind) {
      case 'deliveries':
        return this.#deliveries(context, period, basis, limit);
      case 'shops':
        return this.#shops(context, period, basis, limit);
      case 'shippers':
        return this.#shippers(context, period, rights, limit);
      case 'quality':
        return this.#quality(context, period);
      case 'money':
        return this.#money(context, period, limit);
      default:
        throw new AppError('ADMIN_INPUT_INVALID');
    }
  }

  async #deliveries(context: TransactionContext, period: Period, basis: ReportBasis, limit: number): Promise<Report> {
    const s = await this.deliveries.summary(context, basis, period.fromMs, period.toMs);
    const days = await this.deliveries.perDay(context, basis, period.fromMs, period.toMs);
    const link = (extra: Record<string, string> = {}): Record<string, string> => ({ from: period.fromDay, to: period.toDay, basis, ...extra });
    const finished = s.completed + s.failed;
    const orderCount = (await this.orders.summary(context, basis, period.fromMs, period.toMs)).total;
    const orderNote = 'Order (M10) tính riêng với delivery: gọi lại shipper tạo delivery mới, không tạo Order mới';
    return {
      kind: 'deliveries',
      title: REPORT_TITLE.deliveries,
      basisLabel: basis === 'created' ? 'Theo ngày tạo delivery' : 'Theo ngày kết thúc delivery (thành công, thất bại, quán hủy, ngừng tìm)',
      summary: [
        { key: 'orders', label: 'Order trong kỳ', value: orderCount, format: 'count', note: orderNote },
        { key: 'total', label: 'Delivery', value: s.total, format: 'count', link: link() },
        { key: 'completed', label: 'Giao thành công', value: s.completed, format: 'count', link: link({ state: 'completed' }) },
        { key: 'failed', label: 'Giao thất bại', value: s.failed, format: 'count', link: link({ state: 'failed' }) },
        { key: 'cancelled', label: 'Quán hủy', value: s.cancelled, format: 'count', link: link({ state: 'cancelled_by_merchant' }) },
        { key: 'stopped', label: 'Ngừng tìm shipper', value: s.stopped, format: 'count', link: link({ state: 'search_stopped' }) },
        { key: 'active', label: 'Đang xử lý', value: s.active, format: 'count' },
        { key: 'success_rate', label: 'Tỷ lệ giao thành công', value: percent(s.completed, finished), format: 'percent', note: `${String(s.completed)} thành công / ${String(finished)} đã giao xong (thành công + thất bại)` },
        { key: 'direct', label: 'Quán gọi trực tiếp', value: s.direct, format: 'count' },
        { key: 'from_order', label: 'Từ Order', value: s.fromOrder, format: 'count' },
        { key: 'recalls', label: 'Gọi lại (delivery mới, không tăng số Order)', value: s.recalls, format: 'count' },
        { key: 'goods', label: 'Tổng tiền hàng', value: s.goodsValueVnd, format: 'vnd', note: 'Tiền giữa các bên, không phải doanh thu nền tảng' },
        { key: 'fees', label: 'Tổng phí ship delivery thành công', value: s.completedFeeVnd, format: 'vnd', note: 'Tiền giữa các bên, không phải doanh thu nền tảng' },
      ],
      columns: [
        { key: 'day', label: 'Ngày', format: 'text' },
        { key: 'total', label: 'Delivery', format: 'count' },
        { key: 'completed', label: 'Thành công', format: 'count' },
        { key: 'failed', label: 'Thất bại', format: 'count' },
        { key: 'cancelled', label: 'Quán hủy', format: 'count' },
        { key: 'stopped', label: 'Ngừng tìm', format: 'count' },
        { key: 'active', label: 'Đang xử lý', format: 'count' },
      ],
      rows: days.slice(0, limit).map((d) => ({ cells: [d.day, d.total, d.completed, d.failed, d.cancelled, d.stopped, d.active], link: { from: d.day, to: d.day, basis } })),
      truncated: days.length > limit,
      notes: ['Mốc thời gian theo giờ Việt Nam (Asia/Ho_Chi_Minh).', 'Số tổng mở được danh sách delivery cấu thành với cùng bộ lọc.'],
    };
  }

  async #shops(context: TransactionContext, period: Period, basis: ReportBasis, limit: number): Promise<Report> {
    const rows = await this.deliveries.perShop(context, basis, period.fromMs, period.toMs, limit + 1);
    return {
      kind: 'shops',
      title: REPORT_TITLE.shops,
      basisLabel: basis === 'created' ? 'Theo ngày tạo delivery' : 'Theo ngày kết thúc delivery',
      summary: [{ key: 'shops', label: 'Số quán có delivery trong kỳ', value: rows.length > limit ? `${String(limit)}+` : rows.length, format: 'text' }],
      columns: [
        { key: 'shop', label: 'Quán', format: 'text' },
        { key: 'total', label: 'Delivery', format: 'count' },
        { key: 'completed', label: 'Thành công', format: 'count' },
        { key: 'failed', label: 'Thất bại', format: 'count' },
        { key: 'cancelled', label: 'Quán hủy', format: 'count' },
        { key: 'stopped', label: 'Ngừng tìm', format: 'count' },
        { key: 'rate', label: 'Tỷ lệ thành công (thành công / (thành công + thất bại))', format: 'percent' },
      ],
      rows: rows.slice(0, limit).map((r) => ({ cells: [r.shopName, r.total, r.completed, r.failed, r.cancelled, r.stopped, percent(r.completed, r.completed + r.failed)], link: { from: period.fromDay, to: period.toDay, basis, shop_id: r.shopId } })),
      truncated: rows.length > limit,
      notes: ['Mỗi dòng mở được danh sách delivery của quán trong kỳ.'],
    };
  }

  async #shippers(context: TransactionContext, period: Period, rights: AdminRights, limit: number): Promise<Report> {
    const rows = await this.deliveries.perShipper(context, period.fromMs, period.toMs, limit + 1);
    const identities = await this.drivers.identitiesOf(context, rows.map((row) => row.driverId));
    // The Shipper's name is personal data: it is shown only to an administrator who may review Shippers; everybody else sees the Shipper code.
    const named = rights.canReviewShippers;
    return {
      kind: 'shippers',
      title: REPORT_TITLE.shippers,
      basisLabel: 'Theo ngày shipper nhận đơn',
      summary: [{ key: 'shippers', label: 'Số shipper nhận đơn trong kỳ', value: rows.length > limit ? `${String(limit)}+` : rows.length, format: 'text' }],
      columns: [
        { key: 'code', label: 'Mã shipper', format: 'text' },
        ...(named ? [{ key: 'name', label: 'Tên shipper', format: 'text' as const }] : []),
        { key: 'accepted', label: 'Lần nhận', format: 'count' },
        { key: 'completed', label: 'Thành công', format: 'count' },
        { key: 'failed', label: 'Thất bại', format: 'count' },
        { key: 'by_shipper', label: 'Shipper trả đơn', format: 'count' },
        { key: 'by_admin', label: 'Admin giải phóng', format: 'count' },
        { key: 'by_shop', label: 'Quán hủy', format: 'count' },
      ],
      rows: rows.slice(0, limit).map((r) => ({ cells: [identities.get(r.driverId)?.shipperCode ?? '—', ...(named ? [identities.get(r.driverId)?.fullName ?? '—'] : []), r.accepted, r.completed, r.failed, r.cancelledByShipper, r.releasedByAdmin, r.cancelledByShop] })),
      truncated: rows.length > limit,
      notes: ['Một delivery có thể có nhiều lần nhận (giao lại sau khi shipper trả đơn).', named ? 'Tên shipper hiển thị vì tài khoản có quyền duyệt shipper.' : 'Tên shipper ẩn: tài khoản không có quyền duyệt shipper.'],
    };
  }

  async #quality(context: TransactionContext, period: Period): Promise<Report> {
    const q = await this.deliveries.quality(context, period.fromMs, period.toMs);
    const complaints = await this.feedback.unhandledComplaints(context);
    return {
      kind: 'quality',
      title: REPORT_TITLE.quality,
      basisLabel: 'Hồ sơ hàng theo ngày mở; delivery theo ngày tạo; lần nhận theo ngày nhận; phản ánh chưa xử lý là trạng thái hiện tại',
      summary: [
        { key: 'custody_open', label: 'Giao thất bại còn xử lý hàng', value: q.custodyOpen, format: 'count', link: { from: period.fromDay, to: period.toDay, group: 'custody_open' } },
        { key: 'stopped', label: 'Ngừng tìm, chưa gọi lại', value: q.stoppedNotRecalled, format: 'count', link: { from: period.fromDay, to: period.toDay, group: 'stopped' } },
        { key: 'accepted', label: 'Lần nhận đơn', value: q.assignmentsAccepted, format: 'count' },
        { key: 'shipper_releases', label: 'Shipper trả đơn', value: q.shipperReleases, format: 'count' },
        { key: 'admin_releases', label: 'Admin giải phóng shipper', value: q.adminReleases, format: 'count' },
        { key: 'avg_accept', label: 'Thời gian trung bình đến khi có shipper nhận', value: q.avgSecondsToAccept, format: 'seconds', note: q.avgSecondsToAccept === null ? 'Chưa có delivery nào được nhận trong kỳ' : `Trên ${String(q.acceptedDeliveries)} delivery đã có shipper nhận` },
        { key: 'complaints', label: 'Phản ánh chưa xử lý (hiện tại)', value: complaints, format: 'count', },
      ],
      columns: [
        { key: 'reason', label: 'Lý do giao thất bại', format: 'text' },
        { key: 'count', label: 'Số hồ sơ', format: 'count' },
      ],
      rows: q.failureReasons.map((r) => ({ cells: [r.reason, r.count] })),
      truncated: false,
      notes: ['Chỉ tính những gì hệ thống đã ghi; không suy ra chất lượng từ trạng thái giao hàng.'],
    };
  }

  async #money(context: TransactionContext, period: Period, limit: number): Promise<Report> {
    const ledger = await this.wallets.ledgerPeriod(context, period.fromMs, period.toMs);
    const days = await this.wallets.ledgerByDay(context, period.fromMs, period.toMs);
    const totals = await this.wallets.totals(context);
    const pending = await this.wallets.pendingTopups(context);
    const recon = await this.wallets.reconciliation(context);
    const withdrawals = await this.wallets.openWithdrawals(context);
    return {
      kind: 'money',
      title: REPORT_TITLE.money,
      basisLabel: 'Theo ngày ghi sổ cái (ledger M04); số dư và yêu cầu chờ là trạng thái hiện tại',
      summary: [
        { key: 'topup', label: 'Nạp ví đã duyệt', value: ledger.topupVnd, format: 'vnd', note: 'Tiền nạp là tiền ký quỹ của shipper, không phải doanh thu' },
        { key: 'commission', label: 'Hoa hồng đã thu', value: ledger.commissionVnd, format: 'vnd', note: `${String(ledger.commissionEntries)} dòng sổ cái` },
        { key: 'adjustment', label: 'Điều chỉnh / hoàn (ròng)', value: ledger.adjustmentNetVnd, format: 'signed-vnd', note: `${String(ledger.adjustmentEntries)} dòng sổ cái` },
        { key: 'withdrawal', label: 'Rút hoàn tất', value: ledger.withdrawalVnd, format: 'vnd', note: `${String(ledger.withdrawalEntries)} dòng sổ cái` },
        { key: 'withdrawal_pending', label: 'Yêu cầu rút chờ xử lý', value: withdrawals.pending, format: 'count', note: `${String(withdrawals.processing)} đang chuyển khoản` },
        { key: 'withdrawal_unknown', label: 'Rút chưa rõ kết quả', value: withdrawals.unknownOutcome, format: 'count', note: `${withdrawals.unknownOutcomeVnd.toLocaleString('vi-VN')} đ: không tính là đã chi cũng không tính là chưa chi` },
        { key: 'balance', label: 'Tổng số dư ví (hiện tại)', value: totals.balanceVnd, format: 'vnd' },
        { key: 'held', label: 'Đang giữ (hold)', value: totals.heldVnd, format: 'vnd' },
        { key: 'available', label: 'Khả dụng', value: totals.availableVnd, format: 'vnd' },
        { key: 'pending_topups', label: 'Yêu cầu nạp chờ xử lý', value: pending.count, format: 'count', note: `${pending.requestedVnd.toLocaleString('vi-VN')} đ đã yêu cầu` },
        { key: 'recon_ledger', label: 'Đối soát: tổng sổ cái (mọi thời điểm)', value: recon.ledgerSumVnd, format: 'vnd' },
        { key: 'recon_wallets', label: 'Đối soát: tổng số dư ví', value: recon.walletBalanceVnd, format: 'vnd' },
        { key: 'recon_diff', label: 'Đối soát: chênh lệch (phải bằng 0)', value: recon.differenceVnd, format: 'signed-vnd', note: recon.differenceVnd === 0 ? 'Khớp' : 'KHÔNG KHỚP: cần kiểm tra ngay' },
      ],
      columns: [
        { key: 'day', label: 'Ngày ghi sổ', format: 'text' },
        { key: 'topup', label: 'Nạp ví', format: 'vnd' },
        { key: 'commission', label: 'Hoa hồng', format: 'vnd' },
        { key: 'adjustment', label: 'Điều chỉnh (ròng)', format: 'signed-vnd' },
        { key: 'withdrawal', label: 'Rút', format: 'vnd' },
      ],
      rows: days.slice(0, limit).map((d) => ({ cells: [d.day, d.topupVnd, d.commissionVnd, d.adjustmentNetVnd, d.withdrawalVnd] })),
      truncated: days.length > limit,
      notes: [
        'Hoa hồng, hoàn và điều chỉnh lấy từ sổ cái ví M04; không suy ra tiền đã thu từ trạng thái giao hàng.',
        'Tiền hàng và phí ship giữa các bên không phải doanh thu nền tảng; nạp ví không phải doanh thu.',
      ],
    };
  }
}
