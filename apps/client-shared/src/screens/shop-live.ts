import { banner, button, chip, list, listItem, reasonNote, setBusy, textField, textLink } from '../components.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { ScreenEnv } from '../screen.js';
import { GeoFailure, GeoFix, PickupPoint, ShopController, ShopFormField, ShopStep } from '../shop-flow.js';
import { failureMessage, STATE_COPY } from '../states.js';
import { ADDRESS_MAX, FACEBOOK_MAX, isValidPhone, normalizeOptionalLink, normalizeRequiredText, SHOP_NAME_MAX, ZALO_MAX } from '../validation.js';
import { failureBanner } from './feedback.js';
import { appPage } from './layout.js';

// F20-F23 of 11Food connected to the server through env.shop (shop-flow.ts). The screens only DISPLAY the controller's state and send
// intents; the design-preview versions stay in apps/food-web/src/screens.ts. Nothing here says "saved", "completed" or "locked" unless
// the server's answer says so, and nothing is sample data.

const GEO_COPY: Readonly<Record<GeoFailure, { readonly title: string; readonly text: string }>> = {
  DENIED: { title: 'Chưa được cấp quyền vị trí', text: 'Bạn vẫn có thể lưu hồ sơ không có vị trí. Hãy cấp quyền cho trình duyệt rồi thử lại khi đang ở quán.' },
  UNAVAILABLE: { title: 'Chưa xác định được vị trí', text: 'Thiết bị chưa trả về vị trí. Hãy ra nơi thoáng hoặc bật định vị rồi thử lại. Bạn vẫn có thể lưu hồ sơ không có vị trí.' },
  TIMEOUT: { title: 'Định vị quá lâu', text: 'Chưa nhận được vị trí trong thời gian cho phép. Hãy thử lại. Bạn vẫn có thể lưu hồ sơ không có vị trí.' },
  UNSUPPORTED: { title: 'Trình duyệt không hỗ trợ định vị', text: 'Hãy dùng trình duyệt khác hoặc điện thoại. Bạn vẫn có thể lưu hồ sơ không có vị trí.' },
};

const two = (value: number): string => String(value).padStart(2, '0');

function formatMeasured(ms: number): string {
  const date = new Date(ms);
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}

const formatCoordinate = (value: number): string => value.toFixed(6);

/** The measured/saved point as a definition list: coordinates, accuracy and time exactly as the device gave them (none are made up). */
function pointDetails(point: Pick<PickupPoint, 'lat' | 'lng' | 'accuracyMeters' | 'measuredAtMs'> | GeoFix): HTMLElement {
  const row = (label: string, value: string, id: string): HTMLElement => h('div', { class: 'c-kv' }, h('dt', {}, label), h('dd', { id }, value));
  return h(
    'dl',
    { id: 'location-details' },
    row('Vĩ độ', formatCoordinate(point.lat), 'location-lat'),
    row('Kinh độ', formatCoordinate(point.lng), 'location-lng'),
    row('Độ chính xác', point.accuracyMeters === null ? 'Không có' : `± ${Math.round(point.accuracyMeters)} m`, 'location-accuracy'),
    row('Đo lúc', point.measuredAtMs === null ? 'Đã lưu trên máy chủ (không kèm thời điểm đo)' : formatMeasured(point.measuredAtMs), 'location-time'),
  );
}

/** Enter the shop context (the server decides) and open F23. A shop the server locked still opens F23 so the person sees why. */
export async function enterShopContext(env: ScreenEnv): Promise<void> {
  const shop = env.shop;
  if (shop === undefined || env.account?.activeRole === 'SHOP_OWNER') {
    env.go('shop-home');
    return;
  }
  const answer = await shop.selectContext('SHOP_OWNER');
  if (answer.kind === 'stale') {
    return;
  }
  if (answer.kind === 'failure' && answer.code !== 'ROLE_NOT_AVAILABLE') {
    env.toast(failureMessage(answer.code, answer.retryAfterSeconds).text);
    return;
  }
  env.go('shop-home');
}

