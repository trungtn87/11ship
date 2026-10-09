import { shopMissingConditions } from '../core/projection.js';
import { validateShopProfile } from '../core/validation.js';
import { Alert, Badge, Button, Card, Field, Heading, Skeleton, setButtonLoading } from '../ui/components.js';
import { confirmDialog, h } from '../ui/dom.js';
import { failureAlert, focusFirstInvalid, replaceContent } from './shared.js';

const OP_SAVE = 'shop.profile.save';
const OP_COMPLETE = 'shop.complete';
const FIELD_KEYS = ['name', 'contact_phone', 'address_text', 'zalo', 'facebook', 'pickup_lat', 'pickup_lng', 'service_area_id'];

function toFormValues(profile) {
  const text = (value) => (value === null || value === undefined ? '' : String(value));
  return {
    name: text(profile?.name),
    contact_phone: text(profile?.contact_phone),
    address_text: text(profile?.address_text),
    zalo: text(profile?.zalo),
    facebook: text(profile?.facebook),
    pickup_lat: text(profile?.pickup_lat),
    pickup_lng: text(profile?.pickup_lng),
    service_area_id: text(profile?.service_area_id),
  };
}

function isProfileShape(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    typeof data.shop_id === 'string' &&
    ['INCOMPLETE', 'ACTIVE', 'DISABLED'].includes(data.status) &&
    Number.isSafeInteger(data.version) &&
    data.version >= 1
  );
}

