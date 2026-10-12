import { AppDefinition } from '../../client-shared/src/app.js';
import { FOOD_BRAND, logo } from '../../client-shared/src/brand.js';
import { banner, bottomNav, button, chip, emptyState, gate, list, listItem, openDialog, reasonNote, setBusy, TabDef, textField, textLink } from '../../client-shared/src/components.js';
import { h } from '../../client-shared/src/dom.js';
import { icon } from '../../client-shared/src/icons.js';
import { ScreenDef, ScreenEnv, VariantDef } from '../../client-shared/src/screen.js';
import { authScreens } from '../../client-shared/src/screens/auth.js';
import { diagnosticsScreen } from '../../client-shared/src/screens/diagnostics.js';
import { failureBanner } from '../../client-shared/src/screens/feedback.js';
import { actionButton, appPage, designOnly, guardForm, isGated } from '../../client-shared/src/screens/layout.js';
import { STATE_COPY } from '../../client-shared/src/states.js';
import { normalizeOptionalLink, normalizePersonName, normalizeRequiredText, isValidPhone, ADDRESS_MAX, FACEBOOK_MAX, SHOP_NAME_MAX, ZALO_MAX } from '../../client-shared/src/validation.js';

// 11Food screens of M01 (catalog F01-F04, F16-F23). Every screen works in two modes (see client-shared/src/screen.ts):
// in the real app nobody is signed in and every business action is unavailable with a visible reason; in the design preview
// the same code shows sample data labelled "Dữ liệu minh họa". No screen invents orders, shops, balances or activity.

const v = (id: string, label: string): VariantDef => ({ id, label });
const DEFAULT: readonly VariantDef[] = [v('default', 'Mặc định')];

const TABS: readonly TabDef[] = [
  { id: 'home', label: 'Trang chủ', icon: 'home', href: '/' },
  { id: 'search', label: 'Tìm kiếm', icon: 'search', href: '/search' },
  { id: 'orders', label: 'Đơn hàng', icon: 'receipt', href: '/orders' },
  { id: 'account', label: 'Tài khoản', icon: 'user', href: '/account' },
];

function nav(env: ScreenEnv, active: string): HTMLElement {
  return bottomNav(TABS, active, (id) => env.go(id));
}

function guestPrompt(env: ScreenEnv, text: string): HTMLElement {
  return banner({ kind: 'info', title: 'Bạn chưa đăng nhập', text, action: { label: 'Đăng nhập', onClick: () => env.go('login') } });
}

// ---- F01-F03: guest navigation shells ---------------------------------------------------------------------------

const home: ScreenDef = {
  id: 'home',
  code: 'F01',
  title: 'Trang chủ',
  group: 'Điều hướng',
  path: '/',
  access: 'public',
  variants: [v('default', 'Khách'), v('signed-in', 'Đã đăng nhập (mẫu)')],
  render: (env) =>
    appPage({
      title: 'Trang chủ',
      logo: logo(FOOD_BRAND),
      right: env.account === undefined ? undefined : chip(env.account.fullName ?? 'Tài khoản', 'info'),
      nav: nav(env, 'home'),
      bodyClass: 'c-stack',
      body: [
        env.account === undefined ? guestPrompt(env, 'Đăng nhập hoặc đăng ký để đặt món khi tính năng sẵn sàng.') : undefined,
        emptyState({ icon: 'utensils', title: 'Chưa có quán để hiển thị', text: 'Danh sách quán và món sẽ xuất hiện khi tính năng đặt món sẵn sàng.' }),
        h('div', { class: 'c-center' }, chip(STATE_COPY.soon, 'soon')),
      ],
    }),
};

