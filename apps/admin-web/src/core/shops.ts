// Model of "Vận hành › Quán" (M02 shop management). PLAIN DATA, the port the pages talk to, and the one state machine of the disable / enable
// popup. dom/shops-view.ts draws it and core/shops-api.ts is the real source. The page shows only what the server said: it never decides a right,
// a status, or whether a shop is open. "Hồ sơ" (profile status) and "Theo lịch" (open / closed by the schedule) are two different facts, both
// computed by the server; nothing is derived from the clock of this browser.

import { Failure } from './accounts.js';

export const SHOP_PAGE_SIZE = 20;
export const MENU_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 20;
export const REASON_MAX = 500;
export const SEARCH_MAX = 80;

export type ShopStatus = 'INCOMPLETE' | 'ACTIVE' | 'DISABLED';
export const PROFILE_FILTERS = ['ALL', 'ACTIVE', 'DISABLED', 'INCOMPLETE'] as const;
export type ProfileFilter = (typeof PROFILE_FILTERS)[number];
export const SCHEDULE_FILTERS = ['ALL', 'OPEN', 'CLOSED'] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];
export const MENU_STATUS_FILTERS = ['ALL', 'VISIBLE', 'HIDDEN'] as const;
export type MenuStatusFilter = (typeof MENU_STATUS_FILTERS)[number];
export const SHOP_TABS = ['profile', 'hours', 'menu', 'history'] as const;
export type ShopTab = (typeof SHOP_TABS)[number];

export const TAB_LABEL: Record<ShopTab, string> = { profile: 'Hồ sơ', hours: 'Giờ hoạt động', menu: 'Thực đơn', history: 'Lịch sử quản lý' };

export const PROFILE_FILTER_LABEL: Record<ProfileFilter, string> = { ALL: 'Mọi trạng thái hồ sơ', ACTIVE: 'Đang hoạt động', DISABLED: 'Đã vô hiệu hóa', INCOMPLETE: 'Hồ sơ nháp' };
export const SCHEDULE_FILTER_LABEL: Record<ScheduleFilter, string> = { ALL: 'Mở/đóng theo lịch: tất cả', OPEN: 'Đang mở theo lịch', CLOSED: 'Đang đóng theo lịch' };
export const MENU_STATUS_LABEL: Record<MenuStatusFilter, string> = { ALL: 'Hiện và ẩn', VISIBLE: 'Đang hiện', HIDDEN: 'Đang ẩn' };

export const PROFILE_STATUS: Record<ShopStatus, { readonly label: string; readonly tone: 'ok' | 'wait' | 'lock' | 'neutral' }> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'ok' },
  DISABLED: { label: 'Đã vô hiệu hóa', tone: 'lock' },
  INCOMPLETE: { label: 'Hồ sơ nháp', tone: 'wait' },
};

export type AvailabilityReason = 'SHOP_DISABLED' | 'SHOP_INCOMPLETE' | 'SERVICE_AREA_INACTIVE' | 'NO_BUSINESS_HOURS' | 'OUTSIDE_BUSINESS_HOURS' | 'ONLINE';

/** The state "by the schedule" and why, in the order the server decides it. */
export const AVAILABILITY_LABEL: Record<AvailabilityReason, { readonly label: string; readonly tone: 'ok' | 'wait' | 'lock' | 'neutral' }> = {
  ONLINE: { label: 'Đang mở', tone: 'ok' },
  OUTSIDE_BUSINESS_HOURS: { label: 'Đóng · ngoài giờ', tone: 'neutral' },
  NO_BUSINESS_HOURS: { label: 'Đóng · chưa có lịch', tone: 'neutral' },
  SERVICE_AREA_INACTIVE: { label: 'Đóng · khu vực tạm ngưng', tone: 'wait' },
  SHOP_INCOMPLETE: { label: 'Đóng · hồ sơ nháp', tone: 'wait' },
  SHOP_DISABLED: { label: 'Đóng · bị vô hiệu hóa hoặc chủ quán bị khóa', tone: 'lock' },
};

