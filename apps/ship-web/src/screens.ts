import { AppDefinition } from '../../client-shared/src/app.js';
import { FOOD_TEST_CONSENT } from '../../client-shared/src/consent.js';
import { logo, SHIP_BRAND } from '../../client-shared/src/brand.js';
import { banner, bottomNav, button, chip, emptyState, gate, list, listItem, openDialog, reasonNote, setBusy, TabDef, textField } from '../../client-shared/src/components.js';
import { h } from '../../client-shared/src/dom.js';
import { icon } from '../../client-shared/src/icons.js';
import { ScreenDef, ScreenEnv, VariantDef } from '../../client-shared/src/screen.js';
import { authScreens } from '../../client-shared/src/screens/auth.js';
import { liveProfileForm } from '../../client-shared/src/screens/profile-live.js';
import { signOutLive } from '../../client-shared/src/screens/logout-live.js';
import { diagnosticsScreen } from '../../client-shared/src/screens/diagnostics.js';
import { failureBanner } from '../../client-shared/src/screens/feedback.js';
import { actionButton, appPage, designOnly, guardForm } from '../../client-shared/src/screens/layout.js';
import { STATE_COPY } from '../../client-shared/src/states.js';
import { normalizePersonName, normalizePlate } from '../../client-shared/src/validation.js';

// 11Ship (driver) screens of M01 (catalog S01-S05, S12-S14, S19). Same two modes as 11Food. A driver who is signed in or
// pending is NEVER eligible for Online: the switch stays unavailable and says why. No orders, income, balance or activity
// status is invented anywhere; empty means "no data yet", unknown is shown as "—", never as 0.

const v = (id: string, label: string): VariantDef => ({ id, label });
const DEFAULT: readonly VariantDef[] = [v('default', 'Mặc định')];

const TABS: readonly TabDef[] = [
  { id: 'home', label: 'Trang chủ', icon: 'home', href: '/' },
  { id: 'orders', label: 'Đơn hàng', icon: 'receipt', href: '/orders' },
  { id: 'income', label: 'Thu nhập', icon: 'barChart', href: '/income' },
  { id: 'wallet', label: 'Ví', icon: 'wallet', href: '/wallet' },
  { id: 'account', label: 'Tài khoản', icon: 'user', href: '/account' },
];

const nav = (env: ScreenEnv, active: string): HTMLElement => bottomNav(TABS, active, (id) => env.go(id));

function guestPrompt(env: ScreenEnv, text: string): HTMLElement {
  return banner({ kind: 'info', title: 'Bạn chưa đăng nhập', text, action: { label: 'Đăng nhập', onClick: () => env.go('login') } });
}

function designChip(env: ScreenEnv): HTMLElement | undefined {
  return env.mode === 'design' ? chip(STATE_COPY.designBanner, 'warn') : undefined;
}

// ---- S01: home ----------------------------------------------------------------------------------------------------

const home: ScreenDef = {
  id: 'home',
  code: 'S01',
  title: 'Trang chủ',
  group: 'Điều hướng',
  path: '/',
  access: 'public',
  variants: [v('default', 'Khách'), v('pending', 'Hồ sơ chờ duyệt (mẫu)'), v('no-profile', 'Chưa gửi hồ sơ (mẫu)')],
  render: (env) => {
    const driver = env.account?.driver;
    // Online is only ever possible for an approved, eligible driver; that state does not exist in M01. Always unavailable.
    const reason = env.account === undefined ? 'Đăng nhập và hoàn tất hồ sơ xế để bật nhận đơn.' : driver?.status === 'PENDING' ? 'Hồ sơ đang chờ duyệt. Bạn chưa thể bật nhận đơn.' : 'Hoàn tất và gửi hồ sơ xế để được duyệt trước khi bật nhận đơn.';
    const toggle = h('button', { type: 'button', class: 'c-switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Sẵn sàng nhận đơn', 'aria-describedby': 'online-reason', 'aria-disabled': 'true' });
    toggle.addEventListener('click', (event) => event.preventDefault());
    const status =
      env.account === undefined
        ? undefined
        : driver?.status === 'PENDING'
          ? banner({ kind: 'info', title: 'Hồ sơ đang chờ duyệt', text: 'Chúng tôi sẽ cập nhật khi hồ sơ được xem xét.', action: { label: 'Xem hồ sơ', onClick: () => env.go('driver-status') } })
          : banner({ kind: 'warn', title: 'Chưa gửi hồ sơ xế', text: 'Gửi hồ sơ để được xét duyệt.', action: { label: 'Gửi hồ sơ', onClick: () => env.go('driver-onboarding') } });
    return appPage({
      title: 'Trang chủ',
      logo: logo(SHIP_BRAND),
      variant: driver?.status === 'PENDING' ? 'yellow' : 'plain',
      nav: nav(env, 'home'),
      bodyClass: 'c-stack',
      body: [
        designChip(env),
        env.account === undefined ? guestPrompt(env, 'Đăng nhập để gửi hồ sơ xế và theo dõi trạng thái.') : status,
        h('section', { class: 'c-card c-stack c-stack--tight' }, h('div', { class: 'c-row-flex' }, h('p', { class: 'c-title c-title--sm' }, 'Sẵn sàng nhận đơn'), toggle), h('p', { id: 'online-reason', class: 'c-reason' }, reason)),
        emptyState({ icon: 'truck', title: 'Chưa có đơn nào', text: 'Đơn giao sẽ hiện ở đây khi tính năng giao hàng sẵn sàng.' }),
      ],
    });
  },
};