/** Back to the customer side: the CUSTOMER context is selected first when the shop context is the active one. */
export async function leaveToCustomer(env: ScreenEnv): Promise<void> {
  const shop = env.shop;
  if (shop === undefined || env.account?.activeRole !== 'SHOP_OWNER') {
    env.go('account');
    return;
  }
  const answer = await shop.selectContext('CUSTOMER');
  if (answer.kind === 'stale') {
    return;
  }
  if (answer.kind === 'failure') {
    env.toast(failureMessage(answer.code, answer.retryAfterSeconds).text);
    return;
  }
  env.go('account');
}

const loadingBanner = (): HTMLElement => banner({ kind: 'info', text: STATE_COPY.loading });

function failureOf(step: Exclude<ShopStep, { kind: 'ok' } | { kind: 'stale' }>, onRetry?: () => void): HTMLElement {
  return failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, ...(onRetry === undefined ? {} : { onRetry }) });
}

// ---- F20 ----------------------------------------------------------------------------------------------------------

export function liveShopStart(env: ScreenEnv, shop: ShopController): HTMLElement {
  shop.arrive();
  const benefits = [
    { icon: 'store' as const, text: 'Một tài khoản, một cửa hàng' },
    { icon: 'receipt' as const, text: 'Nhận đơn khi menu và đơn hàng sẵn sàng' },
    { icon: 'user' as const, text: 'Bạn vẫn là khách hàng bình thường' },
  ];
  const status = h('div', { class: 'c-stack', 'aria-live': 'polite', id: 'shop-start-status' });
  const action = h('div', { class: 'c-stack' });

  const show = async (): Promise<void> => {
    status.replaceChildren(loadingBanner());
    action.replaceChildren();
    const step = await shop.load({ force: true });
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      status.replaceChildren(failureOf(step, () => void show()));
      return;
    }
    const current = shop.state().shop;
    status.replaceChildren();
    if (current === null) {
      action.replaceChildren(button({ label: 'Đăng ký cửa hàng', kind: 'primary', id: 'shop-start-cta', onClick: () => env.go('shop-onboarding') }));
    } else if (current.status === 'INCOMPLETE') {
      status.replaceChildren(banner({ kind: 'info', title: 'Hồ sơ đang soạn dở', text: 'Bạn có thể tiếp tục từ chỗ đã dừng.' }));
      action.replaceChildren(button({ label: 'Tiếp tục hồ sơ', kind: 'primary', id: 'shop-start-cta', onClick: () => env.go('shop-onboarding') }));
    } else {
      status.replaceChildren(banner({ kind: 'info', title: current.status === 'DISABLED' ? 'Cửa hàng đang bị khóa' : 'Bạn đã có cửa hàng', text: current.name }));
      action.replaceChildren(button({ label: 'Mở Cửa hàng của tôi', kind: 'primary', id: 'shop-start-cta', onClick: () => void enterShopContext(env) }));
    }
  };
  void show();
  return appPage({
    title: 'Bán hàng trên 11Food',
    onBack: () => env.go('account'),
    bodyClass: 'c-stack',
    body: [
      h('div', { class: 'c-hero' }, h('span', { class: 'c-empty__icon c-self-center' }, icon('store', 32)), h('p', { class: 'c-title' }, 'Mở cửa hàng của bạn')),
      h('ul', { class: 'c-summary' }, ...benefits.map((b) => h('li', { class: 'c-row-flex' }, h('span', { class: 'c-item__icon' }, icon(b.icon, 22)), h('span', {}, b.text)))),
      status,
      action,
    ],
  });
}

// ---- F21 ----------------------------------------------------------------------------------------------------------