export const ENABLE_BLOCKER_LABEL: Record<string, string> = {
  PICKUP_POINT_MISSING: 'Thiếu tọa độ lấy hàng của quán (chủ quán cập nhật trong 11Food).',
  SERVICE_AREA_MISSING: 'Quán chưa có khu vực phục vụ (chủ quán cập nhật trong 11Food).',
  SERVICE_AREA_INACTIVE: 'Khu vực phục vụ của quán đang tạm ngưng. Bật lại khu vực trước khi kích hoạt quán.',
};

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  'admin.shop.disable.v1': 'Quản trị viên vô hiệu hóa quán',
  'admin.shop.enable.v1': 'Quản trị viên kích hoạt lại quán',
  'shop.profile.update.v1': 'Chủ quán cập nhật hồ sơ',
  'shop.business_hours.replace.v1': 'Chủ quán cập nhật giờ hoạt động',
  'onboarding.shop.profile.save.v1': 'Chủ quán lưu hồ sơ nháp',
  'onboarding.shop.complete.v1': 'Chủ quán hoàn tất hồ sơ và kích hoạt quán',
};

export interface OwnerInfo {
  readonly name: string | null;
  readonly phone: string;
  readonly locked: boolean;
}

export interface Availability {
  readonly online: boolean;
  readonly reason: AvailabilityReason;
  readonly evaluatedAt: string;
}

export interface AreaOption {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface ShopRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly addressText: string;
  readonly owner: OwnerInfo | null;
  readonly areaName: string | null;
  readonly status: ShopStatus;
  readonly availability: Availability;
  readonly itemsVisible: number;
  readonly itemsTotal: number;
}

export interface ShopListPage {
  readonly rows: readonly ShopRow[];
  readonly total: number;
  readonly areas: readonly AreaOption[];
}

export interface BusinessInterval {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly endDayOffset: number;
}

export interface ShopDetail {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: ShopStatus;
  readonly version: number;
  readonly logoUrl: string | null;
  readonly owner: OwnerInfo | null;
  readonly contactPhone: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly addressText: string;
  readonly areaName: string | null;
  readonly areaActive: boolean | null;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly availability: Availability;
  readonly timezone: string;
  readonly hours: readonly BusinessInterval[];
  readonly menuVisible: number;
  readonly menuHidden: number;
  readonly ordersPendingConfirmation: number;
  readonly ordersPreparing: number;
  readonly activeDeliveries: number;
  readonly enableBlockers: readonly string[];
  readonly actions: readonly ShopCommandName[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MenuGroup {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly itemCount: number;
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly priceVnd: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryActive: boolean;
  readonly status: 'VISIBLE' | 'HIDDEN';
  readonly imageUrl: string | null;
  readonly updatedAt: string;
}

export interface MenuQuery {
  readonly query: string;
  readonly category: string;
  readonly status: MenuStatusFilter;
  readonly page: number;
}

export interface MenuPage {
  readonly groups: readonly MenuGroup[];
  readonly items: readonly MenuItem[];
  readonly total: number;
}

export interface HistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: { readonly type: 'ADMIN' | 'SYSTEM' | 'OWNER'; readonly name: string | null };
  readonly action: string;
  readonly version: number | null;
  readonly reason: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  readonly total: number;
}

export type Preview =
  | { readonly visible: false; readonly reason: AvailabilityReason }
  | {
      readonly visible: true;
      readonly name: string;
      readonly logoUrl: string | null;
      readonly addressText: string;
      readonly availability: Availability;
      readonly hours: readonly BusinessInterval[];
      readonly categories: readonly { readonly id: string; readonly name: string; readonly items: readonly { readonly id: string; readonly name: string; readonly priceVnd: number; readonly imageUrl: string | null }[] }[];
    };

export interface ShopQuery {
  readonly query: string;
  readonly area: string;
  readonly profile: ProfileFilter;
  readonly schedule: ScheduleFilter;
  readonly page: number;
}

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };
export type NotWired = { readonly kind: 'not-wired'; readonly reason: string };

export type ListRead = { readonly kind: 'ready'; readonly page: ShopListPage } | NotWired | Refused;
export type DetailRead = { readonly kind: 'ready'; readonly shop: ShopDetail } | { readonly kind: 'not-found' } | NotWired | Refused;
export type MenuRead = { readonly kind: 'ready'; readonly page: MenuPage } | { readonly kind: 'not-found' } | NotWired | Refused;
export type HistoryRead = { readonly kind: 'ready'; readonly page: HistoryPage } | { readonly kind: 'not-found' } | NotWired | Refused;
export type PreviewRead = { readonly kind: 'ready'; readonly preview: Preview } | { readonly kind: 'not-found' } | NotWired | Refused;

export type ShopCommandName = 'disable' | 'enable';

