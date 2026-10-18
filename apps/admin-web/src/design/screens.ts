import { AdministratorFilter, AdministratorRow, EMPTY_ADMIN_FILTER, EMPTY_USER_FILTER, LifecycleAction, ListState, LockDialog, NOT_WIRED_REASON, UserDetail, UserDetailState, UserFilter, UserRow, UsersScreen } from '../core/accounts.js';
import { ActivationScreen } from '../core/activation-controller.js';
import { AdminAuthController, Clock, Screen } from '../core/controller.js';
import { ActivationController } from '../core/activation-controller.js';
import { EMPTY_PERMISSIONS } from '../core/inputs.js';
import { COPY } from '../core/messages.js';
import { canOpenRoute, Grants } from '../core/menu.js';
import { FinanceController, FinanceRoute } from '../core/finance-controller.js';
import { FinanceLoad, FinanceSource, NOT_WIRED_FINANCE_REASON, TopupDetail, WithdrawalDetail } from '../core/finance.js';
import { FinanceView } from '../dom/finance-view.js';
import { ComposeDraft, EMPTY_DRAFT, ProvisioningController, ProvisioningScreen } from '../core/provisioning-controller.js';
import { Route } from '../core/routes.js';
import { AdministratorsView, openLockDialog, renderUserDetail, UsersView } from '../dom/accounts-view.js';
import { NOT_WIRED_SETTINGS_REASON, SettingsPhase, SettingsScreen } from '../core/settings.js';
import { SettingsView } from '../dom/settings-view.js';
import { CatalogDialog, CatalogList, CatalogScreen, NOT_WIRED_CATALOG_REASON } from '../core/catalog.js';
import { CatalogView } from '../dom/catalog-view.js';
import { authPage, h } from '../dom/dom.js';
import { ProvisioningView } from '../dom/provisioning-view.js';
import { ActivationPage } from '../dom/activation-view.js';
import { ResetPage, ResetScreen } from '../dom/reset-view.js';
import { buildShell, ShellOptions } from '../dom/shell-layout.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton, statePanel } from '../dom/states.js';
import { AdminView } from '../dom/view.js';
import {
  SAMPLE_LEDGER,
  SAMPLE_LEDGER_MISMATCH,
  SAMPLE_OVERVIEW,
  SAMPLE_TOPUP_DETAIL,
  SAMPLE_TOPUP_DONE,
  SAMPLE_TOPUP_REJECTED,
  SAMPLE_TOPUPS,
  SAMPLE_WALLET_PARAMS,
  SAMPLE_WALLETS,
  SAMPLE_WITHDRAWAL_CANCELLED,
  SAMPLE_WITHDRAWAL_DONE,
  SAMPLE_WITHDRAWAL_PENDING,
  SAMPLE_WITHDRAWAL_PROCESSING,
  SAMPLE_WITHDRAWAL_RECONCILE,
  SAMPLE_WITHDRAWALS,
  SAMPLE_ACTIVATION_LINK, SAMPLE_ADMINISTRATORS, SAMPLE_CATEGORIES, SAMPLE_BUSY_DETAIL, SAMPLE_EMPTY_DETAIL, SAMPLE_LOCKED_DETAIL, SAMPLE_SETTINGS, SAMPLE_LOCKED_USERS, SAMPLE_OTPAUTH, SAMPLE_SECRET, SAMPLE_USER_DETAIL, SAMPLE_USERS, SAMPLE_INVITATIONS, sampleInvitationDetail } from './samples.js';
import { DEMO_NOTICE, DesignContext, DesignScreen, Variant } from './viewer.js';

// The screens of the design preview. Real screens (login, 2FA, invitations, activation, shell, account pages) are drawn
// by the SAME view classes the real app uses, fed with sample screen models; their controllers are stubs that only show
// "this is a demo" when an action is tried. Nothing here can reach a server.

const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/** A controller whose every method only says "demo". `screen` and the countdowns are supplied by the caller. */
function demoController<T extends object>(context: DesignContext, members: Record<string, unknown>): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property === 'string' && property in members) {
          return members[property];
        }
        return () => {
          context.toast(DEMO_NOTICE);
          return Promise.resolve(undefined);
        };
      },
    },
  ) as T;
}

const variants = (...items: readonly (readonly [string, string])[]): readonly Variant[] => items.map(([id, label]) => ({ id, label }));
const pick = <V extends string>(variant: string, table: Record<V, unknown>, fallback: V): V => ((variant in table ? variant : fallback) as V);

// ---- the signed-in frame -----------------------------------------------------------------------------------------------

function screenIdOf(route: Route): { id: string; variant?: string } {
  switch (route.name) {
    case 'users':
      return route.status === 'LOCKED' ? { id: 'users-locked' } : { id: 'users' };
    case 'user':
      return { id: 'user-detail' };
    case 'administrators':
      return { id: 'administrators' };
    case 'settings':
      return { id: 'settings' };
    case 'categories':
      return { id: 'categories' };
    case 'finance':
      return { id: 'finance' };
    case 'finance-wallets':
      return { id: 'finance-wallets' };
    case 'finance-topups':
      return { id: 'finance-topups', ...(route.tab === 'DONE' ? { variant: 'done' } : route.tab === 'ALL' ? { variant: 'all' } : {}) };
    case 'finance-topup':
      return { id: 'finance-topup' };
    case 'finance-withdrawals':
      return { id: 'finance-withdrawals', ...(route.tab === undefined || route.tab === 'PENDING' ? {} : { variant: route.tab === 'NEEDS_RECONCILE' ? 'reconcile' : route.tab.toLowerCase() }) };
    case 'finance-withdrawal':
      return { id: 'finance-withdrawal' };
    case 'finance-transactions':
      return { id: 'finance-transactions', ...(route.shipper === undefined ? {} : { variant: 'shipper' }) };
    case 'finance-reconciliation':
      return { id: 'finance-reconciliation' };
    case 'wallet-params':
      return { id: 'wallet-params' };
    case 'invitations':
      return { id: 'invitations' };
    case 'invitation-new':
      return { id: 'invitation-new' };
    case 'invitation':
      return { id: 'invitation-detail' };
    case 'invitation-reissue':
      return { id: 'invitation-detail', variant: 'reissue' };
    case 'invitation-revoke':
      return { id: 'invitation-detail', variant: 'revoke' };
    // The Shipper pages (M03) have no design-catalog sample: the preview shows the overview.
    case 'finance-bank-accounts':
    case 'shippers':
    case 'shipper':
    case 'wallet-parameters':
    case 'shipping-policy':
    case 'home':
    case 'activate':
    case 'reset':
      return { id: 'overview' };
  }
}

function shellPage(context: DesignContext, route: Route, fill: (content: HTMLElement) => void, initial?: ShellOptions['initial']): HTMLElement {
  const layout = buildShell({ onLogout: () => context.toast(DEMO_NOTICE), ...(initial === undefined ? {} : { initial }) });
  layout.render({
    role: context.role,
    grants: context.grants,
    route,
    navigate: (next) => {
      const target = screenIdOf(next);
      context.go(target.id, target.variant);
    },
  });
  fill(layout.content);
  return layout.root;
}

function forbiddenPage(context: DesignContext, content: HTMLElement): void {
  content.replaceChildren(h('section', { class: 'content content-narrow' }, h('h1', { class: 'title' }, 'Không có quyền'), failurePanel('forbidden', { home: () => context.go('overview') })));
}

function usersAllowed(context: DesignContext): boolean {
  return context.role === 'SYSTEM' || (context.grants as Grants).has('users');
}

// ---- D00-D02: login, second step, Authenticator -----------------------------------------------------------------------

function authScreen(context: DesignContext, screen: Screen): HTMLElement {
  const host = h('div', { class: 'dv-host' });
  const controller = demoController<AdminAuthController>(context, { screen, lockRemainingSeconds: () => 142 });
  new AdminView(host, controller).render(screen);
  return host;
}