// ---- S02-S04: shells ----------------------------------------------------------------------------------------------

const orders: ScreenDef = {
  id: 'orders',
  code: 'S02',
  title: 'Đơn hàng',
  group: 'Điều hướng',
  path: '/orders',
  access: 'public',
  variants: DEFAULT,
  render: (env) => {
    const tabs = h('div', { class: 'c-row-flex', role: 'tablist', 'aria-label': 'Loại đơn' }, button({ label: 'Đang giao', kind: 'primary', compact: true }), button({ label: 'Lịch sử', kind: 'secondary', compact: true }));
    for (const b of Array.from(tabs.querySelectorAll('button'))) {
      b.setAttribute('role', 'tab');
    }
    tabs.children[0]?.setAttribute('aria-selected', 'true');
    tabs.children[1]?.setAttribute('aria-selected', 'false');
    return appPage({
      title: 'Đơn hàng',
      nav: nav(env, 'orders'),
      bodyClass: 'c-stack',
      body: [tabs, emptyState({ icon: 'receipt', title: 'Chưa có đơn hàng', text: 'Chưa có đơn nào được giao cho bạn.' }), h('div', { class: 'c-center' }, chip(STATE_COPY.soon, 'soon'))],
    });
  },
};

const income: ScreenDef = {
  id: 'income',
  code: 'S03',
  title: 'Thu nhập',
  group: 'Điều hướng',
  path: '/income',
  access: 'public',
  variants: DEFAULT,
  render: (env) => {
    const range = button({ label: 'Chọn khoảng ngày', kind: 'secondary', icon: 'clock', id: 'income-range' });
    return appPage({
      title: 'Thu nhập',
      nav: nav(env, 'income'),
      bodyClass: 'c-stack',
      body: [
        gate(range, 'Chọn ngày sẽ có khi dữ liệu thu nhập sẵn sàng.'),
        h('section', { class: 'c-card c-stack c-stack--tight' }, h('p', { class: 'c-lead' }, 'Tổng thu nhập'), h('p', { class: 'c-title' }, '—'), h('p', { class: 'c-reason' }, 'Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng.')),
        emptyState({ icon: 'barChart', title: 'Chưa có dữ liệu thu nhập', text: STATE_COPY.empty }),
      ],
    });
  },
};

const wallet: ScreenDef = {
  id: 'wallet',
  code: 'S04',
  title: 'Ví',
  group: 'Điều hướng',
  path: '/wallet',
  access: 'public',
  variants: DEFAULT,
  render: (env) => {
    const topUp = button({ label: 'Hướng dẫn nạp tiền', kind: 'secondary', icon: 'wallet', id: 'wallet-topup' });
    const withdraw = button({ label: 'Liên hệ rút tiền', kind: 'secondary', icon: 'banknote', id: 'wallet-withdraw' });
    return appPage({
      title: 'Ví',
      nav: nav(env, 'wallet'),
      bodyClass: 'c-stack',
      body: [
        h('section', { class: 'c-card c-stack c-stack--tight' }, h('p', { class: 'c-lead' }, 'Số dư'), h('p', { class: 'c-title' }, '—'), h('p', { class: 'c-reason' }, 'Chưa có dữ liệu ví.')),
        gate(topUp, 'Nạp tiền sẽ có khi ví sẵn sàng.'),
        gate(withdraw, 'Rút tiền sẽ có khi ví sẵn sàng.'),
        h('div', { class: 'c-center' }, chip(STATE_COPY.soon, 'soon')),
      ],
    });
  },
};

