import { Inject, Injectable } from '@nestjs/common';
import { AdminRightsReader } from '../admin-m12/admin-rights';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { SEARCH_MINUTES } from '../delivery/delivery-constants';
import { LOCATION_LIVE_SECONDS, LOCATION_MAX_ACCURACY_M, LOCATION_STALE_SECONDS } from '../delivery/delivery-constants';
import { CommissionPolicyRepository } from '../wallet/commission-policy-repository';
import { ShipperWalletParametersRepository } from '../driver/shipper-wallet-parameters';
import { JsonObject } from '../idempotency/idempotency-executor';
import { NotificationRepository } from '../notifications/notification-repository';
import { SHIPPER_SEARCH_RADIUS_M } from '../shipping-policy/shipping-eligibility';
import { EligibilityParametersRepository } from '../shipping-policy/eligibility-parameters-repository';
import { ShippingFeePolicyRepository } from '../shipping-policy/shipping-fee-policy-repository';
import { SystemSettingsRepository } from '../system-settings/system-settings-repository';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminConfigRepository, CONFIG_AUDIT_ACTIONS, ConfigGroupKey } from './admin-config-repository';

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

interface Value {
  readonly key: string;
  readonly label: string;
  readonly value: number | boolean | string;
  readonly unit?: string;
}

/**
 * M12-D: the configuration of the system in one place, WITHOUT a second source of values. Every number here is read from the module that owns it (the OTP
 * switches of the system settings, the Shipper wallet parameters, the M06 eligibility parameters and fee table, the M08 notification settings); the page edits
 * them only through those owners' own commands, which check the version, write their own history and audit row. What is fixed by the approved rules (the 3 km
 * radius, the 30-minute search, the commission, the position freshness) is listed as FIXED and has no edit anywhere: this page never turns a rule into a parameter.
 *
 * Every administrator may read (Owner decision 2026-10-17); only SYSTEM may change, and each owner decides that again on its own command.
 */