export function renderShopOnboarding(ctx) {
  const host = h('div', { class: 'stack' }, Skeleton({ lines: 5 }));
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Hồ sơ Quán' }),
      h('p', { class: 'lead' }, 'Điền thông tin quán, lưu nháp, rồi hoàn tất khi đủ điều kiện.'),
      host,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => ctx.route() }, 'Quay lại')),
    ],
  });

  let profile = null; // the last SAVED profile from the server, or null before the first save
  let lastBody = null; // the frozen snapshot of the attempt that is in flight or unknown

  async function loadProfile({ notice } = {}) {
    replaceContent(host, Skeleton({ lines: 5 }));
    const result = await ctx.api.request({ method: 'GET', path: '/onboarding/shop/profile', signal: ctx.signal });
    if (result.stale || ctx.signal.aborted) {
      return;
    }
    if (!result.ok) {
      if (ctx.handleFailure(result) !== null) {
        return;
      }
      replaceContent(host, failureAlert(result, { actions: Button({ label: 'Thử lại', variant: 'secondary', onClick: () => loadProfile() }) }));
      return;
    }
    if (result.data === null) {
      profile = null;
      showForm(notice);
      return;
    }
    if (!isProfileShape(result.data)) {
      replaceContent(host, Alert({ tone: 'warning', message: 'Hồ sơ quán trả về chưa đúng định dạng. Thử lại sau.' }));
      return;
    }
    profile = result.data;
    if (profile.status === 'INCOMPLETE') {
      showForm(notice);
    } else {
      showReadonly();
    }
  }

  function showReadonly() {
    replaceContent(
      host,
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'Tên quán'),
        h('dd', null, profile.name),
        h('dt', null, 'Địa chỉ'),
        h('dd', null, profile.address_text),
        h('dt', null, 'Trạng thái hồ sơ'),
        h('dd', null, profile.status === 'ACTIVE' ? Badge({ tone: 'success', label: 'Đã hoàn tất' }) : Badge({ tone: 'danger', label: 'Quán đang tạm khóa' })),
      ),
      Alert({
        tone: profile.status === 'ACTIVE' ? 'success' : 'warning',
        message:
          profile.status === 'ACTIVE'
            ? 'Hồ sơ quán đã hoàn tất, không cần điền lại.'
            : 'Quán đang tạm khóa. Liên hệ đội vận hành 11Ship.',
      }),
      Button({ label: 'Tiếp tục', onClick: () => ctx.resolveAndRoute() }),
    );
  }

  function showSuccess() {
    replaceContent(
      host,
      Alert({
        tone: 'success',
        title: 'Đã hoàn tất hồ sơ quán',
        message: 'Tài khoản của bạn đã có vai trò Quán. Giờ mở cửa sẽ được cài ở bước sau.',
      }),
      Button({ label: 'Tiếp tục', onClick: () => ctx.route() }),
    );
    ctx.announce('Đã hoàn tất hồ sơ quán');
  }

  function showForm(initialNotice) {
    const values = toFormValues(profile);
    const fields = {
      name: Field({ label: 'Tên quán', required: true, inputAttrs: { name: 'name', autocomplete: 'organization', maxlength: '240' } }),
      contact_phone: Field({
        label: 'Số điện thoại liên hệ',
        required: true,
        help: 'Số khách và xế gọi tới quán. Ví dụ 0912345678.',
        inputAttrs: { type: 'tel', inputmode: 'tel', name: 'contact_phone', autocomplete: 'tel', maxlength: '24' },
      }),
      address_text: Field({ label: 'Địa chỉ lấy hàng', required: true, multiline: true, inputAttrs: { name: 'address_text', autocomplete: 'street-address', maxlength: '1000' } }),
      zalo: Field({ label: 'Zalo', inputAttrs: { name: 'zalo', maxlength: '320' } }),
      facebook: Field({ label: 'Facebook', inputAttrs: { name: 'facebook', maxlength: '600' } }),
      pickup_lat: Field({ label: 'Vĩ độ', help: 'Ví dụ 22.6657', inputAttrs: { inputmode: 'decimal', name: 'pickup_lat', maxlength: '24' } }),
      pickup_lng: Field({ label: 'Kinh độ', help: 'Ví dụ 106.2522', inputAttrs: { inputmode: 'decimal', name: 'pickup_lng', maxlength: '24' } }),
      service_area_id: Field({
        label: 'Mã khu vực phục vụ',
        help: 'Mã do đội vận hành cấp. Bản thử nghiệm chưa có danh sách khu vực để chọn.',
        inputAttrs: { name: 'service_area_id', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '40' },
      }),
    };
    for (const key of FIELD_KEYS) {
      fields[key].input.value = values[key];
    }
    const fieldList = FIELD_KEYS.map((key) => fields[key]);

    const alertHost = h('div', { class: 'form-alert' });
    const conditionsHost = h('div', { class: 'conditions' });
    const geoHelp = h('p', { class: 'help' });
    let busy = false;
    let unknown = false;

    const saveButton = Button({ label: 'Lưu nháp', variant: 'secondary', type: 'submit' });
    const completeButton = Button({ label: 'Hoàn tất hồ sơ quán', variant: 'primary', onClick: () => complete() });
    const completeHint = h('p', { class: 'help' });
    const fieldset = h('fieldset', { class: 'fieldset' });

    function readForm() {
      return Object.fromEntries(FIELD_KEYS.map((key) => [key, fields[key].input.value]));
    }
    function savedValues() {
      return toFormValues(profile);
    }
    function isDirty() {
      const current = readForm();
      const saved = savedValues();
      return FIELD_KEYS.some((key) => current[key].trim() !== saved[key].trim());
    }

    function renderConditions() {
      const missing = shopMissingConditions(profile ?? { name: '', contact_phone: '', address_text: '', pickup_lat: null, pickup_lng: null, service_area_id: null });
      replaceContent(
        conditionsHost,
        h('h2', { class: 'h3' }, 'Điều kiện để hoàn tất'),
        h(
          'ul',
          { class: 'checklist' },
          missing.items.map((item) =>
            h('li', { class: item.done ? 'done' : 'todo' }, h('span', { class: 'check-mark', 'aria-hidden': 'true' }, item.done ? '✓' : '○'), item.done ? `${item.label} — đã có` : `${item.label} — còn thiếu`),
          ),
        ),
        profile === null ? h('p', { class: 'help' }, 'Hồ sơ chưa được lưu. Bấm "Lưu nháp" để lưu lần đầu.') : null,
      );
      return missing;
    }

    function refreshCompleteState() {
      const missing = shopMissingConditions(profile ?? { name: '', contact_phone: '', address_text: '', pickup_lat: null, pickup_lng: null, service_area_id: null });
      const dirty = isDirty();
      const can = profile !== null && missing.complete && !dirty && !busy && !unknown;
      completeButton.setAttribute('aria-disabled', can ? 'false' : 'true');
      if (can) completeButton.removeAttribute('aria-disabled');
      completeHint.textContent = can
        ? ''
        : profile === null
          ? 'Lưu nháp trước, rồi bổ sung vị trí và khu vực để hoàn tất.'
          : dirty
            ? 'Bạn có thay đổi chưa lưu. Bấm "Lưu nháp" trước khi hoàn tất.'
            : !missing.complete
              ? 'Còn thiếu vị trí lấy hàng hoặc khu vực phục vụ. Bổ sung rồi lưu nháp.'
              : '';
    }

    function lock(locked) {
      busy = locked;
      fieldset.disabled = locked || unknown;
      refreshCompleteState();
    }

    function showUnknown(op) {
      unknown = true;
      fieldset.disabled = true;
      refreshCompleteState();
      const retry = Button({
        label: 'Thử lại (giữ nguyên nội dung)',
        onClick: () => (op === OP_SAVE ? doSave(lastBody) : doComplete(lastBody)),
      });
      const reload = Button({
        label: 'Tải lại hồ sơ từ máy chủ',
        variant: 'secondary',
        onClick: async () => {
          ctx.mutations.discard(op);
          unknown = false;
          await loadProfile({ notice: { tone: 'info', message: 'Đã tải hồ sơ mới nhất từ máy chủ.' } });
        },
      });
      replaceContent(
        alertHost,
        Alert({
          tone: 'warning',
          title: 'Chưa biết yêu cầu đã được lưu hay chưa',
          message: 'Kết nối bị gián đoạn nên chưa nhận được phản hồi. Bấm Thử lại để gửi lại đúng nội dung cũ (an toàn, không bị lưu hai lần), hoặc tải lại hồ sơ để xem hiện trạng.',
          actions: [retry, reload],
        }),
      );
    }

    async function afterFailure(result, op) {
      if (result.stale) return;
      if (result.kind === 'local') {
        if (result.code === 'UNKNOWN_BODY_CHANGED') showUnknown(op);
        return;
      }
      if (ctx.handleFailure(result) !== null) return;
      if (ctx.mutations.hasUnknown(op)) {
        showUnknown(op);
        return;
      }
      if (result.kind === 'http' && ['VERSION_CONFLICT', 'SHOP_ONBOARDING_EXISTS'].includes(result.code)) {
        await loadProfile({ notice: { tone: 'warning', failure: result } });
        return;
      }
      if (result.kind === 'http' && result.code === 'SHOP_PROFILE_INCOMPLETE') {
        await loadProfile({ notice: { tone: 'warning', failure: result } });
        return;
      }
      replaceContent(alertHost, failureAlert(result));
    }

    async function doSave(body) {
      lastBody = body;
      unknown = false;
      replaceContent(alertHost);
      lock(true);
      setButtonLoading(saveButton, true, 'Lưu nháp', 'Đang lưu…');
      const result = await ctx.mutations.submit(OP_SAVE, { method: 'PUT', path: '/onboarding/shop/profile', body, userId: ctx.state.me.userId });
      setButtonLoading(saveButton, false, 'Lưu nháp');
      lock(false);
      if (result.ok) {
        lastBody = null;
        await loadProfile({ notice: { tone: 'success', message: 'Đã lưu nháp hồ sơ quán.' } });
        return;
      }
      await afterFailure(result, OP_SAVE);
    }

    async function doComplete(body) {
      lastBody = body;
      unknown = false;
      replaceContent(alertHost);
      lock(true);
      setButtonLoading(completeButton, true, 'Hoàn tất hồ sơ quán', 'Đang hoàn tất…');
      const result = await ctx.mutations.submit(OP_COMPLETE, { method: 'POST', path: '/onboarding/shop/complete', body, userId: ctx.state.me.userId });
      setButtonLoading(completeButton, false, 'Hoàn tất hồ sơ quán');
      lock(false);
      if (result.ok) {
        lastBody = null;
        const fresh = await ctx.refreshMe();
        if (fresh.stale || fresh.handled) return;
        showSuccess();
        return;
      }
      await afterFailure(result, OP_COMPLETE);
    }

    async function complete() {
      if (completeButton.getAttribute('aria-disabled') === 'true' || busy) {
        return;
      }
      const confirmed = await confirmDialog({
        title: 'Hoàn tất hồ sơ quán?',
        body: 'Sau khi hoàn tất, tài khoản sẽ có vai trò Quán và không sửa hồ sơ ở bước này nữa. Hãy chắc thông tin đã đúng.',
        confirmLabel: 'Hoàn tất hồ sơ',
      });
      if (confirmed) {
        await doComplete(Object.freeze({ expected_version: profile.version }));
      }
    }

    const geoButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Dùng vị trí hiện tại');
    geoButton.addEventListener('click', () => {
      if (!('geolocation' in navigator)) {
        replaceContent(alertHost, Alert({ tone: 'warning', message: 'Thiết bị này không hỗ trợ lấy vị trí. Hãy nhập tọa độ thủ công.' }));
        return;
      }
      geoButton.setAttribute('aria-busy', 'true');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          geoButton.removeAttribute('aria-busy');
          fields.pickup_lat.input.value = position.coords.latitude.toFixed(6);
          fields.pickup_lng.input.value = position.coords.longitude.toFixed(6);
          fields.pickup_lat.setError(null);
          fields.pickup_lng.setError(null);
          refreshCompleteState();
        },
        (error) => {
          geoButton.removeAttribute('aria-busy');
          const message =
            error.code === 1
              ? 'Chưa được cấp quyền vị trí. Bạn có thể nhập tọa độ thủ công.'
              : error.code === 3
                ? 'Lấy vị trí quá lâu. Thử lại hoặc nhập tọa độ thủ công.'
                : 'Chưa xác định được vị trí. Thử lại hoặc nhập tọa độ thủ công.';
          replaceContent(alertHost, Alert({ tone: 'warning', message }));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
    geoHelp.textContent = window.isSecureContext
      ? 'Trình duyệt sẽ hỏi quyền vị trí. Có thể từ chối và nhập tay.'
      : 'Lấy vị trí tự động chỉ chạy trên HTTPS hoặc localhost. Hãy nhập tọa độ thủ công.';

    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          if (busy || unknown) return;
          for (const field of fieldList) field.setError(null);
          const checked = validateShopProfile(readForm(), profile === null ? null : profile.version);
          if (checked.value === undefined) {
            for (const key of FIELD_KEYS) fields[key].setError(checked.errors[key]);
            focusFirstInvalid(fieldList);
            return;
          }
          doSave(checked.value);
        },
        onInput: () => refreshCompleteState(),
      },
      fieldset,
    );
    fieldset.append(
      fields.name.root,
      fields.contact_phone.root,
      fields.address_text.root,
      fields.zalo.root,
      fields.facebook.root,
      h(
        'div',
        { class: 'group' },
        h('h2', { class: 'h3' }, 'Vị trí lấy hàng'),
        h('div', { class: 'grid-2' }, fields.pickup_lat.root, fields.pickup_lng.root),
        geoButton,
        geoHelp,
      ),
      fields.service_area_id.root,
    );

    const first = initialNotice;
    renderConditions();
    refreshCompleteState();
    replaceContent(
      host,
      first?.failure ? failureAlert(first.failure, { tone: first.tone }) : first ? Alert({ tone: first.tone, message: first.message }) : null,
      conditionsHost,
      form,
      alertHost,
      h('div', { class: 'actions' }, saveButton, completeButton),
      completeHint,
    );
    // The submit button sits outside the <form>: tie it back with the form attribute.
    const formId = `shop-form-${Date.now()}`;
    form.id = formId;
    saveButton.setAttribute('form', formId);
    if (first?.tone === 'success') ctx.announce(first.message);
  }

  loadProfile();
  return { title: 'Hồ sơ Quán', el, layout: 'app' };
}