// ---- S05 / S14 / S19: account -------------------------------------------------------------------------------------

function openLogout(env: ScreenEnv): void {
  openDialog({
    title: 'Đăng xuất khỏi 11Ship?',
    text: 'Bạn sẽ cần đăng nhập lại để dùng tài khoản.',
    icon: 'logout',
    tone: 'danger',
    host: env.dialogHost,
    actions: [
      { label: 'Hủy', kind: 'secondary' },
      {
        label: 'Đăng xuất',
        kind: 'danger',
        onClick: () => {
          if (env.mode === 'design') {
            designOnly(env, STATE_COPY.designNoSend);
            env.go('account', 'guest');
            return;
          }
          // Live: the local session is dropped first; the notice says whether the server confirmed the revoke.
          void signOutLive(env, 'account');
        },
      },
    ],
  });
}

const STATUS_LABEL = { NONE: 'Chưa gửi hồ sơ', PENDING: 'Chờ duyệt', ACTIVE: 'Đã duyệt' } as const;

const account: ScreenDef = {
  id: 'account',
  code: 'S05 / S14',
  title: 'Tài khoản',
  group: 'Tài khoản',
  path: '/account',
  access: 'public',
  variants: [v('default', 'Khách'), v('no-profile', 'Chưa gửi hồ sơ (mẫu)'), v('pending', 'Chờ duyệt (mẫu)'), v('logout-dialog', 'Hộp đăng xuất (S19)')],
  render: (env, variant) => {
    const me = env.account;
    let page: HTMLElement;
    // Live: ask the server about this session when the account opens; a session it calls invalid ends in app.ts (login screen).
    if (env.mode === 'live' && me !== undefined) {
      void env.auth?.me();
    }
    if (me === undefined || variant === 'guest') {
      page = appPage({
        title: 'Tài khoản',
        nav: nav(env, 'account'),
        bodyClass: 'c-stack',
        body: [
          h('div', { class: 'c-hero' }, logo(SHIP_BRAND, true), h('p', { class: 'c-slogan' }, SHIP_BRAND.slogan)),
          button({ label: 'Đăng nhập', kind: 'primary', id: 'account-login', onClick: () => env.go('login') }),
          button({ label: 'Đăng ký làm xế', kind: 'secondary', id: 'account-register', onClick: () => env.go('register') }),
          list([
            listItem({ icon: 'help', title: 'Trợ giúp', soon: true }),
            listItem({ icon: 'shield', title: 'Chính sách và điều khoản', soon: true }),
            listItem({ icon: 'activity', title: 'Chẩn đoán kết nối', sub: 'Kiểm tra kết nối với máy chủ', onClick: () => env.go('diagnostics') }),
          ]),
        ],
      });
    } else {
      const driver = me.driver;
      const status = driver?.status ?? 'NONE';
      page = appPage({
        title: 'Tài khoản',
        nav: nav(env, 'account'),
        bodyClass: 'c-stack',
        body: [
          designChip(env),
          h(
            'section',
            { class: 'c-card c-stack c-stack--tight' },
            h('p', { class: 'c-title' }, me.fullName ?? 'Chưa có tên'),
            h('p', { class: 'c-lead' }, me.phoneMasked),
            h('div', { class: 'c-row-flex' }, driver?.kind === 'PLATFORM' ? chip('Xế hệ thống', 'info') : driver?.kind === 'EXTERNAL' ? chip('Xế ngoài', 'info') : undefined, chip(STATUS_LABEL[status], status === 'ACTIVE' ? 'ok' : status === 'PENDING' ? 'warn' : 'soon')),
          ),
          list([
            listItem({ icon: 'user', title: 'Hồ sơ xế', sub: status === 'NONE' ? 'Chưa gửi hồ sơ — gửi ngay' : 'Xem trạng thái hồ sơ', onClick: () => env.go(status === 'NONE' ? 'driver-onboarding' : 'driver-status') }),
            listItem({ icon: 'user', title: 'Thông tin cá nhân', sub: 'Họ tên và số điện thoại đăng nhập', onClick: () => env.go('profile') }),
            listItem({ icon: 'banknote', title: 'Tài khoản ngân hàng', soon: true }),
            listItem({ icon: 'wallet', title: 'Ví', soon: true }),
            listItem({ icon: 'key', title: 'Đặt lại mật khẩu', onClick: () => env.go('reset') }),
            env.mode === 'live' && !env.isWired('auth.logout')
              ? listItem({ icon: 'logout', title: 'Đăng xuất', sub: env.featureReason('auth.logout'), soon: true })
              : listItem({ icon: 'logout', title: 'Đăng xuất', tone: 'danger', onClick: () => openLogout(env) }),
          ]),
        ],
      });
    }
    if (variant === 'logout-dialog') {
      openLogout(env);
    }
    return page;
  },
};