const login: DesignScreen = {
  id: 'login',
  code: 'D00',
  title: 'Đăng nhập quản trị',
  group: 'Đăng nhập và bảo mật',
  note: 'Màn thật, đã nối API. Có thêm liên kết “Quên mật khẩu?” tới trang đặt lại (D08).',
  variants: variants(['default', 'Mặc định'], ['wrong', 'Sai thông tin'], ['phone', 'Số điện thoại sai'], ['pending', 'Đang kiểm tra'], ['locked', 'Giới hạn thử'], ['expired', 'Phiên hết hạn'], ['unavailable', 'Mất kết nối'], ['checking', 'Đang kiểm tra phiên']),
  render: (context, variant) => {
    const table: Record<string, Screen> = {
      default: { name: 'login', phone: '', pending: false },
      wrong: { name: 'login', phone: '0909123456', pending: false, formError: COPY.invalidCredentials },
      phone: { name: 'login', phone: '090912', pending: false, phoneError: COPY.invalidPhone },
      pending: { name: 'login', phone: '0909123456', pending: true },
      locked: { name: 'login', phone: '0909123456', pending: false, lock: { untilMs: Date.now() + 142_000 } },
      expired: { name: 'login', phone: '', pending: false, notice: COPY.preauthExpired },
      unavailable: { name: 'unavailable', pending: false },
      checking: { name: 'checking' },
    };
    return authScreen(context, table[pick(variant, table, 'default')]!);
  },
};

const verify: DesignScreen = {
  id: 'verify',
  code: 'D01',
  title: 'Xác thực hai bước (TOTP)',
  group: 'Đăng nhập và bảo mật',
  note: 'Màn thật, đã nối API.',
  variants: variants(['default', 'Mặc định'], ['wrong', 'Mã sai'], ['pending', 'Đang xác thực'], ['locked', 'Giới hạn thử'], ['lost', 'Mất kết quả']),
  render: (context, variant) => {
    const table: Record<string, Screen> = {
      default: { name: 'verify', pending: false, codeReset: 0 },
      wrong: { name: 'verify', pending: false, codeReset: 1, codeError: COPY.totpInvalid },
      pending: { name: 'verify', pending: true, codeReset: 0 },
      locked: { name: 'verify', pending: false, codeReset: 0, lock: { untilMs: Date.now() + 142_000 } },
      lost: { name: 'verify', pending: false, codeReset: 0, notice: COPY.lostResponse },
    };
    return authScreen(context, table[pick(variant, table, 'default')]!);
  },
};

const enroll: DesignScreen = {
  id: 'enroll',
  code: 'D02',
  title: 'Cài đặt Authenticator',
  group: 'Đăng nhập và bảo mật',
  note: 'Màn thật, đã nối API. Mã QR và khóa trong ảnh này là mẫu không dùng được.',
  variants: variants(['default', 'Mã QR'], ['key', 'Hiện khóa thủ công'], ['loading', 'Đang tải mã'], ['error', 'Không tải được mã'], ['wrong', 'Mã sai']),
  render: (context, variant) => {
    const base = { name: 'enroll' as const, pending: false, codeReset: 0, loadingSecret: false, showKey: false, secret: SAMPLE_SECRET, otpauthUri: SAMPLE_OTPAUTH };
    const table: Record<string, Screen> = {
      default: base,
      key: { ...base, showKey: true },
      loading: { ...base, loadingSecret: true, secret: undefined, otpauthUri: undefined },
      error: { ...base, secret: undefined, otpauthUri: undefined, secretError: COPY.unavailable },
      wrong: { ...base, codeReset: 1, codeError: COPY.totpInvalid },
    };
    return authScreen(context, table[pick(variant, table, 'default')]!);
  },
};

// ---- D08 reset, D09 SYSTEM recovery -----------------------------------------------------------------------------------

function resetPage(context: DesignContext, screen: ResetScreen, wired: boolean): HTMLElement {
  const host = h('div', { class: 'dv-host' });
  const demo = (): void => context.toast(DEMO_NOTICE);
  new ResetPage(host, { wired, sendCode: demo, verify: demo, resend: demo, setPassword: demo, toLogin: () => context.go('login') }).render(screen);
  return host;
}

const reset: DesignScreen = {
  id: 'reset',
  code: 'D08',
  title: 'Đặt lại mật khẩu Admin',
  group: 'Đăng nhập và bảo mật',
  note: 'Trang công khai /reset. Bản thật dựng đủ layout nhưng nút gửi bị khóa kèm lý do vì chưa có backend (M01.16, form M01.19). Các trạng thái dưới đây xem ở chế độ thiết kế.',
  variants: variants(['phone', 'Nhập SĐT'], ['phone-error', 'SĐT sai'], ['otp', 'Nhập OTP'], ['otp-invalid', 'OTP sai'], ['otp-expired', 'OTP hết hạn'], ['otp-locked', 'OTP bị khóa'], ['password', 'Mật khẩu mới'], ['password-error', 'Mật khẩu lỗi'], ['done', 'Hoàn tất'], ['rate-limited', 'Giới hạn gửi mã'], ['live', 'Bản thật (chưa nối)']),
  render: (context, variant) => {
    const table: Record<string, ResetScreen> = {
      phone: { name: 'phone', phone: '', pending: false },
      'phone-error': { name: 'phone', phone: '09091', pending: false, phoneError: 'Số điện thoại không hợp lệ.' },
      otp: { name: 'otp', phoneMasked: '098•••• 123', pending: false, resendSec: 59 },
      'otp-invalid': { name: 'otp', phoneMasked: '098•••• 123', pending: false, codeError: 'invalid' },
      'otp-expired': { name: 'otp', phoneMasked: '098•••• 123', pending: false, codeError: 'expired', resendSec: 0 },
      'otp-locked': { name: 'otp', phoneMasked: '098•••• 123', pending: false, codeError: 'locked' },
      password: { name: 'password', pending: false },
      'password-error': { name: 'password', pending: false, error: 'Hai mật khẩu chưa khớp.' },
      done: { name: 'done' },
      'rate-limited': { name: 'rate-limited', retrySec: 272 },
      live: { name: 'phone', phone: '', pending: false },
    };
    return resetPage(context, table[pick(variant, table, 'phone')]!, variant !== 'live');
  },
};

const recovery: DesignScreen = {
  id: 'recovery',
  code: 'D09',
  title: 'Khôi phục tài khoản SYSTEM',
  group: 'Đăng nhập và bảo mật',
  note: 'Chỉ có ở bản xem thiết kế: SYSTEM khôi phục bằng công cụ trên máy chủ, không có biểu mẫu công khai (chờ quyết định D05 và gói M01.20).',
  variants: variants(['default', 'Mặc định']),
  render: () =>
    authPage(
      h(
        'section',
        { class: 'card' },
        h('h1', { class: 'title' }, 'Khôi phục tài khoản SYSTEM'),
        h('p', { class: 'message message-notice', role: 'note' }, 'Tài khoản SYSTEM không khôi phục qua trang web. Không có biểu mẫu khôi phục công khai.'),
        h('p', { class: 'lead' }, 'Trường hợp mất thiết bị hoặc không truy cập được, hãy dùng công cụ quản trị trên máy chủ theo quy trình vận hành đã duyệt.'),
      ),
    ),
};

// ---- D03: frame, overview ---------------------------------------------------------------------------------------------

function homeContent(context: DesignContext): HTMLElement {
  return h(
    'section',
    { class: 'content content-narrow', 'aria-labelledby': 'shell-title' },
    h('h1', { class: 'title', tabindex: '-1', id: 'shell-title' }, 'Đăng nhập thành công'),
    h('p', { class: 'lead lead-last' }, 'Vai trò: ', h('span', { class: 'role-badge' }, context.role)),
    h('p', { class: 'lead' }, context.role === 'SYSTEM' ? 'Dùng menu bên trái để mời và quản lý tài khoản ADMIN. Các mục có nhãn “Sắp có” sẽ được mở ở bước sau.' : 'Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau.'),
  );
}