@Injectable()
export class AdminConfigService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly rights: AdminRightsReader,
    private readonly settings: SystemSettingsRepository,
    private readonly wallet: ShipperWalletParametersRepository,
    private readonly commissionPolicy: CommissionPolicyRepository,
    private readonly eligibility: EligibilityParametersRepository,
    private readonly fees: ShippingFeePolicyRepository,
    private readonly notifications: NotificationRepository,
    private readonly history: AdminConfigRepository,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async groups(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      const settings = await this.settings.readAll(context);
      const walletRows = await this.wallet.readAll(context);
      const eligibility = await this.eligibility.read(context);
      const fee = await this.fees.active(context);
      const commission = await this.commissionPolicy.current(context);
      const notification = await this.notifications.readConfig(context);
      const maxMs = (values: ReadonlyArray<number | null>): number | null => values.reduce<number | null>((best, value) => (value === null ? best : best === null || value > best ? value : best), null);
      const otp = this.appConfig.auth;
      const group = (key: ConfigGroupKey | 'map_gps' | 'storage_backup', title: string, owner: string, version: number | null, updatedAtMs: number | null, values: readonly Value[], fixed: readonly Value[], edit: JsonObject | null): JsonObject => ({
        key,
        title,
        owner,
        version,
        updated_at: iso(updatedAtMs),
        values: values.map((value) => ({ ...value })),
        fixed_rules: fixed.map((value) => ({ ...value })),
        edit,
      });
      const groups: JsonObject[] = [
        group(
          'security',
          'Bảo mật, OTP và chống spam',
          'M01',
          // The version a save must echo is the SUM of the rows' versions (the owner's own group token).
          settings.reduce((sum, row) => sum + row.version, 0),
          maxMs(settings.map((row) => row.updatedAtMs)),
          settings.map((row) => ({ key: row.key, label: row.key === 'otp_registration_enabled' ? 'OTP khi đăng ký' : 'OTP khi quên mật khẩu', value: row.value })),
          [
            { key: 'otp_resend_seconds', label: 'Chờ gửi lại mã OTP', value: otp?.otpResendSeconds ?? 60, unit: 'giây' },
            { key: 'otp_max_attempts', label: 'Số lần nhập sai trước khi hủy luồng OTP', value: otp?.otpMaxAttempts ?? 3, unit: 'lần' },
          ],
          { kind: 'OTP', system_only: true, path: '/v1/admin/system-settings/phone-verification' },
        ),
        group(
          'shipper_wallet',
          'Shipper, ví và hoa hồng',
          'M03/M04',
          walletRows.reduce((sum, row) => sum + row.version, 0),
          maxMs(walletRows.map((row) => row.updatedAtMs)),
          walletRows.map((row) => ({ key: row.key, label: row.key === 'topup_min_vnd' ? 'Nạp tối thiểu mỗi yêu cầu' : 'Rút tối thiểu mỗi yêu cầu', value: row.valueVnd, unit: 'đ' })),
          [
            // M04-C owns the commission as an append-only policy changed in Tài chính; each assignment snapshots the amount when it is accepted, so a new policy never changes a delivery already taken.
            { key: 'commission_vnd', label: `Hoa hồng mỗi đơn giao thành công (chính sách phiên bản ${String(commission.version)}, sửa ở Tài chính; chốt theo từng lần nhận)`, value: Number(commission.amountVnd), unit: 'đ' },
          ],
          { kind: 'WALLET', system_only: true, path: '/v1/admin/system-settings/shipper-wallet', note: 'Mức mới áp dụng cho yêu cầu mới; yêu cầu đang xử lý giữ điều kiện đã ghi nhận.' },
        ),
        group(
          'delivery_policy',
          'Phí và điều kiện nhận / ghép đơn',
          'M06',
          eligibility.version,
          eligibility.updatedAtMs,
          [
            { key: 'external_max_deliveries', label: 'Số đơn tối đa shipper ngoài giữ cùng lúc', value: eligibility.externalMaxDeliveries, unit: 'đơn' },
            { key: 'batch_max_delay_seconds', label: 'Chậm tối đa khi ghép đơn', value: eligibility.batchMaxDelaySeconds, unit: 'giây' },
            { key: 'pickup_service_seconds', label: 'Thời gian phục vụ lấy hàng', value: eligibility.pickupServiceSeconds, unit: 'giây' },
            { key: 'handoff_service_seconds', label: 'Thời gian phục vụ giao hàng', value: eligibility.handoffServiceSeconds, unit: 'giây' },
            { key: 'fee_table_version', label: 'Bảng giá đang áp dụng', value: fee === undefined ? 'Chưa có bảng giá' : `Phiên bản ${String(fee.versionNo)}` },
          ],
          [
            { key: 'search_radius_m', label: 'Bán kính tìm shipper', value: SHIPPER_SEARCH_RADIUS_M, unit: 'm' },
            { key: 'search_window_minutes', label: 'Thời gian tìm shipper', value: SEARCH_MINUTES, unit: 'phút' },
          ],
          { kind: 'ELIGIBILITY', system_only: true, path: '/v1/admin/shipping-eligibility-policy', note: 'Bảng giá mới không đổi phí đã chốt của các delivery cũ (bảng giá có trang riêng).' },
        ),
        group(
          'notifications',
          'Thông báo',
          'M08',
          notification.version,
          notification.updatedAtMs,
          [
            { key: 'push_enabled', label: 'Bật thông báo đẩy', value: notification.pushEnabled },
            { key: 'default_sound', label: 'Âm thanh mặc định', value: notification.defaultSound },
            { key: 'visible_days', label: 'Số ngày hiển thị trong hộp thư', value: notification.visibleDays, unit: 'ngày' },
            { key: 'purge_days', label: 'Số ngày giữ trước khi dọn', value: notification.purgeDays, unit: 'ngày' },
            { key: 'retry_max_attempts', label: 'Số lần thử gửi lại tối đa', value: notification.retryMaxAttempts, unit: 'lần' },
            { key: 'retry_base_seconds', label: 'Chờ giữa các lần thử', value: notification.retryBaseSeconds, unit: 'giây' },
          ],
          [
            { key: 'shop_reminder_minutes', label: 'Nhắc quán chưa có shipper', value: '5 và 15', unit: 'phút' },
            { key: 'pickup_reminder_minutes', label: 'Nhắc shipper chưa lấy hàng', value: 5, unit: 'phút' },
          ],
          { kind: 'NOTIFICATION', system_only: true, path: '/v1/admin/notifications/config' },
        ),
        group(
          'map_gps',
          'Bản đồ và GPS',
          'M14',
          null,
          null,
          [],
          [
            { key: 'location_live_seconds', label: 'Vị trí được coi là trực tiếp', value: LOCATION_LIVE_SECONDS, unit: 'giây' },
            { key: 'location_stale_seconds', label: 'Vị trí cũ trước khi coi là mất kết nối', value: LOCATION_STALE_SECONDS, unit: 'giây' },
            { key: 'location_max_accuracy_m', label: 'Sai số tối đa chấp nhận', value: LOCATION_MAX_ACCURACY_M, unit: 'm' },
          ],
          null,
        ),
        group('storage_backup', 'Lưu trữ và sao lưu', 'M12-F', null, null, [], [], null),
      ];
      return { generated_at: iso(rights.nowMs), editable: rights.isSystem, groups };
    });
  }

  /** The unified change history, from the audit rows each owner writes in the same transaction as its change (before / after, and the reason when given). */
  async changeHistory(sessionToken: string | undefined, group: ConfigGroupKey | null, limit: number): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      const actions = group === null ? Object.keys(CONFIG_AUDIT_ACTIONS) : Object.entries(CONFIG_AUDIT_ACTIONS).filter(([, value]) => value === group).map(([action]) => action);
      const rows = await this.history.recent(context, actions, limit);
      return {
        generated_at: iso(rights.nowMs),
        items: rows.map((row) => ({ at: iso(row.atMs), group: CONFIG_AUDIT_ACTIONS[row.action], action: row.action, actor_name: row.actorName, resource_version: row.resourceVersion, metadata: row.metadata })),
      };
    });
  }
}