export interface ShopCommandRequest {
  readonly id: string;
  readonly name: ShopCommandName;
  readonly version: number;
  readonly reason: string;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type ShopCommandResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  /** The server looked at it and said no (a code the page turns into a sentence). Nothing changed. */
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the command MAY have been executed. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const REFUSAL_MESSAGE: Record<string, string> = {
  SHOP_NOT_FOUND: 'Không tìm thấy quán này.',
  SHOP_STATE_CONFLICT: 'Trạng thái quán đã thay đổi nên thao tác này không còn phù hợp. Hãy đọc trạng thái mới.',
  SHOP_PROFILE_INCOMPLETE: 'Hồ sơ quán thiếu tọa độ lấy hàng hoặc khu vực phục vụ nên chưa thể kích hoạt lại. Chủ quán cần bổ sung trong 11Food.',
  INVALID_SERVICE_AREA: 'Khu vực phục vụ của quán đang tạm ngưng nên chưa thể kích hoạt lại.',
  ADMIN_INPUT_INVALID: 'Thông tin gửi lên không hợp lệ (lý do bắt buộc, tối đa 500 ký tự).',
};

export const NOT_WIRED_SHOPS_REASON = 'Quản lý quán chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface ShopSource {
  list(query: ShopQuery): Promise<ListRead>;
  detail(id: string): Promise<DetailRead>;
  menu(id: string, query: MenuQuery): Promise<MenuRead>;
  history(id: string, page: number): Promise<HistoryRead>;
  preview(id: string): Promise<PreviewRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  command(request: ShopCommandRequest): Promise<ShopCommandResult>;
}

export const NOT_WIRED_SHOPS: ShopSource = {
  list: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHOPS_REASON }),
  detail: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHOPS_REASON }),
  menu: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHOPS_REASON }),
  history: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHOPS_REASON }),
  preview: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHOPS_REASON }),
  command: () => Promise.resolve({ kind: 'not-wired' }),
};

// ---- formatting (pure) -----------------------------------------------------------------------------------------------------

export const WEEKDAY_LABEL: readonly string[] = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];

export function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** One interval as text: "08:00 – 22:00", "22:00 – 02:00 (hôm sau)", "Cả ngày (24 giờ)" for 00:00-24:00 or exactly 24 hours. */
export function intervalText(interval: BusinessInterval): string {
  if (interval.endDayOffset === 0 && interval.startMinute === 0 && interval.endMinute === 1440) {
    return 'Cả ngày (24 giờ)';
  }
  if (interval.endDayOffset === 1 && interval.startMinute === interval.endMinute) {
    return `${clock(interval.startMinute)} – ${clock(interval.endMinute)} (hôm sau · 24 giờ)`;
  }
  return `${clock(interval.startMinute)} – ${interval.endMinute === 1440 ? '24:00' : clock(interval.endMinute)}${interval.endDayOffset === 1 ? ' (hôm sau)' : ''}`;
}

/** The week as seven lines (Monday first), several intervals per day in time order; a day with none is "Nghỉ". */
export function weekLines(hours: readonly BusinessInterval[]): readonly { readonly label: string; readonly intervals: readonly string[] }[] {
  return WEEKDAY_LABEL.map((label, index) => ({
    label,
    intervals: hours
      .filter((interval) => interval.weekday === index + 1)
      .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
      .map(intervalText),
  }));
}

export function formatVnd(value: number): string {
  return `${value.toLocaleString('vi-VN')} ₫`;
}

export function ownerText(owner: OwnerInfo | null): string {
  return owner === null ? 'Chưa có chủ quán' : `${owner.name ?? 'Chủ quán'} · ${owner.phone}`;
}