const overview: DesignScreen = {
  id: 'overview',
  code: 'D03',
  title: 'Khung quản trị và sidebar',
  group: 'Khung quản trị',
  note: 'Sidebar mở rộng 240 px, thu gọn 64 px, drawer dưới 900 px. Chuyển vai trò ở thanh trên: ADMIN chỉ thấy mục được cấp quyền. Bản thật chưa nhận quyền ADMIN từ máy chủ nên ADMIN thật chỉ thấy “Tổng quan”.',
  variants: variants(['expanded', 'Mở rộng 240px'], ['collapsed', 'Thu gọn 64px'], ['account-menu', 'Menu tài khoản'], ['drawer', 'Drawer (cửa sổ hẹp)']),
  render: (context, variant) => {
    const initial: ShellOptions['initial'] =
      variant === 'collapsed' ? { collapsed: true } : variant === 'account-menu' ? { accountMenuOpen: true } : variant === 'drawer' ? { drawerOpen: true } : {};
    return shellPage(context, { name: 'home' }, (content) => content.replaceChildren(homeContent(context)), initial);
  },
};

// ---- D81: users ---------------------------------------------------------------------------------------------------------

function usersPage(context: DesignContext, route: Route, filter: UserFilter, state: ListState<UserRow>): HTMLElement {
  return shellPage(context, route, (content) => {
    if (!usersAllowed(context)) {
      forbiddenPage(context, content);
      return;
    }
    const demo = (): void => context.toast(DEMO_NOTICE);
    const view = new UsersView(content, { wired: state.kind !== 'not-wired', filter: demo, refresh: demo, retry: demo, login: () => context.go('login'), home: () => context.go('overview'), open: () => context.go('user-detail'), loadMore: demo });
    const screen: UsersScreen = { name: 'users', filter, state };
    view.render(screen);
  });
}

const USERS_VARIANTS = variants(['rows', 'Có dữ liệu'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['search-empty', 'Tìm không thấy'], ['offline', 'Mất mạng'], ['timeout', 'Quá thời gian'], ['expired', 'Hết phiên'], ['forbidden', 'Không có quyền'], ['rate', 'Giới hạn'], ['live', 'Bản thật (chưa nối)']);

function usersState(variant: string, rows: readonly UserRow[]): { filter: UserFilter; state: ListState<UserRow> } {
  switch (variant) {
    case 'loading':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'loading' } };
    case 'empty':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'empty' } };
    case 'search-empty':
      return { filter: { query: 'Nguyễn Văn Z', role: 'ALL', status: 'ALL' }, state: { kind: 'empty' } };
    case 'offline':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'failed', failure: 'offline' } };
    case 'timeout':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'failed', failure: 'timeout' } };
    case 'expired':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'failed', failure: 'session-expired' } };
    case 'forbidden':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'failed', failure: 'forbidden' } };
    case 'rate':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'failed', failure: 'rate-limited', retryAfterSec: 38 } };
    case 'live':
      return { filter: EMPTY_USER_FILTER, state: { kind: 'not-wired', reason: 'Danh sách người dùng chờ máy chủ (gói M01.30). Chưa có dữ liệu thật nên không hiển thị dòng nào.' } };
    default:
      return { filter: EMPTY_USER_FILTER, state: { kind: 'rows', rows, nextCursor: null } };
  }
}

const users: DesignScreen = {
  id: 'users',
  code: 'D81',
  title: 'Người dùng — danh sách',
  group: 'Tài khoản',
  note: 'Menu Tài khoản → Người dùng → Danh sách. Bản thật chưa nối API (gói M01.30): hiện trạng thái “Chưa kết nối máy chủ”, không có dòng nào.',
  variants: USERS_VARIANTS,
  render: (context, variant) => {
    const { filter, state } = usersState(variant, SAMPLE_USERS);
    return usersPage(context, { name: 'users' }, filter, state);
  },
};

const usersLocked: DesignScreen = {
  id: 'users-locked',
  code: 'D81',
  title: 'Người dùng — đang khóa',
  group: 'Tài khoản',
  note: 'Menu Người dùng → Đang khóa: cùng trang D81 với bộ lọc trạng thái “Đang khóa”.',
  variants: variants(['rows', 'Có dữ liệu'], ['empty', 'Trống'], ['live', 'Bản thật (chưa nối)']),
  render: (context, variant) => {
    const filter: UserFilter = { ...EMPTY_USER_FILTER, status: 'LOCKED' };
    const state: ListState<UserRow> =
      variant === 'empty' ? { kind: 'empty' } : variant === 'live' ? usersState('live', []).state : { kind: 'rows', rows: SAMPLE_LOCKED_USERS, nextCursor: null };
    return usersPage(context, { name: 'users', status: 'LOCKED' }, filter, state);
  },
};

// ---- D86-D88: one user --------------------------------------------------------------------------------------------------

function detailPage(context: DesignContext, state: UserDetailState, after?: (user: UserDetail) => void): HTMLElement {
  return shellPage(context, { name: 'user', id: SAMPLE_USERS[1]!.id }, (content) => {
    if (!usersAllowed(context)) {
      forbiddenPage(context, content);
      return;
    }
    const demo = (): void => context.toast(DEMO_NOTICE);
    content.replaceChildren(
      renderUserDetail({ name: 'user', id: SAMPLE_USERS[1]!.id, state }, { wired: state.kind !== 'not-wired', back: () => context.go('users'), reload: demo, retry: demo, login: () => context.go('login'), home: () => context.go('overview'), action: (action) => context.go(action === 'LOCK' ? 'user-lock' : action === 'DELETE' ? 'user-delete' : 'user-unlock') }),
    );
    if (after !== undefined && state.kind === 'ready') {
      const user = state.user;
      context.onMounted(() => after(user));
    }
  });
}

const userDetail: DesignScreen = {
  id: 'user-detail',
  code: 'D86',
  title: 'Người dùng — chi tiết',
  group: 'Tài khoản',
  note: 'Bản thật chưa nối (gói M01.30; khóa/mở khóa gói M01.32 và M01.33). Nút khóa/mở khóa chỉ hiện khi máy chủ cho phép (allowed_actions).',
  variants: variants(['active', 'Đang hoạt động'], ['locked', 'Đang khóa (theo yêu cầu xóa)'], ['empty', 'Không có dữ liệu liên quan'], ['busy', 'Còn đơn đang xử lý'], ['no-actions', 'Không có thao tác'], ['loading', 'Đang tải'], ['not-found', 'Không tìm thấy'], ['offline', 'Mất mạng'], ['live', 'Bản thật (chưa nối)']),
  render: (context, variant) => {
    const state: UserDetailState =
      variant === 'locked'
        ? { kind: 'ready', user: SAMPLE_LOCKED_DETAIL }
        : variant === 'empty'
          ? { kind: 'ready', user: SAMPLE_EMPTY_DETAIL }
          : variant === 'busy'
            ? { kind: 'ready', user: SAMPLE_BUSY_DETAIL }
            : variant === 'no-actions'
          ? { kind: 'ready', user: { ...SAMPLE_USER_DETAIL, allowedActions: [] } }
          : variant === 'loading'
            ? { kind: 'loading' }
            : variant === 'not-found'
              ? { kind: 'not-found' }
              : variant === 'offline'
                ? { kind: 'failed', failure: 'offline' }
                : variant === 'live'
                  ? { kind: 'not-wired', reason: 'Chi tiết người dùng chờ máy chủ (gói M01.30). Khóa và mở khóa chờ gói M01.32.' }
                  : { kind: 'ready', user: SAMPLE_USER_DETAIL };
    return detailPage(context, state);
  },
};