export function liveShopOnboarding(env: ScreenEnv, shop: ShopController): HTMLElement {
  shop.arrive();
  const name = textField({ id: 'shop-name', label: 'Tên quán', icon: 'store', maxLength: SHOP_NAME_MAX, placeholder: 'Tên quán của bạn' });
  const phone = textField({ id: 'shop-phone', label: 'Số điện thoại liên hệ', icon: 'phone', type: 'tel', inputMode: 'tel', placeholder: 'Số điện thoại quán', hint: 'Không thay đổi số điện thoại đăng nhập.' });
  const address = textField({ id: 'shop-address', label: 'Địa chỉ', icon: 'mapPin', maxLength: ADDRESS_MAX, placeholder: 'Số nhà, đường, phường/xã' });
  const zalo = textField({ id: 'shop-zalo', label: 'Zalo', optional: true, icon: 'message', maxLength: ZALO_MAX, placeholder: 'Liên kết Zalo (https://…)' });
  const facebook = textField({ id: 'shop-facebook', label: 'Facebook', optional: true, icon: 'message', maxLength: FACEBOOK_MAX, placeholder: 'Liên kết Facebook (https://…)' });
  const fields: ReadonlyArray<readonly [ShopFormField, typeof name]> = [
    ['name', name],
    ['phone', phone],
    ['address', address],
    ['zalo', zalo],
    ['facebook', facebook],
  ];

  // The service area: a list the server gave. Never typed, never guessed from the position.
  const areaSelect = h('select', { id: 'shop-area', name: 'shop-area', 'aria-describedby': 'shop-area-note shop-area-error' });
  const areaError = h('p', { id: 'shop-area-error', class: 'c-error', 'aria-live': 'polite', hidden: true });
  const areaNote = h('p', { id: 'shop-area-note', class: 'c-hint' });
  const areaField = h(
    'div',
    { class: 'c-field' },
    h('label', { for: 'shop-area', class: 'c-label' }, 'Khu vực phục vụ'),
    h('div', { class: 'c-input' }, icon('mapPin', 20), areaSelect),
    areaNote,
    areaError,
  );

  const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite', id: 'shop-feedback' });
  const locationCard = h('div', { class: 'c-card c-stack c-stack--tight', id: 'shop-location-card' });
  const save = button({ label: 'Lưu hồ sơ', kind: 'secondary', type: 'submit', id: 'shop-save' });
  const complete = button({ label: 'Hoàn tất hồ sơ', kind: 'primary', id: 'shop-complete' });
  const completeReason = reasonNote('', 'shop-complete-reason');
  complete.setAttribute('aria-describedby', 'shop-complete-reason');
  const completeNode = h('div', { class: 'c-stack c-stack--tight' }, complete, completeReason);
  const form = h('form', { class: 'c-stack', novalidate: true }, name.root, phone.root, address.root, zalo.root, facebook.root, areaField, locationCard, feedback, save, completeNode);

  let busy = false;
  let ready = false;

  const fieldProblems = (): boolean => {
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
    // The area is NOT required to save a draft (the draft may be saved without it); completing needs it.
    firstBad?.focus();
    return firstBad !== undefined;
  };

  /** Rebuilds the options of the area list from the controller (what the server gave) and selects the chosen one. */
  const drawAreas = (): void => {
    const state = shop.state();
    const editable = shop.editable();
    const placeholder = h('option', { value: '' }, state.areas.length === 0 ? 'Chưa có khu vực' : 'Chọn khu vực phục vụ');
    areaSelect.replaceChildren(placeholder, ...state.areas.map((area) => h('option', { value: area.serviceAreaId }, area.name)));
    const chosen = state.serviceAreaId;
    const inList = chosen !== null && state.areas.some((area) => area.serviceAreaId === chosen);
    areaSelect.value = inList ? (chosen as string) : '';
    areaSelect.disabled = !ready || busy || !editable || state.areas.length === 0;
    if (state.areas.length === 0 && ready) {
      areaNote.textContent = 'Chưa có khu vực đang hoạt động. Bạn vẫn lưu được hồ sơ nháp; hoàn tất sau khi có khu vực.';
    } else if (chosen !== null && !inList && ready) {
      areaNote.textContent = 'Khu vực đã chọn không còn hoạt động. Hãy chọn lại.';
    } else {
      areaNote.textContent = 'Chọn một khu vực trong danh sách của hệ thống.';
    }
  };

  const drawLocation = (): void => {
    const state = shop.state();
    const editable = shop.editable();
    const pick = state.pickup;
    const children: Array<HTMLElement | undefined> = [
      h('p', { class: 'c-title c-title--sm' }, 'Vị trí lấy hàng'),
      pick === undefined ? h('p', { class: 'c-lead', id: 'shop-location-state' }, 'Chưa có vị trí. Hãy lấy vị trí khi bạn đang đứng tại quán.') : h('p', { class: 'c-lead', id: 'shop-location-state' }, 'Đã có vị trí lấy hàng (chưa lưu cho đến khi bạn bấm Lưu hồ sơ).'),
      pick === undefined ? undefined : pointDetails(pick),
      editable
        ? button({
            label: pick === undefined ? 'Lấy vị trí tại quán' : 'Lấy lại vị trí',
            kind: 'secondary',
            id: 'shop-gps',
            icon: 'locate',
            onClick: () => {
              shop.keepForFlow();
              env.go('shop-location');
            },
          })
        : undefined,
    ];
    locationCard.replaceChildren(...children.filter((node): node is HTMLElement => node !== undefined));
  };

  const drawActions = (): void => {
    const editable = shop.editable();
    save.hidden = !editable;
    complete.hidden = !editable;
    completeReason.hidden = !editable;
    if (!editable) {
      return;
    }
    const blocker = ready ? shop.completeBlocker() : 'Đang tải hồ sơ…';
    complete.setAttribute('aria-disabled', String(blocker !== undefined || busy));
    (completeReason.querySelector('span') as HTMLElement).textContent = blocker ?? 'Hồ sơ đã lưu đủ thông tin, vị trí và khu vực.';
    completeReason.hidden = blocker === undefined;
  };

  const lockFields = (): void => {
    const editable = shop.editable();
    for (const [, field] of fields) {
      field.input.readOnly = !editable;
      field.input.disabled = !ready || busy;
    }
    save.disabled = !ready || busy;
    drawAreas();
    drawActions();
  };

  const writeFieldsFromState = (): void => {
    const state = shop.state();
    for (const [key, field] of fields) {
      field.input.value = state.form[key];
      field.setError(undefined);
    }
    drawAreas();
    drawLocation();
    drawActions();
  };

  const noticeForShop = (): void => {
    const current = shop.state().shop;
    if (current !== null && current.status !== 'INCOMPLETE') {
      feedback.replaceChildren(
        banner(
          current.status === 'DISABLED'
            ? { kind: 'warn', title: 'Cửa hàng đang bị khóa', text: 'Hồ sơ này không sửa được ở bước đăng ký. Bạn vẫn dùng tài khoản khách hàng bình thường.' }
            : { kind: 'info', title: 'Hồ sơ đã hoàn tất', text: 'Hồ sơ này không sửa được ở bước đăng ký.' },
        ),
      );
    }
  };

  const reloadFromServer = async (note?: string): Promise<void> => {
    busy = true;
    lockFields();
    feedback.replaceChildren(loadingBanner());
    const step = await shop.load({ force: true });
    busy = false;
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      feedback.replaceChildren(failureOf(step, () => void reloadFromServer(note)));
      lockFields();
      return;
    }
    ready = true;
    writeFieldsFromState();
    lockFields();
    feedback.replaceChildren(...(note === undefined ? [] : [banner({ kind: 'info', text: note })]));
    noticeForShop();
  };

  const firstLoad = async (): Promise<void> => {
    busy = true;
    lockFields();
    feedback.replaceChildren(loadingBanner());
    const step = await shop.load();
    busy = false;
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      feedback.replaceChildren(failureOf(step, () => void firstLoad()));
      lockFields();
      return;
    }
    ready = true;
    writeFieldsFromState();
    lockFields();
    feedback.replaceChildren();
    noticeForShop();
  };

  const conflictRetry = (typedName: string): (() => void) => () => void reloadFromServer(typedName === '' ? 'Đây là thông tin hiện tại trên máy chủ; sửa lại rồi lưu nếu bạn vẫn muốn đổi.' : `Bạn đã nhập tên quán: "${typedName}". Đây là thông tin hiện tại trên máy chủ; sửa lại rồi lưu nếu bạn vẫn muốn đổi.`);

  const runSave = async (): Promise<void> => {
    if (busy || !ready || !shop.editable()) {
      return;
    }
    if (fieldProblems()) {
      return;
    }
    const typedName = name.input.value.trim();
    busy = true;
    lockFields();
    feedback.replaceChildren();
    setBusy(save, true, 'Lưu hồ sơ', 'Đang gửi…');
    const step = await shop.save();
    busy = false;
    setBusy(save, false, 'Lưu hồ sơ', 'Đang gửi…');
    lockFields();
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'ok') {
      feedback.replaceChildren(banner({ kind: 'success', title: 'Đã lưu hồ sơ', text: 'Hồ sơ nháp đã được lưu trên máy chủ. Bạn có thể quay lại và tiếp tục sau.' }));
      return;
    }
    if (step.code === 'VERSION_CONFLICT' || step.code === 'SHOP_EXISTS') {
      feedback.replaceChildren(failureOf(step, conflictRetry(typedName)));
      return;
    }
    if (step.code === 'INVALID_PHONE') {
      phone.setError(STATE_COPY.invalidPhone);
    }
    if (step.code === 'AREA_INVALID') {
      feedback.replaceChildren(failureOf(step));
      const refreshed = await shop.refreshAreas();
      if (refreshed.kind === 'ok') {
        const chosen = shop.state().serviceAreaId;
        if (chosen !== null && !shop.state().areas.some((area) => area.serviceAreaId === chosen)) {
          shop.chooseArea(null);
        }
        drawAreas();
        drawActions();
      }
      return;
    }
    // An unknown outcome offers "Thử lại": the same form re-sends the SAME request (same key and body).
    feedback.replaceChildren(failureOf(step, step.unresolved ? () => void runSave() : undefined));
  };

  const runComplete = async (): Promise<void> => {
    if (busy || !ready || shop.completeBlocker() !== undefined) {
      return;
    }
    busy = true;
    lockFields();
    feedback.replaceChildren();
    setBusy(complete, true, 'Hoàn tất hồ sơ', 'Đang gửi…');
    const step = await shop.complete();
    busy = false;
    setBusy(complete, false, 'Hoàn tất hồ sơ', 'Đang gửi…');
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'ok') {
      writeFieldsFromState();
      lockFields();
      const openShop = button({ label: 'Vào Cửa hàng của tôi', kind: 'primary', id: 'shop-open-home', onClick: () => void enterShopContext(env) });
      feedback.replaceChildren(
        banner({ kind: 'success', title: 'Đã hoàn tất hồ sơ', text: 'Hồ sơ đã hoàn tất. Quán chưa nhận đơn: tính năng nhận đơn và menu sẽ có sau.' }),
        ...(step.identityRefreshed
          ? [openShop]
          : [banner({ kind: 'warn', title: 'Chưa làm mới tài khoản', text: 'Hồ sơ đã hoàn tất nhưng chưa cập nhật được quyền của tài khoản.', action: { label: 'Kiểm tra lại', onClick: () => void shop.refreshIdentity().then((answer) => answer.kind === 'ok' && env.go('shop-home')) } })]),
      );
      return;
    }
    lockFields();
    if (step.code === 'VERSION_CONFLICT' || step.code === 'SHOP_EXISTS') {
      feedback.replaceChildren(failureOf(step, conflictRetry('')));
      return;
    }
    feedback.replaceChildren(failureOf(step, step.unresolved ? () => void runComplete() : undefined));
  };

  for (const [key, field] of fields) {
    field.input.addEventListener('input', () => {
      shop.setField(key, field.input.value);
      field.setError(undefined);
      drawActions();
    });
  }
  areaSelect.addEventListener('change', () => {
    shop.chooseArea(areaSelect.value === '' ? null : areaSelect.value);
    areaError.hidden = true;
    drawAreas();
    drawActions();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void runSave();
  });
  complete.addEventListener('click', () => {
    if (complete.getAttribute('aria-disabled') !== 'true') {
      void runComplete();
    }
  });

  // C08: unsaved shop details are asked about before leaving. Moving to F22 and back is part of the flow: nothing is asked then.
  env.guard({
    dirty: () => !shop.flowing() && shop.dirty(),
    wipe: () => shop.discardEdits(),
  });
  drawLocation();
  lockFields();
  void firstLoad();
  return appPage({ title: 'Hồ sơ cửa hàng', onBack: () => env.go('shop-start'), bodyClass: 'c-stack', body: [form] });
}