// F02 keeps what the person typed (and the Món/Quán choice) while they move between screens and tabs and when they press Back.
// It lives only in memory of this page: not in the URL, not in storage, never sent anywhere. There is no search API yet (M09),
// so nothing here ever produces a result: no shop, dish or offer is invented.
type SearchScope = 'dish' | 'shop';
const searchMemory: { query: string; scope: SearchScope } = { query: '', scope: 'dish' };
const SEARCH_MAX = 100;
const SEARCH_SCOPES: ReadonlyArray<{ readonly id: SearchScope; readonly label: string }> = [
  { id: 'dish', label: 'Món' },
  { id: 'shop', label: 'Quán' },
];

function searchOutcome(query: string): HTMLElement {
  return query.trim() === ''
    ? emptyState({ icon: 'search', title: 'Chưa có kết quả', text: STATE_COPY.empty })
    : emptyState({ icon: 'search', title: 'Chưa tìm được kết quả', text: 'Chưa có dữ liệu quán và món để tìm. Từ khóa chỉ nằm trên màn hình này, chưa gửi tới máy chủ.' });
}

const search: ScreenDef = {
  id: 'search',
  code: 'F02',
  title: 'Tìm kiếm',
  group: 'Điều hướng',
  path: '/search',
  access: 'public',
  variants: DEFAULT,
  render: (env) => {
    const clear = h('button', { type: 'button', class: 'c-iconbtn c-iconbtn--tap', id: 'search-clear', 'aria-label': 'Xóa nội dung tìm kiếm', hidden: searchMemory.query === '' }, icon('close', 20));
    const box = textField({ id: 'search', label: 'Tìm món hoặc quán', icon: 'search', placeholder: 'Tìm món hoặc quán', maxLength: SEARCH_MAX, autocomplete: 'off', inputMode: 'search', value: searchMemory.query, trailing: clear });
    const outcome = h('div', { class: 'c-stack', 'aria-live': 'polite' }, searchOutcome(searchMemory.query));
    const refresh = (): void => {
      searchMemory.query = box.input.value;
      clear.hidden = searchMemory.query === '';
      outcome.replaceChildren(searchOutcome(searchMemory.query));
    };
    box.input.addEventListener('input', refresh);
    clear.addEventListener('click', () => {
      box.input.value = '';
      refresh();
      box.input.focus();
    });
    const scopeButtons = SEARCH_SCOPES.map((scope) => {
      const element = button({ label: scope.label, kind: scope.id === searchMemory.scope ? 'primary' : 'secondary', compact: true, id: `search-scope-${scope.id}` });
      element.setAttribute('aria-pressed', String(scope.id === searchMemory.scope));
      element.addEventListener('click', () => {
        searchMemory.scope = scope.id;
        SEARCH_SCOPES.forEach((other, index) => {
          const on = other.id === scope.id;
          scopeButtons[index].className = `c-btn c-btn--${on ? 'primary' : 'secondary'} c-btn--compact`;
          scopeButtons[index].setAttribute('aria-pressed', String(on));
        });
      });
      return element;
    });
    // Enter must not submit anything: there is no search to run.
    const form = h('form', { class: 'c-stack', role: 'search', novalidate: true }, box.root, h('div', { class: 'c-row-flex', role: 'group', 'aria-label': 'Tìm theo' }, ...scopeButtons));
    form.addEventListener('submit', (event) => event.preventDefault());
    return appPage({
      title: 'Tìm kiếm',
      nav: nav(env, 'search'),
      bodyClass: 'c-stack',
      body: [form, reasonNote('Tìm kiếm sẽ có khi dữ liệu quán và món sẵn sàng.'), outcome, h('div', { class: 'c-center' }, textLink('Về trang chủ', () => env.go('home')))],
    });
  },
};