function lockScreen(action: LifecycleAction, code: string, title: string, forms: readonly (readonly [string, string])[]): DesignScreen {
  return {
    id: action === 'LOCK' ? 'user-lock' : action === 'DELETE' ? 'user-delete' : 'user-unlock',
    code,
    title,
    group: 'Tài khoản',
    note: 'Hộp thoại xác nhận có lý do bắt buộc (1–500 ký tự). Chờ gói M01.32 (máy chủ) và M01.33 (nối giao diện): bản thật không có hộp thoại này.',
    variants: variants(...forms),
    render: (context, variant) => {
      const user = action === 'LOCK' ? SAMPLE_USER_DETAIL : action === 'DELETE' ? (variant === 'permanent' ? SAMPLE_EMPTY_DETAIL : SAMPLE_USER_DETAIL) : SAMPLE_LOCKED_DETAIL;
      const table: Record<string, LockDialog> = {
        form: { action, reason: '', phase: 'form' },
        'reason-error': { action, reason: '', phase: 'form', error: 'Nhập lý do.' },
        filled: { action, reason: 'Nhiều phản ánh về đơn hàng trong ngày.', phase: 'form' },
        working: { action, reason: 'Nhiều phản ánh về đơn hàng trong ngày.', phase: 'working' },
        unknown: { action, reason: 'Nhiều phản ánh về đơn hàng trong ngày.', phase: 'unknown' },
        conflict: { action, reason: 'Nhiều phản ánh về đơn hàng trong ngày.', phase: 'conflict' },
        failed: { action, reason: 'Nhiều phản ánh về đơn hàng trong ngày.', phase: 'failed', error: 'Chưa thể thực hiện. Vui lòng thử lại.' },
      };
      const dialog = table[pick(variant, table, 'form')]!;
      const demo = (): void => context.toast(DEMO_NOTICE);
      return detailPage(context, { kind: 'ready', user }, (detail) => {
        openLockDialog(detail, dialog, { submit: demo, cancel: () => context.go('user-detail'), recheck: demo, retry: demo, reload: demo }, context.frame);
      });
    },
  };
}

const userLock = lockScreen('LOCK', 'D87', 'Khóa người dùng — hộp thoại', [['form', 'Mặc định'], ['reason-error', 'Thiếu lý do'], ['filled', 'Đã nhập lý do'], ['working', 'Đang gửi'], ['unknown', 'Chưa rõ kết quả'], ['conflict', 'Xung đột dữ liệu'], ['failed', 'Lỗi']]);
const userDelete = lockScreen('DELETE', 'D90', 'Xóa người dùng — hộp thoại', [['form', 'Có dữ liệu liên quan (chuyển sang khóa)'], ['permanent', 'Không có dữ liệu (xóa vĩnh viễn)'], ['reason-error', 'Thiếu lý do'], ['working', 'Đang gửi'], ['failed', 'Lỗi (còn đơn đang xử lý)']]);
const userUnlock = lockScreen('UNLOCK', 'D88', 'Mở khóa người dùng — hộp thoại', [['form', 'Mặc định'], ['reason-error', 'Thiếu lý do'], ['working', 'Đang gửi'], ['unknown', 'Chưa rõ kết quả']]);

// ---- administrators -----------------------------------------------------------------------------------------------------

const administrators: DesignScreen = {
  id: 'administrators',
  code: 'D89',
  title: 'Quản trị viên — danh sách',
  group: 'Tài khoản',
  note: 'Chỉ SYSTEM. Mã D89 do Owner chốt (đã thêm vào catalog) và chưa có ảnh duyệt riêng; bố cục theo D81. Bản thật chưa nối vì chưa có hợp đồng API đọc danh sách quản trị viên; không tạo/sửa/xóa ở đây.',
  variants: variants(['rows', 'Có dữ liệu'], ['empty', 'Trống'], ['no-match', 'Không khớp tìm kiếm'], ['loading', 'Đang tải'], ['error', 'Lỗi tải'], ['live', 'Bản thật (chưa nối)']),
  render: (context, variant) =>
    shellPage(context, { name: 'administrators' }, (content) => {
      if (context.role !== 'SYSTEM') {
        forbiddenPage(context, content);
        return;
      }
      const demo = (): void => context.toast(DEMO_NOTICE);
      let filter: AdministratorFilter = variant === 'no-match' ? { query: 'zzz', status: 'ALL' } : EMPTY_ADMIN_FILTER;
      const stateFor = (): ListState<AdministratorRow> => {
        if (variant === 'empty') return { kind: 'empty' };
        if (variant === 'loading') return { kind: 'loading' };
        if (variant === 'error') return { kind: 'failed', failure: 'offline' };
        if (variant === 'live') return { kind: 'not-wired', reason: NOT_WIRED_REASON.administrators };
        const query = filter.query.trim().toLowerCase();
        const rows = SAMPLE_ADMINISTRATORS.filter((row) => (filter.status === 'ALL' || row.status === filter.status) && (query === '' || row.fullName.toLowerCase().includes(query) || row.phoneMasked.includes(query)));
        return rows.length === 0 ? { kind: 'empty' } : { kind: 'rows', rows, nextCursor: null };
      };
      const view: AdministratorsView = new AdministratorsView(content, {
        retry: demo,
        login: () => context.go('login'),
        home: () => context.go('overview'),
        invite: () => context.go('invitation-new'),
        wired: variant !== 'live',
        filter: (next) => {
          filter = next;
          view.render({ name: 'administrators', filter, state: stateFor() });
        },
        refresh: demo,
      });
      view.render({ name: 'administrators', filter, state: stateFor() });
    }),
};


// ---- M04-A01 ... A07: finance (sample data) -----------------------------------------------------------------------------------
// The SAME FinanceController and FinanceView the real app uses, fed with a sample source: search, tabs, filters, paging and the form drafts
// really work in the preview; the buttons that would change money only say "demo". Every screen is under the banner "Dữ liệu minh họa".

const GENERIC_STATES = [['loading', 'Đang tải'], ['empty', 'Trống'], ['offline', 'Mất mạng'], ['live', 'Bản thật (chưa nối)']] as const;

function sampleFinance(variant: string, data: { readonly topup?: TopupDetail; readonly withdrawal?: WithdrawalDetail; readonly ledger?: typeof SAMPLE_LEDGER }): FinanceSource {
  const wrap = <T,>(value: T): Promise<FinanceLoad<T>> => {
    switch (variant) {
      case 'loading':
        return new Promise(() => undefined);
      case 'empty':
        return Promise.resolve({ kind: 'empty', filtered: false });
      case 'offline':
        return Promise.resolve({ kind: 'failed', failure: 'offline' });
      case 'live':
        return Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_FINANCE_REASON });
      default:
        return Promise.resolve({ kind: 'ready', data: value });
    }
  };
  return {
    overview: () => wrap(SAMPLE_OVERVIEW),
    wallets: () => wrap(SAMPLE_WALLETS),
    topups: () => wrap(SAMPLE_TOPUPS),
    topup: () => wrap(data.topup ?? SAMPLE_TOPUP_DETAIL),
    withdrawals: () => wrap(SAMPLE_WITHDRAWALS),
    withdrawal: () => wrap(data.withdrawal ?? SAMPLE_WITHDRAWAL_PENDING),
    ledger: () => wrap(data.ledger ?? SAMPLE_LEDGER),
    params: () => wrap(SAMPLE_WALLET_PARAMS),
  };
}

function financePage(context: DesignContext, route: FinanceRoute, variant: string, source: FinanceSource, setup?: (controller: FinanceController) => void): HTMLElement {
  return shellPage(context, route, (content) => {
    if (!canOpenRoute(context.role, context.grants, route)) {
      forbiddenPage(context, content);
      return;
    }
    const demo = (): void => context.toast(DEMO_NOTICE);
    const controller = new FinanceController({ source, route, onSessionLost: demo, onForbidden: demo });
    const view = new FinanceView(content, {
      wired: variant !== 'live',
      retry: () => controller.load(),
      login: () => context.go('login'),
      home: () => context.go('overview'),
      refresh: () => controller.load(),
      open: (next) => {
        const target = screenIdOf(next);
        context.go(target.id, target.variant);
      },
      search: (query) => controller.search(query),
      page: (page) => controller.page(page),
      ledgerFilter: (next) => controller.ledgerFilter(next),
      topupDraft: (draft) => controller.topupDraft(draft),
      topupAttempt: (action) => controller.attemptTopup(action),
      topupDecide: demo,
      withdrawalAct: demo,
      paramsDraft: (draft) => controller.paramsDraft(draft),
      paramsAttempt: () => controller.attemptParams(),
      paramsSave: demo,
      paramsReset: () => controller.resetParams(),
      exportLedger: demo,
    });
    controller.subscribe((screen) => view.render(screen));
    setup?.(controller);
    view.render(controller.screen);
    controller.load();
  });
}