// ---- F22 ----------------------------------------------------------------------------------------------------------

export function liveShopLocation(env: ScreenEnv, shop: ShopController): HTMLElement {
  shop.arrive();
  const map = h(
    'div',
    { class: 'c-map', role: 'img', 'aria-label': 'Khung bản đồ chưa nối' },
    h('p', { class: 'c-map__note' }, 'Bản đồ chưa được nối trong bản này. Tọa độ, độ chính xác và thời điểm đo bên dưới là số liệu thật của thiết bị.'),
  );
  const info = h('div', { class: 'c-stack c-stack--tight', 'aria-live': 'polite', id: 'location-info' });
  const fetchButton = button({ label: 'Lấy vị trí hiện tại', kind: 'secondary', id: 'location-get', icon: 'locate' });
  const confirm = button({ label: 'Dùng vị trí này', kind: 'primary', id: 'location-confirm' });
  const confirmReason = reasonNote('Cần lấy vị trí hiện tại trước.', 'location-confirm-reason');
  confirm.setAttribute('aria-describedby', 'location-confirm-reason');
  let locating = false;

  const draw = (): void => {
    const state = shop.state();
    const editable = shop.editable();
    const candidate = state.candidate;
    fetchButton.hidden = !editable;
    confirm.hidden = !editable;
    confirmReason.hidden = !editable || candidate !== undefined;
    confirm.setAttribute('aria-disabled', String(candidate === undefined || locating));
    fetchButton.disabled = locating;
    const nodes: HTMLElement[] = [];
    if (locating) {
      nodes.push(banner({ kind: 'info', title: 'Đang xác định vị trí…', text: 'Giữ nguyên thiết bị trong lúc chờ.' }));
    }
    if (candidate !== undefined) {
      nodes.push(pointDetails(candidate));
    } else if (state.pickup !== undefined) {
      nodes.push(h('p', { class: 'c-lead' }, 'Vị trí đang dùng cho hồ sơ:'), pointDetails(state.pickup));
    }
    info.replaceChildren(...nodes);
  };

  fetchButton.addEventListener('click', () => {
    if (locating || !shop.editable()) {
      return;
    }
    locating = true;
    draw();
    void shop.locate().then((step) => {
      locating = false;
      if (step.kind === 'stale') {
        return;
      }
      draw();
      if (step.kind === 'failure') {
        // No position was produced: nothing is shown as a measurement.
        info.prepend(banner({ kind: 'warn', ...GEO_COPY[step.reason] }));
      }
    });
  });
  confirm.addEventListener('click', () => {
    if (confirm.getAttribute('aria-disabled') === 'true' || !shop.confirmCandidate()) {
      return;
    }
    shop.keepForFlow();
    env.go('shop-onboarding');
  });
  // An unconfirmed measurement is dropped when the person leaves; what was typed in F21 is kept (that screen decides what to ask).
  env.guard({ dirty: () => false, wipe: () => shop.discardCandidate() });
  draw();
  if (!shop.state().loaded) {
    void shop.load().then((step) => {
      if (step.kind === 'ok') {
        draw();
      }
    });
  }
  const back = (): void => {
    shop.keepForFlow();
    env.go('shop-onboarding');
  };
  return appPage({
    title: 'Vị trí lấy hàng',
    onBack: back,
    bodyClass: 'c-stack',
    body: [map, info, fetchButton, h('div', { class: 'c-stack c-stack--tight' }, confirm, confirmReason), textLink('Lưu hồ sơ không có vị trí', back)],
  });
}