const orders: ScreenDef = {
  id: 'orders',
  code: 'F03',
  title: 'Đơn hàng',
  group: 'Điều hướng',
  path: '/orders',
  access: 'public',
  variants: [v('default', 'Khách'), v('signed-in', 'Đã đăng nhập (mẫu)')],
  render: (env) =>
    appPage({
      title: 'Đơn hàng',
      nav: nav(env, 'orders'),
      bodyClass: 'c-stack',
      body: [
        env.account === undefined ? guestPrompt(env, 'Đăng nhập để xem đơn hàng của bạn.') : undefined,
        emptyState({ icon: 'receipt', title: 'Chưa có đơn hàng', text: 'Đơn hàng của bạn sẽ hiện ở đây khi tính năng đặt món sẵn sàng.' }),
        h('div', { class: 'c-center' }, chip(STATE_COPY.soon, 'soon')),
      ],
    }),
};

// ---- F04 / F16 / F18: account -------------------------------------------------------------------------------------

function openLogout(env: ScreenEnv): void {
  openDialog({
    title: 'Đăng xuất khỏi 11Food?',
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
          }
          // Live: unreachable until a login exists (no account => no logout row). The call goes through env.ports.auth.logout.
        },
      },
    ],
  });
}

function shopEntry(env: ScreenEnv): HTMLElement {
  const shop = env.account?.shop;
  const target = shop?.state === 'COMPLETE' ? 'shop-home' : shop?.state === 'DRAFT' ? 'shop-onboarding' : 'shop-start';
  const sub = shop?.state === 'COMPLETE' ? shop.name ?? 'Cửa hàng của bạn' : shop?.state === 'DRAFT' ? 'Hồ sơ đang soạn dở — tiếp tục' : 'Đăng ký bán hàng trên 11Food';
  return listItem({ icon: 'store', title: 'Quản lý cửa hàng', sub, onClick: () => env.go(target) });
}