const financeOverview: DesignScreen = {
  id: 'finance',
  code: 'M04-A01',
  title: 'Tài chính — Tổng quan',
  group: 'Tài chính',
  note: 'Thẻ KPI (tổng số dư, tiền tạm giữ, yêu cầu nạp/rút chờ, hoa hồng đã thu, giao dịch hôm nay), lọc thời gian và biểu đồ cột nạp/rút/hoa hồng theo ngày. Tiền tạm giữ là thông tin giữ chỗ, không phải khoản trừ sổ cái. Bản thật chưa nối: không có số liệu giả.',
  variants: variants(['rows', 'Có dữ liệu'], ...GENERIC_STATES),
  render: (context, variant) => financePage(context, { name: 'finance' }, variant, sampleFinance(variant, {})),
};

const financeWallets: DesignScreen = {
  id: 'finance-wallets',
  code: 'M04-A02',
  title: 'Tài chính — Danh sách ví Shipper',
  group: 'Tài chính',
  note: 'Tìm theo tên/SĐT/mã; bảng tổng số dư, tạm giữ, khả dụng (= tổng − tạm giữ), trạng thái; phân trang 10 ví/trang. “Xem” mở lịch sử giao dịch của Shipper đó. Xuất Excel chưa nối (cần quyền riêng).',
  variants: variants(['rows', 'Có dữ liệu'], ['no-results', 'Tìm không thấy'], ...GENERIC_STATES),
  render: (context, variant) => financePage(context, { name: 'finance-wallets' }, variant, sampleFinance(variant, {}), (controller) => (variant === 'no-results' ? controller.search('Không có tên này') : undefined)),
};

const financeTopups: DesignScreen = {
  id: 'finance-topups',
  code: 'M04-A03',
  title: 'Tài chính — Yêu cầu nạp tiền',
  group: 'Tài chính',
  note: 'Tab Chờ xác nhận / Đã xử lý / Tất cả (có số lượng), tìm theo tên/SĐT/mã, bảng theo Shipper, số tiền, thời điểm, trạng thái; “Xem” mở chi tiết xác nhận.',
  variants: variants(['rows', 'Chờ xác nhận'], ['done', 'Đã xử lý'], ['all', 'Tất cả'], ['no-results', 'Tìm không thấy'], ...GENERIC_STATES),
  render: (context, variant) =>
    financePage(context, { name: 'finance-topups', ...(variant === 'done' ? { tab: 'DONE' as const } : variant === 'all' ? { tab: 'ALL' as const } : {}) }, variant, sampleFinance(variant, {}), (controller) => (variant === 'no-results' ? controller.search('Không có tên này') : undefined)),
};

const financeTopup: DesignScreen = {
  id: 'finance-topup',
  code: 'M04-A04',
  title: 'Tài chính — Chi tiết xác nhận nạp tiền',
  group: 'Tài chính',
  note: 'Thông tin yêu cầu, chứng từ đính kèm và khối xác minh: số tiền ngân hàng thực nhận, mã giao dịch chuẩn, ghi chú; Xác nhận / Từ chối. Chỉ Admin ghi nhận tiền nạp, sau khi đối chiếu sao kê; số tiền thực nhận khác đề nghị chỉ cảnh báo. Bản xem trước không cộng ví.',
  variants: variants(['rows', 'Chờ xác nhận'], ['errors', 'Thiếu thông tin khi xác nhận'], ['mismatch', 'Số tiền thực nhận khác đề nghị'], ['no-proof', 'Không có ảnh'], ['done', 'Đã xác nhận'], ['rejected', 'Đã từ chối'], ['not-found', 'Không tìm thấy'], ...GENERIC_STATES.filter(([id]) => id !== 'empty')),
  render: (context, variant) => {
    const detail = variant === 'done' ? SAMPLE_TOPUP_DONE : variant === 'rejected' ? SAMPLE_TOPUP_REJECTED : variant === 'no-proof' ? { ...SAMPLE_TOPUP_DETAIL, proofName: null } : SAMPLE_TOPUP_DETAIL;
    const source = sampleFinance(variant === 'not-found' ? 'empty' : variant, { topup: detail });
    return financePage(context, { name: 'finance-topup', id: SAMPLE_TOPUP_DETAIL.id }, variant, source, (controller) => {
      if (variant === 'errors') {
        controller.attemptTopup('confirm');
      } else if (variant === 'mismatch') {
        controller.topupDraft({ actualAmount: '90000', bankReference: 'FT26288MINHHOA02', note: '' });
      }
    });
  },
};

const financeWithdrawals: DesignScreen = {
  id: 'finance-withdrawals',
  code: 'M04-A05',
  title: 'Tài chính — Danh sách yêu cầu rút tiền',
  group: 'Tài chính',
  note: 'Bộ lọc Chờ xử lý / Đang xử lý / Đã hoàn thành / Cần đối soát / Tất cả (có số lượng). Shipper tự tạo yêu cầu trên ứng dụng (UI đã duyệt); Admin xử lý. Lưu ý: ADR-004 bản cũ ghi Admin tạo yêu cầu rút — cần đồng bộ hợp đồng nghiệp vụ trước backend.',
  variants: variants(['rows', 'Chờ xử lý'], ['processing', 'Đang xử lý'], ['completed', 'Đã hoàn thành'], ['reconcile', 'Cần đối soát'], ['all', 'Tất cả'], ['no-results', 'Tìm không thấy'], ...GENERIC_STATES),
  render: (context, variant) => {
    const tab = { processing: 'PROCESSING', completed: 'COMPLETED', reconcile: 'NEEDS_RECONCILE', all: 'ALL' } as const;
    const picked = variant in tab ? tab[variant as keyof typeof tab] : undefined;
    return financePage(context, { name: 'finance-withdrawals', ...(picked === undefined ? {} : { tab: picked }) }, variant, sampleFinance(variant, {}), (controller) => (variant === 'no-results' ? controller.search('Không có tên này') : undefined));
  },
};

const financeWithdrawal: DesignScreen = {
  id: 'finance-withdrawal',
  code: 'M04-A05',
  title: 'Tài chính — Chi tiết yêu cầu rút tiền',
  group: 'Tài chính',
  note: 'Thông tin yêu cầu, snapshot tài khoản nhận (không đổi khi Shipper đổi ngân hàng), tiến trình và thao tác theo trạng thái: Nhận xử lý → Xác nhận đã chuyển / Cần đối soát → Đối soát. Chưa biết kết quả chuyển khoản thì giữ tiền, không chuyển lại hay giải phóng tự động.',
  variants: variants(['rows', 'Chờ xử lý'], ['processing', 'Đang xử lý'], ['reconcile', 'Cần đối soát'], ['done', 'Hoàn thành'], ['cancelled', 'Đã hủy'], ['not-found', 'Không tìm thấy'], ...GENERIC_STATES.filter(([id]) => id !== 'empty')),
  render: (context, variant) => {
    const detail = { processing: SAMPLE_WITHDRAWAL_PROCESSING, reconcile: SAMPLE_WITHDRAWAL_RECONCILE, done: SAMPLE_WITHDRAWAL_DONE, cancelled: SAMPLE_WITHDRAWAL_CANCELLED }[variant as 'processing'] ?? SAMPLE_WITHDRAWAL_PENDING;
    return financePage(context, { name: 'finance-withdrawal', id: detail.id }, variant, sampleFinance(variant === 'not-found' ? 'empty' : variant, { withdrawal: detail }));
  },
};