// ---- personal profile (shared with 11Food F17) ----------------------------------------------------------------------

const profile: ScreenDef = {
  id: 'profile',
  code: 'S05',
  title: 'Thông tin cá nhân',
  group: 'Tài khoản',
  path: '/account/profile',
  access: 'authed',
  variants: DEFAULT,
  render: (env) => {
    if (env.mode === 'live' && env.auth !== undefined) {
      return appPage({ title: 'Thông tin cá nhân', onBack: () => env.go('account'), bodyClass: 'c-stack', body: [liveProfileForm(env).form] });
    }
    // Without a connected server the screen only explains: the name is the server's, nothing is edited or saved here.
    const me = env.account;
    const name = textField({ id: 'full-name', label: 'Họ và tên', icon: 'user', value: me?.fullName ?? '', readOnly: true });
    const phone = textField({ id: 'phone', label: 'Số điện thoại đăng nhập', icon: 'phone', value: me?.phoneMasked ?? '', readOnly: true });
    return appPage({
      title: 'Thông tin cá nhân',
      onBack: () => env.go('account'),
      bodyClass: 'c-stack',
      body: [designChip(env), h('div', { class: 'c-stack' }, name.root, phone.root), reasonNote(env.featureReason('customer.profileSave'))],
    });
  },
};

// ---- S12: driver onboarding ---------------------------------------------------------------------------------------