const account: ScreenDef = {
  id: 'account',
  code: 'F04 / F16',
  title: 'Tài khoản',
  group: 'Tài khoản',
  path: '/account',
  access: 'public',
  variants: [v('default', 'Khách'), v('signed-in', 'Đã đăng nhập (mẫu)'), v('shop-draft', 'Chủ quán – nháp'), v('shop-complete', 'Chủ quán – hoàn tất'), v('logout-dialog', 'Hộp đăng xuất (F18)')],
  render: (env, variant) => {
    const me = env.account;
    let page: HTMLElement;
    if (me === undefined || variant === 'guest') {
      page = appPage({
        title: 'Tài khoản',
        nav: nav(env, 'account'),
        bodyClass: 'c-stack',
        body: [
          h('div', { class: 'c-hero' }, logo(FOOD_BRAND, true), h('p', { class: 'c-slogan' }, FOOD_BRAND.slogan)),
          button({ label: 'Đăng nhập', kind: 'primary', id: 'account-login', onClick: () => env.go('login') }),
          button({ label: 'Đăng ký', kind: 'secondary', id: 'account-register', onClick: () => env.go('register') }),
          list([
            // F07: where the shop entry lives for M01. Nobody is signed in, so it is not a link and shows no role or shop.
            listItem({ icon: 'store', title: 'Quản lý cửa hàng', sub: `Cần đăng nhập. ${env.featureReason('auth.login')}`, soon: true, trailing: chip('Cần đăng nhập', 'soon') }),
            listItem({ icon: 'help', title: 'Trợ giúp', soon: true }),
            listItem({ icon: 'shield', title: 'Chính sách và điều khoản', soon: true }),
            listItem({ icon: 'activity', title: 'Chẩn đoán kết nối', sub: 'Kiểm tra kết nối với máy chủ', onClick: () => env.go('diagnostics') }),
          ]),
        ],
      });
    } else {
      const roles = h('div', { class: 'c-row-flex' }, chip('Khách hàng', 'ok'), me.roles.includes('SHOP_OWNER') ? chip('Chủ quán', 'info') : undefined);
      page = appPage({
        title: 'Tài khoản',
        nav: nav(env, 'account'),
        bodyClass: 'c-stack',
        body: [
          env.mode === 'design' ? chip(STATE_COPY.designBanner, 'warn') : undefined,
          h('section', { class: 'c-card c-stack c-stack--tight' }, h('p', { class: 'c-title' }, me.fullName ?? 'Chưa có tên'), h('p', { class: 'c-lead' }, me.phoneMasked), roles),
          list([
            listItem({ icon: 'user', title: 'Thông tin cá nhân', sub: 'Họ tên và số điện thoại đăng nhập', onClick: () => env.go('profile') }),
            shopEntry(env),
            listItem({ icon: 'mapPin', title: 'Địa chỉ nhận hàng', soon: true }),
            listItem({ icon: 'key', title: 'Đặt lại mật khẩu', onClick: () => env.go('reset') }),
            listItem({ icon: 'logout', title: 'Đăng xuất', tone: 'danger', onClick: () => openLogout(env) }),
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

// ---- F17: personal profile ----------------------------------------------------------------------------------------

const profile: ScreenDef = {
  id: 'profile',
  code: 'F17',
  title: 'Thông tin cá nhân',
  group: 'Tài khoản',
  path: '/account/profile',
  access: 'authed',
  variants: [v('default', 'Mặc định'), v('invalid-name', 'Tên sai'), v('conflict', 'Xung đột cập nhật'), v('offline', 'Mất kết nối'), v('saving', 'Đang gửi')],
  render: (env, variant) => {
    const me = env.account;
    const name = textField({ id: 'full-name', label: 'Họ và tên', icon: 'user', autocomplete: 'name', value: me?.fullName ?? '', maxLength: 120 });
    const phone = textField({ id: 'phone', label: 'Số điện thoại đăng nhập', icon: 'phone', value: me?.phoneMasked ?? '', readOnly: true, hint: 'Không đổi được ở đây.' });
    const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
    const check = (): boolean => {
      const problem = normalizePersonName(name.input.value) === undefined ? STATE_COPY.nameInvalid : undefined;
      name.setError(problem);
      if (problem !== undefined) {
        name.input.focus();
      }
      return problem === undefined;
    };
    const save = actionButton(env, 'customer.profileSave', { label: 'Lưu thay đổi', type: 'submit', id: 'profile-save', onBlocked: () => void check() });
    const form = h('form', { class: 'c-stack', novalidate: true }, name.root, phone.root, feedback, save.node);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!check()) {
        return;
      }
      if (env.mode === 'design') {
        designOnly(env, STATE_COPY.designNoSend);
      }
    });
    if (variant === 'invalid-name') {
      name.input.value = '';
      name.setError(STATE_COPY.nameInvalid);
    } else if (variant === 'conflict') {
      feedback.replaceChildren(failureBanner('VERSION_CONFLICT', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
    } else if (variant === 'offline') {
      feedback.replaceChildren(failureBanner('OFFLINE', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
    } else if (variant === 'saving') {
      setBusy(save.button, true, 'Lưu thay đổi', 'Đang gửi…');
    }
    // C08: edits not yet saved are asked about before leaving (the baseline is what the screen shows now).
    guardForm(env, form);
    return appPage({ title: 'Thông tin cá nhân', onBack: () => env.go('account'), bodyClass: 'c-stack', body: [form] });
  },
};

// ---- F20: shop start ----------------------------------------------------------------------------------------------

const shopStart: ScreenDef = {
  id: 'shop-start',
  code: 'F20',
  title: 'Bán hàng trên 11Food',
  group: 'Cửa hàng',
  path: '/shop/start',
  access: 'authed',
  variants: [v('default', 'Chưa có hồ sơ'), v('draft', 'Có hồ sơ nháp')],
  render: (env, variant) => {
    const draft = variant === 'draft' || env.account?.shop?.state === 'DRAFT';
    const benefits = [
      { icon: 'store' as const, text: 'Một tài khoản, một cửa hàng' },
      { icon: 'receipt' as const, text: 'Nhận đơn khi menu và đơn hàng sẵn sàng' },
      { icon: 'user' as const, text: 'Bạn vẫn là khách hàng bình thường' },
    ];
    return appPage({
      title: 'Bán hàng trên 11Food',
      onBack: () => env.go('account'),
      bodyClass: 'c-stack',
      body: [
        h('div', { class: 'c-hero' }, h('span', { class: 'c-empty__icon c-self-center' }, icon('store', 32)), h('p', { class: 'c-title' }, 'Mở cửa hàng của bạn')),
        h('ul', { class: 'c-summary' }, ...benefits.map((b) => h('li', { class: 'c-row-flex' }, h('span', { class: 'c-item__icon' }, icon(b.icon, 22)), h('span', {}, b.text)))),
        draft ? banner({ kind: 'info', title: 'Hồ sơ đang soạn dở', text: 'Bạn có thể tiếp tục từ chỗ đã dừng.' }) : undefined,
        button({ label: draft ? 'Tiếp tục hồ sơ' : 'Đăng ký cửa hàng', kind: 'primary', id: 'shop-start-cta', onClick: () => env.go('shop-onboarding', draft ? 'draft' : undefined) }),
      ],
    });
  },
};

// ---- F21: shop profile form ---------------------------------------------------------------------------------------

const shopOnboarding: ScreenDef = {
  id: 'shop-onboarding',
  code: 'F21',
  title: 'Hồ sơ cửa hàng',
  group: 'Cửa hàng',
  path: '/shop/onboarding',
  access: 'authed',
  variants: [v('default', 'Trống'), v('draft', 'Nháp đã có'), v('invalid', 'Thiếu thông tin'), v('conflict', 'Xung đột cập nhật'), v('no-gps', 'Chưa có vị trí')],
  render: (env, variant) => {
    const name = textField({ id: 'shop-name', label: 'Tên quán', icon: 'store', maxLength: SHOP_NAME_MAX, placeholder: 'Tên quán của bạn' });
    const phone = textField({ id: 'shop-phone', label: 'Số điện thoại liên hệ', icon: 'phone', type: 'tel', inputMode: 'tel', placeholder: 'Số điện thoại quán', hint: 'Không thay đổi số điện thoại đăng nhập.' });
    const address = textField({ id: 'shop-address', label: 'Địa chỉ', icon: 'mapPin', maxLength: ADDRESS_MAX, placeholder: 'Số nhà, đường, phường/xã' });
    const zalo = textField({ id: 'shop-zalo', label: 'Zalo', optional: true, icon: 'message', maxLength: ZALO_MAX, placeholder: 'Liên kết Zalo (https://…)' });
    const facebook = textField({ id: 'shop-facebook', label: 'Facebook', optional: true, icon: 'message', maxLength: FACEBOOK_MAX, placeholder: 'Liên kết Facebook (https://…)' });
    const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
    const gps = h('div', { class: 'c-card c-stack c-stack--tight' }, h('p', { class: 'c-title c-title--sm' }, 'Vị trí lấy hàng'), h('p', { class: 'c-lead' }, 'Chưa có vị trí. Hãy lấy vị trí khi bạn đang đứng tại quán.'), button({ label: 'Lấy vị trí tại quán', kind: 'secondary', id: 'shop-gps', icon: 'locate', onClick: () => env.go('shop-location') }));

    const check = (): boolean => {
      const problems: Array<[typeof name, string | undefined]> = [
        [name, normalizeRequiredText(name.input.value, SHOP_NAME_MAX) === undefined ? STATE_COPY.required : undefined],
        [phone, isValidPhone(phone.input.value) ? undefined : STATE_COPY.invalidPhone],
        [address, normalizeRequiredText(address.input.value, ADDRESS_MAX) === undefined ? STATE_COPY.required : undefined],
        [zalo, normalizeOptionalLink(zalo.input.value, ZALO_MAX).ok ? undefined : STATE_COPY.linkInvalid],
        [facebook, normalizeOptionalLink(facebook.input.value, FACEBOOK_MAX).ok ? undefined : STATE_COPY.linkInvalid],
      ];
      let firstBad: HTMLInputElement | undefined;
      for (const [field, problem] of problems) {
        field.setError(problem);
        if (problem !== undefined && firstBad === undefined) {
          firstBad = field.input;
        }
      }
      firstBad?.focus();
      return firstBad === undefined;
    };
    const saveDraft = actionButton(env, 'shop.draftSave', { label: 'Lưu hồ sơ', kind: 'secondary', type: 'submit', id: 'shop-save', onBlocked: () => void check() });
    // Completing needs the actual position taken at the shop and an active area: never enabled from the form alone.
    const complete = button({ label: 'Hoàn tất hồ sơ', kind: 'primary', id: 'shop-complete' });
    const completeNode = gate(complete, isGated(env, 'shop.complete') ? env.featureReason('shop.complete') : 'Cần lấy vị trí thật tại quán trước khi hoàn tất.');
    const form = h('form', { class: 'c-stack', novalidate: true }, name.root, phone.root, address.root, zalo.root, facebook.root, gps, feedback, saveDraft.node, completeNode);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (check() && env.mode === 'design') {
        designOnly(env, STATE_COPY.designNoSend);
      }
    });
    if (variant === 'draft' || variant === 'conflict' || variant === 'no-gps') {
      name.input.value = env.sample?.shop.name ?? '';
      phone.input.value = env.sample?.shop.phone ?? '';
      address.input.value = env.sample?.shop.address ?? '';
    }
    if (variant === 'invalid') {
      phone.input.value = '123';
      check();
    } else if (variant === 'conflict') {
      feedback.replaceChildren(failureBanner('VERSION_CONFLICT', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
    }
    // C08: unsaved shop details are asked about before leaving (the baseline is what the screen shows now).
    guardForm(env, form);
    return appPage({ title: 'Hồ sơ cửa hàng', onBack: () => env.go('shop-start'), bodyClass: 'c-stack', body: [env.mode === 'design' ? chip(STATE_COPY.designBanner, 'warn') : undefined, form] });
  },
};

// ---- F22: pickup location -----------------------------------------------------------------------------------------

const shopLocation: ScreenDef = {
  id: 'shop-location',
  code: 'F22',
  title: 'Vị trí lấy hàng',
  group: 'Cửa hàng',
  path: '/shop/location',
  access: 'authed',
  variants: [v('default', 'Chưa lấy vị trí'), v('locating', 'Đang định vị'), v('denied', 'Từ chối quyền'), v('ready', 'Đã có vị trí (mẫu)')],
  render: (env, variant) => {
    const map = h('div', { class: 'c-map', role: 'img', 'aria-label': 'Khung bản đồ' }, variant === 'ready' ? h('span', { class: 'c-map__pin' }, icon('mapPin', 36)) : undefined, h('p', { class: 'c-map__note' }, 'Bản đồ thật hiện vị trí đo tại quán. Khung này không phải vị trí thật.'));
    const info = h('div', { class: 'c-stack c-stack--tight' });
    if (variant === 'denied') {
      info.append(banner({ kind: 'warn', title: 'Chưa được cấp quyền vị trí', text: 'Bạn vẫn có thể lưu hồ sơ không có vị trí. Hãy cấp quyền rồi thử lại khi đang ở quán.' }));
    } else if (variant === 'locating') {
      info.append(banner({ kind: 'info', title: 'Đang xác định vị trí…', text: 'Giữ nguyên điện thoại trong lúc chờ.' }));
    } else if (variant === 'ready') {
      info.append(h('dl', {}, h('div', { class: 'c-kv' }, h('dt', {}, 'Độ chính xác'), h('dd', {}, env.sample?.location.accuracy ?? '—')), h('div', { class: 'c-kv' }, h('dt', {}, 'Đo lúc'), h('dd', {}, env.sample?.location.measured ?? '—'))));
    }
    const fetch = actionButton(env, 'shop.location', { label: variant === 'ready' ? 'Lấy lại vị trí' : 'Lấy vị trí hiện tại', kind: 'secondary', id: 'location-get', icon: 'locate', onClick: () => designOnly(env, STATE_COPY.designNoSend) });
    const confirm = button({ label: 'Dùng vị trí này', kind: 'primary', id: 'location-confirm', onClick: () => designOnly(env, STATE_COPY.designNoSend) });
    const confirmNode = variant === 'ready' && env.mode === 'design' ? confirm : gate(confirm, isGated(env, 'shop.location') ? env.featureReason('shop.location') : 'Cần lấy vị trí hiện tại trước.');
    return appPage({ title: 'Vị trí lấy hàng', onBack: () => env.go('shop-onboarding'), bodyClass: 'c-stack', body: [map, info, fetch.node, confirmNode, textLink('Lưu hồ sơ không có vị trí', () => env.go('shop-onboarding'))] });
  },
};

// ---- F23: shop home -----------------------------------------------------------------------------------------------

const shopHome: ScreenDef = {
  id: 'shop-home',
  code: 'F23',
  title: 'Cửa hàng của tôi',
  group: 'Cửa hàng',
  path: '/shop/home',
  access: 'authed',
  variants: [v('default', 'Hồ sơ hoàn tất'), v('disabled', 'Cửa hàng bị khóa')],
  render: (env, variant) => {
    const shop = env.account?.shop;
    const disabled = variant === 'disabled';
    return appPage({
      title: 'Cửa hàng của tôi',
      onBack: () => env.go('account'),
      bodyClass: 'c-stack',
      body: [
        env.mode === 'design' ? chip(STATE_COPY.designBanner, 'warn') : undefined,
        h('section', { class: 'c-card c-stack c-stack--tight' }, h('p', { class: 'c-title' }, shop?.name ?? 'Cửa hàng'), chip(disabled ? 'Đang bị khóa' : 'Hồ sơ hoàn tất', disabled ? 'bad' : 'ok')),
        disabled ? banner({ kind: 'warn', title: 'Cửa hàng đang bị khóa', text: 'Bạn vẫn dùng tài khoản khách hàng bình thường. Liên hệ hỗ trợ để biết lý do.' }) : banner({ kind: 'info', title: 'Hồ sơ đã hoàn tất', text: 'Hồ sơ hoàn tất chưa có nghĩa là quán đang mở bán. Menu và đơn hàng sẽ có sau.' }),
        list([
          listItem({ icon: 'store', title: 'Hồ sơ cửa hàng', onClick: () => env.go('shop-onboarding', 'draft') }),
          listItem({ icon: 'mapPin', title: 'Vị trí lấy hàng', onClick: () => env.go('shop-location') }),
          listItem({ icon: 'utensils', title: 'Menu', soon: true }),
          listItem({ icon: 'receipt', title: 'Đơn hàng của quán', soon: true }),
          listItem({ icon: 'barChart', title: 'Doanh thu', soon: true }),
          listItem({ icon: 'user', title: 'Về giao diện khách hàng', onClick: () => env.go('account') }),
        ]),
      ],
    });
  },
};

export function foodScreens(): ScreenDef[] {
  const routes = { afterLogin: { id: 'home' }, afterRegister: { id: 'home' }, guestHome: { id: 'home' } };
  const diagnostics = diagnosticsScreen({ brand: FOOD_BRAND, code: 'F05', nav: (env) => nav(env, 'account') });
  return [...authScreens(FOOD_BRAND, routes), home, search, orders, account, diagnostics, profile, shopStart, shopOnboarding, shopLocation, shopHome];
}

export const FOOD_DEFINITION: AppDefinition = {
  brand: FOOD_BRAND,
  screens: foodScreens(),
  homeId: 'home',
  fallbackPath: '/',
  loginPath: '/login',
  flowStart: { 'register-otp': '/register', 'reset-otp': '/reset', 'reset-password': '/reset' },
  testSmsNotice: true,
};