const financeTransactions: DesignScreen = {
  id: 'finance-transactions',
  code: 'M04-A06',
  title: 'Tài chính — Lịch sử giao dịch',
  group: 'Tài chính',
  note: 'Lọc theo ngày, Shipper, loại, trạng thái; bảng sổ cái và tạm giữ. Dòng tạm giữ/giải phóng chỉ là thông tin phần đang giữ: không đổi tổng số dư, không hiển thị như tiền nạp. Xuất Excel chưa nối.',
  variants: variants(['rows', 'Có dữ liệu'], ['shipper', 'Lọc theo Shipper'], ['no-results', 'Lọc không có kết quả'], ...GENERIC_STATES),
  render: (context, variant) =>
    financePage(context, { name: 'finance-transactions', ...(variant === 'shipper' ? { shipper: 'Nguyễn Văn A' } : {}) }, variant, sampleFinance(variant, {}), (controller) => (variant === 'no-results' ? controller.ledgerFilter({ type: 'WITHDRAW', status: 'FAILED' }) : undefined)),
};

const financeReconciliation: DesignScreen = {
  id: 'finance-reconciliation',
  code: 'M04-A06',
  title: 'Tài chính — Đối soát',
  group: 'Tài chính',
  note: 'So tổng sổ cái với tổng số dư ví và chỉ ra chênh lệch như nó là. Không có nút sửa số dư: sai lệch phải đi qua quy trình điều chỉnh có quyền và lý do.',
  variants: variants(['rows', 'Khớp'], ['mismatch', 'Có chênh lệch'], ...GENERIC_STATES),
  render: (context, variant) => financePage(context, { name: 'finance-reconciliation' }, variant, sampleFinance(variant, variant === 'mismatch' ? { ledger: SAMPLE_LEDGER_MISMATCH } : {})),
};

const walletParams: DesignScreen = {
  id: 'wallet-params',
  code: 'M04-A07',
  title: 'Cài đặt › Tham số hệ thống › Ví Shipper',
  group: 'Hệ thống',
  note: 'Nạp tối thiểu 100.000đ, rút tối thiểu 10.000đ, hoa hồng 1.000đ/đơn thành công (mặc định tham khảo). Chỉ Admin Web, có nhật ký thay đổi. Giai đoạn giao diện: chưa lưu vào cơ sở dữ liệu.',
  variants: variants(['rows', 'Mặc định'], ['changed', 'Đã sửa, chưa lưu'], ['errors', 'Giá trị không hợp lệ'], ...GENERIC_STATES),
  render: (context, variant) =>
    financePage(context, { name: 'wallet-params' }, variant, sampleFinance(variant, {}), (controller) => {
      if (variant === 'changed') {
        controller.paramsDraft({ minTopup: '200000', minWithdraw: '10000', commissionPerOrder: '1000' });
      } else if (variant === 'errors') {
        controller.paramsDraft({ minTopup: '0', minWithdraw: 'abc', commissionPerOrder: '1000' });
        controller.attemptParams();
      }
    }),
};

// ---- D91: system settings ------------------------------------------------------------------------------------------------

const settings: DesignScreen = {
  id: 'settings',
  code: 'D91',
  title: 'Cài đặt hệ thống — Xác thực số điện thoại',
  group: 'Hệ thống',
  note: 'Chỉ SYSTEM. Hai công tắc độc lập (OTP khi đăng ký, OTP khi quên mật khẩu), mặc định Bật; có Lưu/Hủy và lịch sử thay đổi (giá trị cũ/mới, người thực hiện, thời gian). Có hiệu lực ngay, không cần khởi động lại. ADMIN không thấy mục này.',
  variants: variants(['default', 'Mặc định (cả hai bật)'], ['changed', 'Đã sửa, chưa lưu'], ['working', 'Đang lưu'], ['saved', 'Đã lưu'], ['unknown', 'Chưa rõ kết quả'], ['conflict', 'Xung đột dữ liệu'], ['failed', 'Lỗi'], ['loading', 'Đang tải'], ['offline', 'Mất mạng'], ['live', 'Bản thật (chưa nối)']),
  render: (context, variant) =>
    shellPage(context, { name: 'settings' }, (content) => {
      if (context.role !== 'SYSTEM') {
        forbiddenPage(context, content);
        return;
      }
      const demo = (): void => context.toast(DEMO_NOTICE);
      const base = { ...SAMPLE_SETTINGS, otpRegistrationEnabled: true, otpPasswordResetEnabled: true, version: 0, updatedAt: null, history: [] };
      const phase: SettingsPhase = variant === 'working' ? 'working' : variant === 'saved' ? 'saved' : variant === 'unknown' ? 'unknown' : variant === 'conflict' ? 'conflict' : variant === 'failed' ? 'failed' : 'idle';
      const screen: SettingsScreen =
        variant === 'loading'
          ? { name: 'settings', state: { kind: 'loading' }, phase: 'idle' }
          : variant === 'offline'
            ? { name: 'settings', state: { kind: 'failed', failure: 'offline' }, phase: 'idle' }
            : variant === 'live'
              ? { name: 'settings', state: { kind: 'not-wired', reason: NOT_WIRED_SETTINGS_REASON }, phase: 'idle' }
              : {
                  name: 'settings',
                  state: { kind: 'ready', settings: variant === 'default' || variant === 'changed' ? base : SAMPLE_SETTINGS },
                  ...(variant === 'changed' || variant === 'working' || variant === 'unknown' ? { draft: { otpRegistrationEnabled: false, otpPasswordResetEnabled: true } } : {}),
                  phase,
                  ...(variant === 'failed' ? { error: 'Chưa thể lưu. Vui lòng thử lại.' } : {}),
                };
      const view: SettingsView = new SettingsView(content, {
        wired: variant !== 'live',
        change: demo,
        save: demo,
        cancel: demo,
        recheck: demo,
        retry: demo,
        reload: demo,
        login: () => context.go('login'),
        home: () => context.go('overview'),
      });
      view.render(screen);
    }),
};

// ---- D92: dish groups ----------------------------------------------------------------------------------------------------

const GROUPS_PAGE = SAMPLE_CATEGORIES.slice(0, 10);
const readyList = (rows = GROUPS_PAGE, total = 23): CatalogList => ({ kind: 'ready', rows, total, pages: Math.ceil(total / 10), nextSortOrder: 24 });
const FORM_DRAFT = { name: 'Món chay', sortOrder: '24', status: 'ACTIVE' } as const;
const EDIT_DRAFT = { name: 'Hải sản', sortOrder: '2', status: 'ACTIVE' } as const;
const EDIT_ID = SAMPLE_CATEGORIES[1]!.id;
const TOGGLE_ROW = SAMPLE_CATEGORIES[4]!;