/** "+84912345678" -> "0912 345 678" for reading; anything else is shown as received. */
export function displayPhone(phone: string): string {
  const match = /^\+84(\d{9})$/.exec(phone);
  if (match === null) {
    return phone;
  }
  const local = `0${match[1] as string}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

export const OPEN_WORK_WARNING = (pending: number, preparing: number, deliveries: number): string =>
  `Quán đang có ${String(pending)} đơn chờ xác nhận, ${String(preparing)} đơn đang chuẩn bị và ${String(deliveries)} lượt giao đang chạy. Vô hiệu hóa không hủy và không tự đổi các đơn/lượt giao này.`;

// ---- the disable / enable popup (pure state machine) -----------------------------------------------------------------------

export type FlowPhase = 'editing' | 'sending' | 'unknown' | 'conflict' | 'done' | 'closed';

export interface FlowView {
  readonly phase: FlowPhase;
  /** A sentence for the status area, if any. */
  readonly message: string | null;
  /** Text for the reason field's error, if any. */
  readonly reasonError: string | null;
}

export function normalizeReason(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function failureMessage(result: ShopCommandResult): string | null {
  switch (result.kind) {
    case 'conflict':
      return 'Quán vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy đọc trạng thái mới trước khi xác nhận lại; lý do bạn nhập được giữ nguyên.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return null;
  }
}

/**
 * One disable / enable intent, from the click on the button to the answer.
 *  - The intent (version, reason, Idempotency-Key) is fixed by the FIRST submit and kept while the result is unknown or the request is only
 *    throttled: a retry sends exactly the same request. While it is sending or unknown the reason is locked and `canDismiss` is false, so the
 *    dialog cannot be closed and the page behind it cannot be reloaded into a second write.
 *  - A conflict (the shop moved on) drops the intent, keeps the typed reason and demands `refreshed(...)` with the NEW version read from the
 *    server before it can be confirmed again, with a new key.
 *  - A refusal (a business "no") changes nothing, drops the intent and lets the person edit and confirm again with a new key.
 */
export class StatusFlow {
  #phase: FlowPhase = 'editing';
  #intent: ShopCommandRequest | undefined;
  #version: number;
  #reason = '';
  #message: string | null = null;
  #reasonError: string | null = null;

  constructor(
    private readonly source: Pick<ShopSource, 'command'>,
    private readonly newKey: () => string,
    private readonly id: string,
    private readonly name: ShopCommandName,
    version: number,
  ) {
    this.#version = version;
  }

  get view(): FlowView {
    return { phase: this.#phase, message: this.#message, reasonError: this.#reasonError };
  }

  get reason(): string {
    return this.#reason;
  }

  get version(): number {
    return this.#version;
  }

  /** The key of the intent in flight (tests and the view's retry label); undefined when no intent exists. */
  get key(): string | undefined {
    return this.#intent?.key;
  }

  /** The reason field and the buttons that leave the dialog are frozen while a write may still be running or its result is unknown. */
  get locked(): boolean {
    return this.#phase === 'sending' || this.#phase === 'unknown';
  }

  get canDismiss(): boolean {
    return !this.locked;
  }

  /** The person typed: kept so a conflict or a refusal never loses it. Ignored while the reason is locked. */
  typed(text: string): void {
    if (!this.locked && this.#intent === undefined) {
      this.#reason = text;
    }
  }

  async submit(): Promise<ShopCommandResult | undefined> {
    if (this.#phase === 'sending' || this.#phase === 'done' || this.#phase === 'closed' || this.#phase === 'conflict') {
      return undefined;
    }
    if (this.#intent === undefined) {
      const reason = normalizeReason(this.#reason);
      if (reason === '' || [...reason].length > REASON_MAX) {
        this.#reasonError = reason === '' ? 'Lý do là bắt buộc.' : `Lý do tối đa ${String(REASON_MAX)} ký tự.`;
        return undefined;
      }
      this.#reasonError = null;
      this.#intent = { id: this.id, name: this.name, version: this.#version, reason, key: this.newKey() };
    }
    this.#phase = 'sending';
    this.#message = null;
    const result = await this.source.command(this.#intent);
    switch (result.kind) {
      case 'ok':
        this.#phase = 'done';
        this.#intent = undefined;
        break;
      case 'unknown':
      case 'rate-limited':
        // The same intent stays: a retry is the same request with the same key.
        this.#phase = 'unknown';
        break;
      case 'conflict':
        this.#phase = 'conflict';
        this.#intent = undefined;
        break;
      case 'refused':
      case 'not-wired':
        this.#phase = 'editing';
        this.#intent = undefined;
        break;
      case 'forbidden':
      case 'session-expired':
        this.#phase = 'closed';
        this.#intent = undefined;
        break;
    }
    this.#message = failureMessage(result);
    return result;
  }

  /** The detail was read again after a conflict: confirm is possible again, against the version just read, with a new key. */
  refreshed(version: number): void {
    if (this.#phase !== 'conflict') {
      return;
    }
    this.#version = version;
    this.#phase = 'editing';
    this.#message = 'Đã đọc trạng thái mới. Kiểm tra lại rồi xác nhận nếu vẫn muốn thực hiện.';
  }

  /** The popup was left (Hủy). Refused while a write may be running. */
  dismiss(): boolean {
    if (!this.canDismiss) {
      return false;
    }
    this.#phase = 'closed';
    return true;
  }
}