// ---- F23 ----------------------------------------------------------------------------------------------------------

export function liveShopHome(env: ScreenEnv, shop: ShopController): HTMLElement {
  shop.arrive();
  const body = h('div', { class: 'c-stack', 'aria-live': 'polite', id: 'shop-home-body' }, loadingBanner());

  const show = async (): Promise<void> => {
    body.replaceChildren(loadingBanner());
    const step = await shop.load({ force: true });
    if (step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      body.replaceChildren(failureOf(step, () => void show()));
      return;
    }
    const current = shop.state().shop;
    if (current === null) {
      body.replaceChildren(banner({ kind: 'info', title: 'Chưa có hồ sơ cửa hàng', text: 'Hãy đăng ký cửa hàng để bắt đầu.', action: { label: 'Đăng ký cửa hàng', onClick: () => env.go('shop-start') } }));
      return;
    }
    const role = env.account?.activeRole;
    const statusChip = current.status === 'DISABLED' ? chip('Đang bị khóa', 'bad') : current.status === 'ACTIVE' ? chip('Hồ sơ hoàn tất', 'ok') : chip('Hồ sơ chưa hoàn tất', 'warn');
    const notice =
      current.status === 'DISABLED'
        ? banner({ kind: 'warn', title: 'Cửa hàng đang bị khóa', text: 'Bạn vẫn dùng tài khoản khách hàng bình thường. Liên hệ hỗ trợ để biết lý do.' })
        : current.status === 'INCOMPLETE'
          ? banner({ kind: 'info', title: 'Hồ sơ đang soạn dở', text: 'Hoàn tất hồ sơ để dùng cửa hàng.', action: { label: 'Tiếp tục hồ sơ', onClick: () => env.go('shop-onboarding') } })
          : banner({ kind: 'info', title: 'Hồ sơ đã hoàn tất', text: 'Quán chưa nhận đơn: tính năng nhận đơn, menu và doanh thu sẽ có sau.' });
    body.replaceChildren(
      h(
        'section',
        { class: 'c-card c-stack c-stack--tight', id: 'shop-home-card' },
        h('p', { class: 'c-title', id: 'shop-home-name' }, current.name),
        h('div', { class: 'c-row-flex c-row-flex--wrap' }, statusChip, chip(current.acceptingOrders ? 'Đang nhận đơn' : 'Chưa nhận đơn', current.acceptingOrders ? 'ok' : 'soon'), role === undefined || role === null ? undefined : chip(role === 'SHOP_OWNER' ? 'Đang ở: Chủ quán' : 'Đang ở: Khách hàng', 'info')),
        h('p', { class: 'c-lead' }, current.addressText),
      ),
      notice,
      list([
        listItem({ icon: 'store', title: 'Hồ sơ cửa hàng', onClick: () => env.go('shop-onboarding') }),
        listItem({ icon: 'mapPin', title: 'Vị trí lấy hàng', onClick: () => env.go('shop-location') }),
        listItem({ icon: 'utensils', title: 'Menu', soon: true }),
        listItem({ icon: 'receipt', title: 'Đơn hàng của quán', soon: true }),
        listItem({ icon: 'barChart', title: 'Doanh thu', soon: true }),
        listItem({ icon: 'user', title: 'Về giao diện khách hàng', onClick: () => void leaveToCustomer(env) }),
      ]),
    );
  };
  void show();
  return appPage({ title: 'Cửa hàng của tôi', onBack: () => env.go('account'), bodyClass: 'c-stack', body: [body] });
}