const categories: DesignScreen = {
  id: 'categories',
  code: 'D92',
  title: 'Danh mục — Nhóm món',
  group: 'Danh mục',
  note: 'SYSTEM, hoặc ADMIN được cấp quyền “Nhóm món” (quyền kiểm tra lại ở máy chủ). Tìm theo tên, lọc Tất cả / Đang dùng / Ngừng dùng, phân trang 10 nhóm/trang; thêm/sửa bằng popup; ngừng dùng có xác nhận, không có nút xóa. Ngừng dùng một nhóm không làm mất món đã gắn nhóm.',
  variants: variants(
    ['list', 'Có dữ liệu'],
    ['loading', 'Đang tải'],
    ['empty', 'Chưa có nhóm'],
    ['no-results', 'Không có kết quả tìm'],
    ['error', 'Lỗi tải (có Thử lại)'],
    ['offline', 'Mất mạng'],
    ['add', 'Thêm nhóm'],
    ['add-error', 'Thêm: thiếu tên, thứ tự sai'],
    ['add-taken', 'Thêm: trùng tên'],
    ['add-twin', 'Thêm: trùng nhóm ngừng dùng'],
    ['edit', 'Sửa nhóm'],
    ['saving', 'Đang lưu (khóa form)'],
    ['unknown', 'Chưa rõ kết quả'],
    ['conflict', 'Xung đột dữ liệu'],
    ['failed', 'Lỗi khi lưu'],
    ['deactivate', 'Xác nhận ngừng dùng'],
    ['activate', 'Xác nhận kích hoạt lại'],
    ['live', 'Bản thật (chưa nối)'],
  ),
  render: (context, variant) =>
    shellPage(context, { name: 'categories' }, (content) => {
      if (context.role !== 'SYSTEM' && !(context.grants as Grants).has('catalog')) {
        forbiddenPage(context, content);
        return;
      }
      const demo = (): void => context.toast(DEMO_NOTICE);
      const filter = { query: variant === 'no-results' ? 'xyz' : '', status: 'ALL' as const, page: 1 };
      const lists: Record<string, CatalogList> = {
        loading: { kind: 'loading' },
        empty: { kind: 'empty', filtered: false },
        'no-results': { kind: 'empty', filtered: true },
        error: { kind: 'failed', failure: 'unknown' },
        offline: { kind: 'failed', failure: 'offline' },
        live: { kind: 'not-wired', reason: NOT_WIRED_CATALOG_REASON },
      };
      const list = lists[variant] ?? readyList();
      const form = (mode: 'create' | 'edit', extra: Partial<Extract<CatalogDialog, { kind: 'form' }>>): CatalogDialog => ({
        kind: 'form',
        mode,
        ...(mode === 'edit' ? { id: EDIT_ID } : {}),
        draft: mode === 'edit' ? EDIT_DRAFT : FORM_DRAFT,
        errors: {},
        phase: 'form',
        ...extra,
      });
      const toggle = (to: 'ACTIVE' | 'INACTIVE', row = TOGGLE_ROW): CatalogDialog => ({ kind: 'toggle', id: row.id, name: row.name, to, itemCount: row.itemCount, phase: 'form' });
      const dialogs: Record<string, CatalogDialog> = {
        add: form('create', { draft: { name: '', sortOrder: '24', status: 'ACTIVE' } }),
        'add-error': form('create', { draft: { name: '   ', sortOrder: '-3', status: 'ACTIVE' }, errors: { name: 'Nhập tên nhóm.', sortOrder: 'Thứ tự là số nguyên từ 0 đến 100000.' } }),
        'add-taken': form('create', { draft: { name: 'hải  SẢN ', sortOrder: '24', status: 'ACTIVE' }, errors: { name: 'Đã có nhóm trùng tên này. Tên nhóm không phân biệt chữ hoa/thường và khoảng trắng thừa; dấu tiếng Việt vẫn được phân biệt.' } }),
        'add-twin': form('create', {
          draft: { name: 'Món theo mùa', sortOrder: '24', status: 'ACTIVE' },
          errors: { name: 'Đã có nhóm ngừng dùng trùng tên này. Hãy kích hoạt lại nhóm cũ thay vì tạo nhóm mới.' },
          inactiveTwin: true,
        }),
        edit: form('edit', {}),
        saving: form('edit', { phase: 'working' }),
        unknown: form('edit', { phase: 'unknown', message: 'Chưa xác nhận được kết quả. Hãy kiểm tra lại danh sách; yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm nhóm.' }),
        conflict: form('edit', { phase: 'conflict', message: 'Nhóm đã được thay đổi ở nơi khác. Hãy tải lại danh sách để xem dữ liệu hiện tại trước khi sửa. Nội dung bạn đã nhập vẫn còn trên màn hình này.' }),
        failed: form('edit', { phase: 'failed', message: 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.' }),
        deactivate: toggle('INACTIVE'),
        activate: toggle('ACTIVE', SAMPLE_CATEGORIES[5]!),
      };
      const dialog = dialogs[variant];
      const screen: CatalogScreen = { name: 'categories', filter, list, ...(dialog === undefined ? {} : { dialog }) };
      const view = new CatalogView(
        content,
        {
          wired: variant !== 'live',
          filter: demo,
          refresh: demo,
          retry: demo,
          page: demo,
          create: demo,
          edit: demo,
          toggle: demo,
          draft: () => undefined,
          submit: demo,
          cancel: demo,
          retrySave: demo,
          recheck: demo,
          reload: demo,
          showTwin: demo,
          login: () => context.go('login'),
          home: () => context.go('overview'),
        },
        context.frame,
      );
      view.render(screen);
    }),
};

// ---- D04-D06: invitations (real screens) ---------------------------------------------------------------------------------

function provisioningPage(context: DesignContext, route: Route, screen: ProvisioningScreen): HTMLElement {
  return shellPage(context, route, (content) => {
    if (context.role !== 'SYSTEM') {
      forbiddenPage(context, content);
      return;
    }
    const controller = demoController<ProvisioningController>(context, { screen, lockRemainingSeconds: () => 142 });
    const view = new ProvisioningView(content, controller, (next) => {
      const target = screenIdOf(next);
      context.go(target.id, target.variant);
    }, clock);
    view.render(screen);
  });
}

const invitations: DesignScreen = {
  id: 'invitations',
  code: 'D04',
  title: 'Lời mời Admin',
  group: 'Tài khoản',
  note: 'Màn thật, đã nối API (chỉ SYSTEM). Ở đây hiện dữ liệu mẫu để duyệt hình thức.',
  variants: variants(['list', 'Có dữ liệu'], ['empty', 'Trống'], ['loading', 'Đang tải'], ['error', 'Lỗi tải']),
  render: (context, variant) => {
    const base = { name: 'list' as const, filter: 'ALL' as const, items: SAMPLE_INVITATIONS, nextCursor: null, loading: false, loadingMore: false };
    const screen: ProvisioningScreen = variant === 'empty' ? { ...base, items: [] } : variant === 'loading' ? { ...base, items: [], loading: true } : variant === 'error' ? { ...base, items: [], error: 'Chưa thể kết nối. Vui lòng thử lại.' } : base;
    return provisioningPage(context, { name: 'invitations' }, screen);
  },
};

function composeScreen(patch: Partial<Extract<ProvisioningScreen, { name: 'compose' }>> & { draft?: ComposeDraft }): ProvisioningScreen {
  return { name: 'compose', kind: 'create', loadingTarget: false, phase: 'form', draft: EMPTY_DRAFT, fieldErrors: {}, codeReset: 0, pending: false, ...patch };
}

const FILLED: ComposeDraft = {
  ...EMPTY_DRAFT,
  fullName: 'Nguyễn Văn H',
  phone: '0909123456',
  note: 'Hỗ trợ vận hành khu vực miền Nam',
  permissions: { ...EMPTY_PERMISSIONS, CUSTOMER: { canView: true, canReviewProfile: false, canLock: true }, SHOP: { canView: true, canReviewProfile: true, canLock: false } },
};

const invitationNew: DesignScreen = {
  id: 'invitation-new',
  code: 'D05',
  title: 'Tạo lời mời Admin',
  group: 'Tài khoản',
  note: 'Màn thật, đã nối API (chỉ SYSTEM): nhập thông tin, chọn phạm vi, xác nhận bằng Authenticator rồi nhận liên kết kích hoạt.',
  variants: variants(['form', 'Biểu mẫu'], ['filled', 'Đã nhập'], ['errors', 'Lỗi nhập'], ['code', 'Nhập mã xác nhận'], ['code-error', 'Mã sai'], ['working', 'Đang tạo'], ['retry', 'Chưa rõ kết quả'], ['done', 'Đã tạo']),
  render: (context, variant) => {
    const detail = sampleInvitationDetail('PENDING');
    const table: Record<string, ProvisioningScreen> = {
      form: composeScreen({}),
      filled: composeScreen({ draft: FILLED }),
      errors: composeScreen({ fieldErrors: { fullName: 'Nhập họ tên (tối đa 120 ký tự).', phone: 'Số điện thoại không hợp lệ.', permissions: 'Chọn ít nhất một ứng dụng được xem.' } }),
      code: composeScreen({ draft: FILLED, phase: 'code', operationExpiresAtMs: Date.now() + 270_000 }),
      'code-error': composeScreen({ draft: FILLED, phase: 'code', codeError: 'totp', codeReset: 1, operationExpiresAtMs: Date.now() + 200_000 }),
      working: composeScreen({ draft: FILLED, phase: 'working', pending: true }),
      retry: composeScreen({ draft: FILLED, phase: 'retry' }),
      done: composeScreen({ draft: FILLED, phase: 'done', result: { kind: 'issued', issued: { invitation: detail, activationLink: SAMPLE_ACTIVATION_LINK } } }),
    };
    return provisioningPage(context, { name: 'invitation-new' }, table[pick(variant, table, 'form')]!);
  },
};

const invitationDetail: DesignScreen = {
  id: 'invitation-detail',
  code: 'D06',
  title: 'Chi tiết lời mời Admin',
  group: 'Tài khoản',
  note: 'Màn thật, đã nối API (chỉ SYSTEM): xem trạng thái, cấp lại hoặc thu hồi lời mời. Hệ thống không tự gửi liên kết.',
  variants: variants(['pending', 'Chờ kích hoạt'], ['accepted', 'Đã kích hoạt'], ['expired', 'Hết hạn'], ['revoked', 'Đã thu hồi'], ['loading', 'Đang tải'], ['not-found', 'Không tìm thấy'], ['reissue', 'Cấp lại'], ['revoke', 'Thu hồi']),
  render: (context, variant) => {
    const status = variant === 'accepted' ? 'ACCEPTED' : variant === 'expired' ? 'EXPIRED' : variant === 'revoked' ? 'REVOKED' : 'PENDING';
    const invitation = sampleInvitationDetail(status);
    const route: Route = { name: 'invitation', id: invitation.invitationId };
    let screen: ProvisioningScreen = { name: 'detail', id: invitation.invitationId, loading: false, invitation, notFound: false };
    if (variant === 'loading') {
      screen = { name: 'detail', id: invitation.invitationId, loading: true, notFound: false };
    } else if (variant === 'not-found') {
      screen = { name: 'detail', id: invitation.invitationId, loading: false, notFound: true };
    } else if (variant === 'reissue' || variant === 'revoke') {
      screen = composeScreen({ kind: variant === 'reissue' ? 'reissue' : 'revoke', target: sampleInvitationDetail('PENDING') });
    }
    return provisioningPage(context, route, screen);
  },
};

// ---- D07: activation (real, public) ----------------------------------------------------------------------------------------

const activation: DesignScreen = {
  id: 'activation',
  code: 'D07',
  title: 'Kích hoạt tài khoản Admin',
  group: 'Đăng nhập và bảo mật',
  note: 'Trang công khai /activate, màn thật đã nối API: SMS OTP → mật khẩu → Authenticator. Ở đây hiện trạng thái mẫu.',
  variants: variants(['otp', 'Nhập OTP'], ['otp-invalid', 'OTP sai'], ['password', 'Đặt mật khẩu'], ['enroll', 'Authenticator'], ['done', 'Hoàn tất'], ['link-invalid', 'Liên kết sai'], ['session-expired', 'Phiên hết hạn'], ['rate-limited', 'Giới hạn'], ['replaced', 'Đã thay liên kết']),
  render: (context, variant) => {
    const otp = { name: 'otp' as const, pending: false, codeReset: 0, otp: { status: 'SUBMITTED' as const, attemptsLeft: 4 }, resendAtMs: Date.now() + 45_000 };
    const table: Record<string, ActivationScreen> = {
      otp,
      'otp-invalid': { ...otp, codeError: 'invalid', codeReset: 1 },
      password: { name: 'password', pending: false, restartRequired: false, passwordDeadlineMs: Date.now() + 600_000 },
      enroll: { name: 'enroll', loading: false, showKey: false, pending: false, codeReset: 0, secret: SAMPLE_SECRET, otpauthUri: SAMPLE_OTPAUTH },
      done: { name: 'done' },
      'link-invalid': { name: 'link-invalid' },
      'session-expired': { name: 'session-expired' },
      'rate-limited': { name: 'rate-limited', untilMs: Date.now() + 120_000 },
      replaced: { name: 'invalidated', reason: 'REPLACED', canRestart: false, pending: false },
    };
    const screen = table[pick(variant, table, 'otp')]!;
    const host = h('div', { class: 'dv-host' });
    const controller = demoController<ActivationController>(context, { screen, waitSeconds: () => 45 });
    new ActivationPage(host, controller).render(screen);
    return host;
  },
};

// ---- C01-C10: common states ---------------------------------------------------------------------------------------------------

const states: DesignScreen = {
  id: 'states',
  code: 'C01–C10',
  title: 'Trạng thái chung',
  group: 'Trạng thái chung',
  note: 'Mọi trang dùng cùng bộ trạng thái: không bao giờ để vùng trắng. C08 (xác nhận khi thoát form) không áp dụng cho Web quản trị.',
  variants: variants(['loading', 'C01 Đang tải'], ['empty', 'C02 Trống'], ['offline', 'C03 Mất mạng'], ['timeout', 'C03 Quá thời gian'], ['expired', 'C04 Hết phiên'], ['forbidden', 'C05 Không có quyền'], ['conflict', 'C06 Xung đột phiên bản'], ['unknown', 'C07 Chưa rõ kết quả'], ['rate', 'C09 Giới hạn'], ['not-wired', 'C10 Chưa nối']),
  render: (context, variant) =>
    shellPage(context, { name: 'home' }, (content) => {
      const demo = (): void => context.toast(DEMO_NOTICE);
      const handlers = { retry: demo, login: () => context.go('login'), home: () => context.go('overview') };
      const body: Record<string, HTMLElement> = {
        loading: skeleton(),
        empty: emptyPanel('Chưa có dữ liệu phù hợp', 'Thử thay đổi điều kiện tìm kiếm.'),
        offline: failurePanel('offline', handlers),
        timeout: failurePanel('timeout', handlers),
        expired: failurePanel('session-expired', handlers),
        forbidden: failurePanel('forbidden', handlers),
        conflict: statePanel({ icon: 'refresh', tone: 'warning', live: 'alert', title: 'Dữ liệu đã thay đổi', text: 'Có người khác vừa cập nhật mục này. Hãy tải lại và kiểm tra trước khi thao tác tiếp.', actions: [{ label: 'Tải lại', onClick: demo }] }),
        unknown: statePanel({ icon: 'clock', tone: 'warning', live: 'alert', title: 'Chưa xác nhận được kết quả', text: 'Yêu cầu có thể đã được xử lý. Hãy kiểm tra lại trạng thái; hệ thống không tự gửi lại.', actions: [{ label: 'Kiểm tra lại trạng thái', onClick: demo }] }),
        rate: failurePanel('rate-limited', handlers, 38),
        'not-wired': notWiredPanel('Chức năng này chờ máy chủ. Nút nghiệp vụ bị khóa và không hiển thị kết quả giả.'),
      };
      content.replaceChildren(h('section', { class: 'content content-wide' }, h('h1', { class: 'title' }, 'Trạng thái chung'), h('div', { class: 'table-card' }, body[pick(variant, body, 'loading')]!)));
    }),
};

export const SCREENS: readonly DesignScreen[] = [overview, login, verify, enroll, reset, recovery, activation, users, usersLocked, userDetail, userLock, userUnlock, userDelete, financeOverview, financeWallets, financeTopups, financeTopup, financeWithdrawals, financeWithdrawal, financeTransactions, financeReconciliation, walletParams, settings, categories, administrators, invitations, invitationNew, invitationDetail, states];