const driverOnboarding: ScreenDef = {
  id: 'driver-onboarding',
  code: 'S12',
  title: 'Hồ sơ xế',
  group: 'Hồ sơ xế',
  path: '/driver/onboarding',
  access: 'authed',
  variants: [v('default', 'Trống'), v('invalid-name', 'Tên sai'), v('invalid-plate', 'Biển số sai'), v('conflict', 'Xung đột cập nhật'), v('offline', 'Mất kết nối'), v('submitting', 'Đang gửi')],
  render: (env, variant) => {
    const name = textField({ id: 'legal-name', label: 'Họ tên theo giấy tờ', icon: 'user', autocomplete: 'name', maxLength: 120, placeholder: 'Họ và tên đầy đủ' });
    const plate = textField({ id: 'plate', label: 'Biển số xe', optional: true, icon: 'truck', maxLength: 32, placeholder: 'Có thể bổ sung sau' });
    const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
    const check = (): boolean => {
      const nameProblem = normalizePersonName(name.input.value) === undefined ? STATE_COPY.nameInvalid : undefined;
      const plateProblem = normalizePlate(plate.input.value).ok ? undefined : 'Biển số chưa hợp lệ (tối đa 32 ký tự).';
      name.setError(nameProblem);
      plate.setError(plateProblem);
      (nameProblem !== undefined ? name : plateProblem !== undefined ? plate : undefined)?.input.focus();
      return nameProblem === undefined && plateProblem === undefined;
    };
    const submit = actionButton(env, 'driver.submit', { label: 'Gửi hồ sơ', type: 'submit', id: 'driver-submit', onBlocked: () => void check() });
    const form = h('form', { class: 'c-stack', novalidate: true }, name.root, plate.root, feedback, submit.node);
    // C08: a driver profile being typed is asked about before leaving; the form starts empty.
    const guard = guardForm(env, form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (check() && env.mode === 'design') {
        designOnly(env, STATE_COPY.designNoSend);
        guard.release();
        env.go('driver-status');
      }
    });
    if (variant === 'invalid-name') {
      name.input.value = '';
      name.setError(STATE_COPY.nameInvalid);
    } else if (variant === 'invalid-plate') {
      name.input.value = env.sample?.person.fullName ?? '';
      plate.input.value = 'x'.repeat(40);
      plate.setError('Biển số chưa hợp lệ (tối đa 32 ký tự).');
    } else if (variant === 'conflict') {
      feedback.replaceChildren(failureBanner('VERSION_CONFLICT', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
    } else if (variant === 'offline') {
      feedback.replaceChildren(failureBanner('OFFLINE', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
    } else if (variant === 'submitting') {
      name.input.value = env.sample?.person.fullName ?? '';
      setBusy(submit.button, true, 'Gửi hồ sơ', 'Đang gửi…');
    }
    return appPage({
      title: 'Hồ sơ xế',
      onBack: () => env.go('account'),
      bodyClass: 'c-stack',
      body: [designChip(env), banner({ kind: 'info', title: 'Gửi hồ sơ để được duyệt', text: 'Sau khi gửi, hồ sơ ở trạng thái chờ duyệt. Chờ duyệt chưa thể nhận đơn.' }), form],
    });
  },
};

// ---- S13: driver status -------------------------------------------------------------------------------------------

const driverStatus: ScreenDef = {
  id: 'driver-status',
  code: 'S13',
  title: 'Trạng thái hồ sơ',
  group: 'Hồ sơ xế',
  path: '/driver/status',
  access: 'authed',
  variants: [v('default', 'Chờ duyệt'), v('offline', 'Mất kết nối')],
  render: (env, variant) => {
    const driver = env.account?.driver;
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['Họ tên', driver?.legalName ?? '—'],
      ['Biển số', driver?.plate ?? 'Chưa bổ sung'],
      ['Loại xế', driver?.kind === 'PLATFORM' ? 'Xế hệ thống' : 'Xế ngoài'],
    ];
    return appPage({
      title: 'Trạng thái hồ sơ',
      onBack: () => env.go('account'),
      bodyClass: 'c-stack',
      body: [
        designChip(env),
        variant === 'offline' ? failureBanner('OFFLINE', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }) : undefined,
        h('section', { class: 'c-card c-stack c-stack--tight' }, h('div', { class: 'c-row-flex' }, icon('clock', 24), h('p', { class: 'c-title c-title--sm' }, 'Hồ sơ đang chờ duyệt')), h('p', { class: 'c-lead' }, 'Chờ duyệt chưa thể nhận đơn. Chúng tôi sẽ cập nhật khi hồ sơ được xem xét.')),
        h('dl', { class: 'c-card' }, ...rows.map(([k, val]) => h('div', { class: 'c-kv' }, h('dt', {}, k), h('dd', {}, val)))),
        reasonNote('Chưa có thông tin lý do hay yêu cầu bổ sung từ phía xét duyệt.'),
      ],
    });
  },
};

export function shipScreens(): ScreenDef[] {
  // A new driver goes from the verified registration straight to the driver profile form (S12).
  const routes = { afterLogin: { id: 'home' }, afterRegister: { id: 'driver-onboarding' }, guestHome: { id: 'home' } };
  const diagnostics = diagnosticsScreen({ brand: SHIP_BRAND, code: 'S06', nav: (env) => nav(env, 'account') });
  return [...authScreens(SHIP_BRAND, routes), home, orders, income, wallet, account, profile, diagnostics, driverOnboarding, driverStatus];
}

export const SHIP_DEFINITION: AppDefinition = {
  brand: SHIP_BRAND,
  screens: shipScreens(),
  homeId: 'home',
  fallbackPath: '/',
  loginPath: '/login',
  flowStart: { 'register-otp': '/register', 'reset-otp': '/reset', 'reset-password': '/reset' },
  testSmsNotice: true,
  // The register flow of #82 (OTP, or none in DISABLED_TEST), connected on a local https runtime. The approved test texts name 11Ship/11Food.
  register: { consent: FOOD_TEST_CONSENT },
};
