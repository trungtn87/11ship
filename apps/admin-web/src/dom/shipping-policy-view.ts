import {
  CONDITION_BOUNDS,
  ConditionsRead,
  ConditionsState,
  ConditionValues,
  describeChanges,
  EditingModel,
  formatFee,
  formatKm,
  formatMinutes,
  NOT_WIRED_SHIPPING_REASON,
  parseBounded,
  parseKm,
  parseMinutes,
  PolicyState,
  PolicyTable,
  PolicyVersionInfo,
  PolicyWriteResult,
  PreviewResult,
  SHIPPING_TIER_COUNT,
  SHIPPING_REFUSAL_MESSAGE,
  ShippingPolicySource,
  toEditing,
  validateEditing,
} from '../core/shipping-policy.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Hệ thống › Phí & điều kiện giao" (M06-A/D). Three tabs as approved: Bảng giá ship (the editable fee table with its draft, the
// preview and the apply), Điều kiện nhận & ghép (the approved rules, shown read-only until M06-B/C connect them) and Lịch sử chính sách
// (the immutable versions). The page decides no right and no rule: it draws what the server said, tells the person what is wrong while they
// type (the server checks again) and sends one request per click. SYSTEM edits; every other administrator only reads and previews.
// Every node is created with createElement/textContent (no innerHTML).

export interface ShippingPolicyHost {
  readonly source: ShippingPolicySource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** SYSTEM changes the table; every other administrator only reads it. The server refuses a write from anyone else. */
  readonly canEdit: boolean;
  readonly dialogHost?: HTMLElement;
}

type TabId = 'prices' | 'conditions' | 'history';
const TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: 'prices', label: 'Bảng giá ship' },
  { id: 'conditions', label: 'Điều kiện nhận & ghép' },
  { id: 'history', label: 'Lịch sử chính sách' },
];

const PREVIEW_PAUSE_MS = 300;
const DEFAULT_PREVIEW_KM = '5.5';

function writeText(result: PolicyWriteResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Bảng giá vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem bản mới nhất.';
    case 'forbidden':
      return 'Chỉ tài khoản SYSTEM được thay đổi bảng giá.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return SHIPPING_REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

const sameTable = (a: PolicyTable | null | undefined, b: PolicyTable | null | undefined): boolean => (a ?? null) !== null && (b ?? null) !== null && JSON.stringify(a) === JSON.stringify(b);

function bandLabel(band: number, table: PolicyTable): string {
  const tier = table.tiers[band];
  return tier === undefined ? `Khung ${String(band + 1)}` : `Khung ${String(band + 1)} (${formatKm(tier.fromM)}–${formatKm(tier.toM)} km)`;
}

export class ShippingPolicyView {
  readonly #body: HTMLElement;
  readonly #tabBar: HTMLElement;
  #tab: TabId = 'prices';
  #state: PolicyState | undefined;
  #conditionsRead: ConditionsRead | undefined;
  #pendingConditions: { readonly version: number; readonly values: ConditionValues; readonly key: string } | undefined;
  #model: EditingModel = toEditing(null);
  #latest = 0;
  #previewToken = 0;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #previewKm = DEFAULT_PREVIEW_KM;
  #disposed = false;
  #handle: DialogHandle | undefined;
  /** The unanswered write, kept so "Thử lại" sends exactly the same request (same keys, same table). */
  #pending: { readonly table: PolicyTable; readonly note: string | null; stage: 'save' | 'apply'; draftVersion: number; readonly saveKey: string; readonly applyKey: string } | undefined;
  #pendingSave: { readonly version: number; readonly table: PolicyTable; readonly key: string } | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShippingPolicyHost,
  ) {
    this.#body = h('div', { class: 'sp-body' });
    this.#tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Phí và điều kiện giao hàng' });
    root.replaceChildren(
      h(
        'section',
        { class: 'content', 'aria-labelledby': 'sp-title' },
        h(
          'header',
          { class: 'page-head' },
          h('div', {}, h('p', { class: 'eyebrow' }, 'Cài đặt / M06'), h('h1', { class: 'title', tabindex: '-1', id: 'sp-title' }, 'Phí & điều kiện giao hàng'), h('p', { class: 'lead lead-last' }, 'Admin quản lý bảng giá, giới hạn nhận đơn và chính sách ghép')),
        ),
        this.#tabBar,
        this.#body,
      ),
    );
    this.#drawTabs();
  }

  dispose(): void {
    this.#disposed = true;
    this.#handle?.close();
    this.#handle = undefined;
    clearTimeout(this.#previewTimer);
  }

  async load(notice?: string): Promise<void> {
    const token = ++this.#latest;
    this.#pending = undefined;
    this.#pendingSave = undefined;
    this.#body.replaceChildren(skeleton(4));
    const [read, conditions] = await Promise.all([this.host.source.read(), this.host.source.readConditions()]);
    this.#conditionsRead = conditions;
    this.#pendingConditions = undefined;
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason || NOT_WIRED_SHIPPING_REASON));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#body.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#state = read.state;
    this.#model = toEditing(read.state.draft.table ?? (read.state.active !== null && !read.state.active.legacy ? read.state.active : null));
    this.#draw(notice);
  }

  #drawTabs(): void {
    this.#tabBar.replaceChildren(
      ...TABS.map((item) => {
        const button = h('button', { type: 'button', role: 'tab', class: `tab${item.id === this.#tab ? ' tab-active' : ''}`, 'aria-selected': String(item.id === this.#tab), id: `sp-tab-${item.id}` }, item.label);
        button.addEventListener('click', () => {
          if (this.#tab !== item.id) {
            this.#tab = item.id;
            this.#drawTabs();
            if (this.#state !== undefined) {
              this.#draw();
            }
          }
        });
        return button;
      }),
    );
  }

  #draw(notice?: string): void {
    const state = this.#state;
    if (state === undefined) {
      return;
    }
    clearTimeout(this.#previewTimer);
    this.#previewToken += 1;
    switch (this.#tab) {
      case 'prices':
        this.#body.replaceChildren(this.#prices(state, notice));
        return;
      case 'conditions':
        this.#body.replaceChildren(this.#conditions(notice));
        return;
      case 'history':
        this.#body.replaceChildren(this.#history(state));
    }
  }

  // ---- Bảng giá ship ----------------------------------------------------------------------------------------------------

  #prices(state: PolicyState, notice: string | undefined): HTMLElement {
    const canEdit = this.host.canEdit;
    const rowsHost = h('div', { class: 'sp-rows' });
    const verdict = h('p', { class: 'sp-verdict', id: 'sp-verdict', role: 'status' });
    const status = message('error', 'sp-status');
    const save = secondary('Lưu bản nháp');
    const apply = primary('Áp dụng bảng giá', 'button');
    let refresh: () => void = () => undefined;
    const changed = (): void => refresh();
    const preview = this.#previewCard();
    const legacy = state.active?.legacy === true;

    refresh = (): void => {
      const { table, problems } = validateEditing(this.#model);
      for (let index = 0; index < SHIPPING_TIER_COUNT; index += 1) {
        const from = rowsHost.querySelector<HTMLElement>(`#sp-row-${String(index)}-from`);
        if (from !== null) {
          from.textContent = index === 0 ? '0' : this.#model.bounds[index - 1] || '…';
        }
        for (const [field, problem] of [['to', problems.bounds[index]], ['fee', problems.fees[index]]] as const) {
          const input = rowsHost.querySelector<HTMLInputElement>(`#sp-row-${String(index)}-${field}`);
          const error = rowsHost.querySelector<HTMLElement>(`#sp-row-${String(index)}-${field}-error`);
          if (input !== null && error !== null) {
            setMessage(error, problem);
            input.setAttribute('aria-invalid', String(problem !== undefined));
          }
        }
      }
      const ok = table !== undefined;
      const active = state.active !== null && !state.active.legacy ? state.active : null;
      const identicalToActive = ok && active !== null && sameTable(table, active) && state.draft.table === null;
      const dirty = ok && !sameTable(table, state.draft.table);
      verdict.className = `sp-verdict ${ok ? 'sp-verdict-ok' : 'sp-verdict-bad'}`;
      verdict.textContent = ok
        ? `✓ Ba khung liên tục, không chồng lấn. ${
            state.active === null ? 'Chưa có bảng giá nào được áp dụng: hệ thống chưa tính được phí.' : legacy ? `Phiên bản ${String(state.active.versionNo)} dùng định dạng cũ nên không dùng để tính phí: hãy áp dụng bảng giá 3 khung này.` : `Đang áp dụng phiên bản ${String(state.active.versionNo)}.`
          }`
        : 'Bảng giá chưa hợp lệ. Hãy sửa các ô báo lỗi trước khi lưu.';
      save.disabled = !ok || !dirty;
      apply.disabled = !ok || identicalToActive;
      this.#schedulePreview(preview, table);
    };

    rowsHost.replaceChildren(
      h('div', { class: 'sp-row sp-row-head', 'aria-hidden': 'true' }, h('span', {}, 'Từ (km)'), h('span', {}, 'Đến (km)'), h('span', {}, 'Phí ship (đ)')),
      ...[0, 1, 2].map((index) => this.#row(index, canEdit, changed)),
    );

    save.addEventListener('click', () => void this.#saveDraft(status, save, apply));
    apply.addEventListener('click', () => this.#confirmApply(state));
    status.className = 'message message-error';
    if (notice !== undefined) {
      status.className = 'message message-notice';
      setMessage(status, notice);
    }

    const left = h(
      'div',
      { class: 'sp-card' },
      h(
        'div',
        { class: 'sp-card-head' },
        h('div', {}, h('h2', { class: 'subtitle' }, 'Ba khung tính phí'), h('p', { class: 'hint' }, 'Đúng 3 khung: chỉnh mốc khoảng cách và phí của từng khung. Khung 1 và 2 tính đến dưới mốc; khung 3 gồm cả mốc cuối.')),
      ),
      legacy
        ? h('p', { class: 'sp-note', role: 'note', id: 'sp-legacy-note' }, `Phiên bản ${String(state.active?.versionNo ?? '')} dùng định dạng cũ (nhiều khung và công thức cộng thêm) nên không còn dùng để tính phí. Nhập ba khung mới bên dưới và áp dụng.`)
        : undefined,
      rowsHost,
      h('p', { class: 'hint', id: 'sp-range-note' }, 'Phí tính theo quãng đường tuyến đường thực tế (mét gốc từ M14, không làm tròn km). Quá mốc cuối: “Ngoài bảng giá”, phí chưa xác định (không phải 0đ), không tự cộng thêm tiền; chỉ đi tiếp khi có phí thỏa thuận hợp lệ.'),
      verdict,
    );
    const right = h(
      'div',
      { class: 'sp-side' },
      preview.element,
      status,
      canEdit
        ? h('div', { class: 'detail-actions sp-actions' }, save, apply)
        : h('p', { class: 'hint', id: 'sp-readonly' }, 'Bạn chỉ có quyền xem và thử tính phí. Chỉ tài khoản SYSTEM được chỉnh sửa bảng giá.'),
    );
    queueMicrotask(refresh);
    return h('div', { class: 'sp-grid' }, left, right);
  }

  #row(index: number, canEdit: boolean, changed: () => void): HTMLElement {
    const cell = (field: 'to' | 'fee', label: string, set: (value: string) => void, value: string): HTMLElement => {
      const id = `sp-row-${String(index)}-${field}`;
      const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `Khung ${String(index + 1)}: ${label}`, 'aria-describedby': `${id}-error` });
      input.value = value;
      input.readOnly = !canEdit;
      input.addEventListener('input', () => {
        set(input.value);
        changed();
      });
      return h('div', { class: 'sp-cell' }, h('div', { class: 'input-wrap' }, input), message('error', `${id}-error`));
    };
    return h(
      'div',
      { class: 'sp-row' },
      h('div', { class: 'sp-cell sp-from' }, h('span', { id: `sp-row-${String(index)}-from`, class: 'sp-from-value' }, index === 0 ? '0' : this.#model.bounds[index - 1] || '…')),
      cell('to', index === 2 ? 'Đến (km, gồm cả mốc)' : 'Đến dưới (km)', (v) => (this.#model.bounds[index] = v), this.#model.bounds[index] as string),
      cell('fee', 'Phí ship (đ)', (v) => (this.#model.fees[index] = v), this.#model.fees[index] as string),
    );
  }

  /** The fixed search radius as the server states it (read-only, never an input). */
  #radiusText(): string {
    const read = this.#conditionsRead;
    return read?.kind === 'ready' ? `${formatKm(read.state.searchRadiusM)} km (cố định, chỉ đọc)` : '—';
  }

  // ---- thử tính phí ----------------------------------------------------------------------------------------------------

  #previewCard(): { readonly element: HTMLElement; readonly input: HTMLInputElement; readonly result: HTMLElement; readonly sub: HTMLElement } {
    const input = h('input', { id: 'sp-preview-km', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'sp-preview-error' });
    input.value = this.#previewKm;
    const error = message('error', 'sp-preview-error');
    const amount = h('p', { class: 'sp-result-amount', id: 'sp-preview-fee', role: 'status' }, '—');
    const sub = h('p', { class: 'sp-result-sub', id: 'sp-preview-sub' }, 'Nhập quãng đường để thử tính.');
    const result = h('div', { class: 'sp-result' }, h('p', { class: 'sp-result-label' }, 'Phí dự kiến'), amount, sub);
    const element = h(
      'div',
      { class: 'sp-card' },
      h('h2', { class: 'subtitle' }, 'Thử tính phí'),
      h('p', { class: 'hint' }, 'Không ảnh hưởng bảng giá đang áp dụng.'),
      h('div', { class: 'field' }, h('label', { for: 'sp-preview-km', class: 'label' }, 'Quãng đường giao (km)'), h('div', { class: 'input-wrap' }, input), error),
      result,
      h(
        'dl',
        { class: 'kvs' },
        h('div', { class: 'kv' }, h('dt', {}, 'Từ'), h('dd', {}, 'Tọa độ quán M02')),
        h('div', { class: 'kv' }, h('dt', {}, 'Đến'), h('dd', {}, 'Điểm giao của đơn')),
        h('div', { class: 'kv' }, h('dt', {}, 'Nguồn khoảng cách'), h('dd', {}, 'M14 — tuyến đường (mét)')),
        h('div', { class: 'kv' }, h('dt', {}, 'Bán kính tìm shipper'), h('dd', { id: 'sp-preview-radius' }, this.#radiusText())),
      ),
      h('p', { class: 'sp-note', role: 'note' }, 'Dữ liệu đường và vị trí do M14 cung cấp. M06 chỉ dùng khoảng cách để tính phí, không quản lý GPS.'),
    );
    return { element, input, result: amount, sub };
  }

  #schedulePreview(card: { readonly input: HTMLInputElement; readonly result: HTMLElement; readonly sub: HTMLElement }, table: PolicyTable | undefined): void {
    const run = (): void => {
      clearTimeout(this.#previewTimer);
      const token = ++this.#previewToken;
      const metres = parseKm(card.input.value);
      const errorEl = card.input.closest('.field')?.querySelector<HTMLElement>('.message');
      setMessage(errorEl ?? h('span'), metres === undefined && card.input.value.trim() !== '' ? 'Nhập số km (tối đa 3 chữ số thập phân).' : undefined);
      if (metres === undefined) {
        this.#paintPreview(card, undefined, '—', 'Nhập quãng đường để thử tính.');
        return;
      }
      if (table === undefined) {
        this.#paintPreview(card, undefined, '—', 'Hoàn thiện bảng giá hợp lệ để thử tính phí.');
        return;
      }
      this.#previewTimer = setTimeout(() => {
        void this.host.source.preview(metres, table).then((result) => {
          if (!this.#disposed && token === this.#previewToken) {
            this.#paintResult(card, result, table);
          }
        });
      }, PREVIEW_PAUSE_MS);
    };
    card.input.oninput = () => {
      this.#previewKm = card.input.value;
      run();
    };
    run();
  }

  #paintResult(card: { readonly result: HTMLElement; readonly sub: HTMLElement }, result: PreviewResult, table: PolicyTable): void {
    switch (result.kind) {
      case 'priced':
        this.#paintPreview(card, 'ok', formatFee(result.feeVnd), `Tính theo bảng giá đang chỉnh sửa · ${bandLabel(result.band, table)}`);
        return;
      case 'unpriced':
        if (result.reason === 'OUT_OF_PRICE_RANGE') {
          this.#paintPreview(card, undefined, 'Ngoài bảng giá', 'Quãng đường vượt mốc cuối: phí chưa xác định (không phải 0đ, không tự cộng thêm). Chỉ đi tiếp khi có phí thỏa thuận hợp lệ.');
        } else {
          this.#paintPreview(card, undefined, 'Chưa xác định phí', 'Chưa tính được phí: không có đủ dữ liệu. Phí không bao giờ mặc định 0đ.');
        }
        return;
      case 'not-wired':
        this.#paintPreview(card, undefined, '—', 'Chức năng này chưa được nối với máy chủ.');
        return;
      default:
        this.#paintPreview(card, undefined, '—', 'Chưa thử tính được lúc này. Hãy thử lại.');
    }
  }

  #paintPreview(card: { readonly result: HTMLElement; readonly sub: HTMLElement }, tone: 'ok' | undefined, amount: string, text: string): void {
    card.result.textContent = amount;
    card.result.className = `sp-result-amount${tone === 'ok' ? '' : ' sp-result-none'}`;
    card.sub.textContent = text;
  }

  // ---- lưu nháp / áp dụng -----------------------------------------------------------------------------------------------

  async #saveDraft(status: HTMLElement, save: HTMLButtonElement, apply: HTMLButtonElement): Promise<void> {
    const state = this.#state;
    const { table } = validateEditing(this.#model);
    if (state === undefined || table === undefined) {
      return;
    }
    let intent = this.#pendingSave;
    if (intent === undefined) {
      intent = { version: state.draft.version, table, key: this.host.newKey() };
      this.#pendingSave = intent;
    }
    save.disabled = true;
    apply.disabled = true;
    save.textContent = 'Đang lưu…';
    const result = await this.host.source.saveDraft(intent);
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'ok') {
      this.#pendingSave = undefined;
      await this.load('Đã lưu bản nháp. Bản nháp chưa có hiệu lực cho đến khi bấm “Áp dụng bảng giá”.');
      return;
    }
    if (result.kind === 'session-expired') {
      this.host.onSessionLost();
      return;
    }
    if (result.kind === 'forbidden') {
      this.host.onForbidden();
    }
    if (result.kind !== 'unknown') {
      this.#pendingSave = undefined;
    }
    save.disabled = false;
    apply.disabled = false;
    save.textContent = result.kind === 'unknown' ? 'Thử lại' : result.kind === 'conflict' ? 'Tải lại' : 'Lưu bản nháp';
    if (result.kind === 'conflict') {
      save.onclick = () => void this.load();
    }
    status.className = `message message-${result.kind === 'unknown' || result.kind === 'conflict' ? 'warning' : 'error'}`;
    setMessage(status, writeText(result));
  }

  #confirmApply(state: PolicyState): void {
    const { table } = validateEditing(this.#model);
    if (table === undefined) {
      return;
    }
    const noteInput = h('input', { id: 'sp-note', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'VD: Điều chỉnh giá mốc 2–4 km' });
    const noteField = h('div', { class: 'field' }, h('label', { for: 'sp-note', class: 'label' }, 'Ghi chú phiên bản (không bắt buộc)'), h('div', { class: 'input-wrap' }, noteInput));
    const status = message('error', 'sp-apply-status');
    const cancel = secondary('Hủy');
    const confirm = primary('Áp dụng', 'button');
    const nextNo = (state.active?.versionNo ?? 0) + 1;
    let again = false;
    const lock = (working: boolean): void => {
      noteInput.disabled = working || again;
      cancel.disabled = working || again;
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
    };
    const finish = async (): Promise<void> => {
      let pending = this.#pending;
      if (pending === undefined) {
        const note = noteInput.value.normalize('NFC').replace(/\s+/gu, ' ').trim();
        if ([...note].length > 200) {
          setMessage(status, 'Ghi chú tối đa 200 ký tự.');
          return;
        }
        const needsSave = !sameTable(table, state.draft.table);
        pending = { table, note: note === '' ? null : note, stage: needsSave ? 'save' : 'apply', draftVersion: state.draft.version, saveKey: this.host.newKey(), applyKey: this.host.newKey() };
        this.#pending = pending;
      }
      lock(true);
      confirm.textContent = 'Đang áp dụng…';
      let result: PolicyWriteResult = { kind: 'ok' };
      if (pending.stage === 'save') {
        result = await this.host.source.saveDraft({ version: pending.draftVersion, table: pending.table, key: pending.saveKey });
        if (result.kind === 'ok') {
          // A save advances the draft's version by exactly one (the server's rule).
          pending.draftVersion += 1;
          pending.stage = 'apply';
        }
      }
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        result = await this.host.source.apply({ version: pending.draftVersion, note: pending.note, key: pending.applyKey });
      }
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#handle?.close();
        this.#handle = undefined;
        await this.load(`Đã áp dụng bảng giá phiên bản ${String(nextNo)}. Đơn đã chốt trước đó giữ nguyên phí.`);
        return;
      }
      if (result.kind === 'session-expired') {
        this.host.onSessionLost();
        return;
      }
      if (result.kind === 'forbidden') {
        this.host.onForbidden();
      }
      again = result.kind === 'unknown';
      if (result.kind !== 'unknown') {
        this.#pending = undefined;
      }
      confirm.textContent = again ? 'Thử lại' : result.kind === 'conflict' ? 'Tải lại' : 'Áp dụng';
      if (result.kind === 'conflict') {
        confirm.onclick = () => {
          this.#handle?.close();
          this.#handle = undefined;
          void this.load();
        };
      }
      lock(false);
      status.className = `message message-${again || result.kind === 'conflict' ? 'warning' : 'error'}`;
      setMessage(status, writeText(result));
    };
    confirm.addEventListener('click', () => void finish());
    cancel.addEventListener('click', () => {
      this.#handle?.close();
      this.#handle = undefined;
    });
    this.#handle?.close();
    this.#handle = openDialog({
      host: this.host.dialogHost,
      title: `Áp dụng bảng giá phiên bản ${String(nextNo)}?`,
      onDismiss: () => {
        if (!again) {
          this.#handle?.close();
          this.#handle = undefined;
          this.#pending = undefined;
        }
      },
      body: [
        h('p', { class: 'dialog-warning dialog-warning-info', role: 'note' }, icon('info', 18), h('span', {}, 'Các đơn tạo SAU khi áp dụng sẽ tính phí theo bảng này. Phí đã chốt của đơn cũ không thay đổi. Phiên bản đã áp dụng không sửa được; muốn đổi phải áp dụng phiên bản mới. Việc áp dụng được ghi nhật ký (người thực hiện, thời gian).')),
        ...describeChanges(state.active, table, state.active?.legacy === true).map((line) => h('p', { class: 'hint' }, line)),
        noteField,
        status,
      ],
      actions: [cancel, confirm],
    });
  }

  // ---- Điều kiện nhận & ghép --------------------------------------------------------------------------------------------

  #conditions(notice?: string): HTMLElement {
    const read = this.#conditionsRead;
    if (read === undefined || read.kind === 'not-wired') {
      return h('div', { class: 'sp-card' }, notWiredPanel(read?.reason || NOT_WIRED_SHIPPING_REASON));
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      return h('div', { class: 'sp-card' }, failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
    }
    return this.#conditionsForm(read.state, notice);
  }

  #conditionsForm(state: ConditionsState, notice: string | undefined): HTMLElement {
    const canEdit = this.host.canEdit;
    const status = message('error', 'sp-cond-status');
    const save = primary('Lưu tham số', 'button');
    const field = (id: string, value: string, unit: string): { readonly input: HTMLInputElement; readonly error: HTMLElement; readonly element: HTMLElement } => {
      const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': `${id}-error`, 'aria-label': unit });
      input.value = value;
      input.readOnly = !canEdit;
      const error = message('error', `${id}-error`);
      return { input, error, element: h('div', { class: 'sp-value-field' }, h('div', { class: 'input-wrap' }, input), h('span', { class: 'sp-unit' }, unit), error) };
    };
    const external = field('sp-cond-external', String(state.externalMax), 'đơn');
    const delay = field('sp-cond-delay', formatMinutes(state.delaySeconds), 'phút');
    const pickup = field('sp-cond-pickup', String(state.pickupSeconds), 'giây');
    const handoff = field('sp-cond-handoff', String(state.handoffSeconds), 'giây');
    const read = (): ConditionValues | undefined => {
      const values = {
        externalMax: parseBounded(external.input.value, CONDITION_BOUNDS.externalMax),
        delaySeconds: parseMinutes(delay.input.value),
        pickupSeconds: parseBounded(pickup.input.value, CONDITION_BOUNDS.pickupSeconds),
        handoffSeconds: parseBounded(handoff.input.value, CONDITION_BOUNDS.handoffSeconds),
      };
      setMessage(external.error, values.externalMax === undefined ? `Nhập số nguyên từ ${String(CONDITION_BOUNDS.externalMax[0])} đến ${String(CONDITION_BOUNDS.externalMax[1])}.` : undefined);
      setMessage(delay.error, values.delaySeconds === undefined ? 'Nhập số phút từ 0 đến 60 (tối đa 2 chữ số thập phân).' : undefined);
      setMessage(pickup.error, values.pickupSeconds === undefined ? `Nhập số giây nguyên từ 0 đến ${String(CONDITION_BOUNDS.pickupSeconds[1])}.` : undefined);
      setMessage(handoff.error, values.handoffSeconds === undefined ? `Nhập số giây nguyên từ 0 đến ${String(CONDITION_BOUNDS.handoffSeconds[1])}.` : undefined);
      return values.externalMax === undefined || values.delaySeconds === undefined || values.pickupSeconds === undefined || values.handoffSeconds === undefined
        ? undefined
        : { externalMax: values.externalMax, delaySeconds: values.delaySeconds, pickupSeconds: values.pickupSeconds, handoffSeconds: values.handoffSeconds };
    };
    const send = async (): Promise<void> => {
      let pending = this.#pendingConditions;
      if (pending === undefined) {
        const values = read();
        if (values === undefined) {
          return;
        }
        if (values.externalMax === state.externalMax && values.delaySeconds === state.delaySeconds && values.pickupSeconds === state.pickupSeconds && values.handoffSeconds === state.handoffSeconds) {
          status.className = 'message message-notice';
          setMessage(status, 'Chưa có thay đổi nào để lưu.');
          return;
        }
        pending = { version: state.version, values, key: this.host.newKey() };
        this.#pendingConditions = pending;
      }
      save.disabled = true;
      save.textContent = 'Đang lưu…';
      const result = await this.host.source.saveConditions(pending);
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#pendingConditions = undefined;
        await this.load('Đã lưu tham số. Áp dụng cho các lần kiểm tra điều kiện tiếp theo; không đổi đơn đã nhận.');
        return;
      }
      if (result.kind === 'session-expired') {
        this.host.onSessionLost();
        return;
      }
      if (result.kind === 'forbidden') {
        this.host.onForbidden();
      }
      if (result.kind !== 'unknown') {
        this.#pendingConditions = undefined;
      }
      save.disabled = false;
      save.textContent = result.kind === 'unknown' ? 'Thử lại' : result.kind === 'conflict' ? 'Tải lại' : 'Lưu tham số';
      if (result.kind === 'conflict') {
        save.onclick = () => void this.load();
      }
      status.className = `message message-${result.kind === 'unknown' || result.kind === 'conflict' ? 'warning' : 'error'}`;
      setMessage(status, writeText(result));
    };
    save.addEventListener('click', () => void send());
    if (notice !== undefined) {
      status.className = 'message message-notice';
      setMessage(status, notice);
    }
    const row = (title: string, text: string, control: HTMLElement): HTMLElement =>
      h('div', { class: 'sp-condition' }, h('div', {}, h('p', { class: 'sp-condition-title' }, title), h('p', { class: 'hint' }, text)), control);
    return h(
      'div',
      { class: 'sp-grid' },
      h(
        'div',
        { class: 'sp-card' },
        h('h2', { class: 'subtitle' }, 'Điều kiện nhận đơn'),
        row('Bán kính tìm shipper', 'Quy tắc cố định của hệ thống (đường chim bay từ quán đến vị trí shipper).', h('span', { class: 'sp-value sp-value-locked', id: 'sp-cond-radius' }, `${formatKm(state.searchRadiusM)} km`)),
        row('EXTERNAL — đơn cùng lúc', 'Mức tối đa được phép đang thực hiện (mặc định 3).', external.element),
        row('PLATFORM — đơn cùng lúc', 'Không công khai phân loại cho shipper.', h('span', { class: 'sp-value' }, 'Không giới hạn')),
        row('Chậm thêm tối đa khi ghép', 'So với ETA gốc của từng đơn đã nhận, cộng dồn (mặc định 5 phút).', delay.element),
        row('Thời gian nhận hàng', 'Tính vào ETA khi đánh giá ghép đơn.', pickup.element),
        row('Thời gian bàn giao hàng', 'Tính vào ETA khi đánh giá ghép đơn.', handoff.element),
        h('p', { class: 'sp-note', role: 'note', id: 'sp-conditions-pending' }, 'PLATFORM không được miễn điều kiện GPS hợp lệ, số dư và bảo vệ ETA. Các tham số này được dùng cho kiểm tra điều kiện của M06; việc nhận đơn thật do M07 thực hiện và M07 chưa được nối nên chưa có đơn nào bị ảnh hưởng.'),
        status,
        canEdit ? h('div', { class: 'detail-actions sp-actions' }, save) : h('p', { class: 'hint', id: 'sp-cond-readonly' }, 'Bạn chỉ có quyền xem. Chỉ tài khoản SYSTEM được chỉnh sửa tham số.'),
      ),
      h(
        'div',
        { class: 'sp-card' },
        h('h2', { class: 'subtitle' }, 'Nguồn dữ liệu liên quan'),
        h(
          'dl',
          { class: 'kvs' },
          ...[
            ['Tuyến đường và ETA', 'M14'],
            ['Vị trí mới nhất', 'M14'],
            ['Ví/giữ hoa hồng', 'M04'],
            ['Trạng thái và số đơn', 'M07'],
            ['Thông báo', 'M08'],
          ].map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label as string), h('dd', {}, value as string))),
        ),
        h('p', { class: 'sp-note', role: 'note' }, 'M06 trả về kết quả đủ điều kiện/không đủ điều kiện và lý do. Không tự nhận đơn hoặc trừ ví.'),
      ),
    );
  }

  // ---- Lịch sử chính sách ----------------------------------------------------------------------------------------------

  #history(state: PolicyState): HTMLElement {
    const conditions = this.#conditionsRead?.kind === 'ready' ? this.#conditionsHistory(this.#conditionsRead.state) : undefined;
    if (state.history.length === 0) {
      return h('div', { class: 'sp-stack' }, h('div', { class: 'sp-card' }, emptyPanel('Chưa có phiên bản nào', 'Chưa có bảng giá nào được áp dụng. Khi chưa có bảng giá, hệ thống không tính phí giao hàng.')), conditions);
    }
    const versions: readonly PolicyVersionInfo[] = state.history;
    return h('div', { class: 'sp-stack' }, this.#versionsCard(state, versions), conditions);
  }

  #versionsCard(state: PolicyState, versions: readonly PolicyVersionInfo[]): HTMLElement {
    return h(
      'div',
      { class: 'sp-card' },
      h('h2', { class: 'subtitle' }, 'Các phiên bản đã áp dụng'),
      h('p', { class: 'hint' }, 'Mỗi lần áp dụng tạo một phiên bản bất biến; không sửa được phiên bản cũ và không đổi phí đã chốt của đơn.'),
      h(
        'ol',
        { class: 'timeline' },
        ...versions.map((version, index) => {
          const previous = versions[index + 1] ?? null;
          const lines = previous === null && version.versionNo > 1 ? ['Xem các khung bên dưới.'] : describeChanges(previous, version, previous?.legacy === true || version.legacy);
          return h(
            'li',
            { class: 'timeline-item', id: `sp-version-${String(version.versionNo)}` },
            h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
            h(
              'div',
              {},
              h('p', { class: 'timeline-label' }, `Phiên bản ${String(version.versionNo)}${version.versionNo === state.active?.versionNo ? (version.legacy ? ' · mới nhất (định dạng cũ, không dùng tính phí)' : ' · đang áp dụng') : ''}${version.legacy && version.versionNo !== state.active?.versionNo ? ' · định dạng cũ' : ''}`),
              h('p', { class: 'timeline-meta' }, `${formatDateTime(version.appliedAt)} · Tài khoản ${version.appliedBy}`),
              version.note === null ? undefined : h('p', { class: 'timeline-reason' }, `Ghi chú: ${version.note}`),
              ...lines.map((line) => h('p', { class: 'hint' }, line)),
              h(
                'details',
                {},
                h('summary', {}, 'Các khung của phiên bản này'),
                h(
                  'ul',
                  { class: 'sp-tier-list' },
                  ...version.tiers.map((t) => h('li', {}, `${formatKm(t.fromM)}–${formatKm(t.toM)} km: ${formatFee(t.feeVnd)}`)),
                  version.tail === null
                    ? h('li', {}, `Quá ${formatKm(version.tiers[version.tiers.length - 1]?.toM ?? 0)} km: ngoài bảng giá (phí chưa xác định)`)
                    : h('li', {}, `Công thức cũ sau ${formatKm(version.tiers[version.tiers.length - 1]?.toM ?? 0)} km: ${formatFee(version.tail.baseFeeVnd)} + ${formatFee(version.tail.stepFeeVnd)} mỗi ${formatKm(version.tail.stepM)} km (không còn dùng)`),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  #conditionsHistory(state: ConditionsState): HTMLElement {
    const label = (v: ConditionValues): string => `EXTERNAL ${String(v.externalMax)} đơn · chậm tối đa ${formatMinutes(v.delaySeconds)} phút · nhận ${String(v.pickupSeconds)}s · bàn giao ${String(v.handoffSeconds)}s`;
    return h(
      'div',
      { class: 'sp-card', id: 'sp-conditions-history' },
      h('h2', { class: 'subtitle' }, 'Thay đổi điều kiện nhận & ghép'),
      state.history.length === 0
        ? h('p', { class: 'empty' }, 'Chưa có thay đổi nào so với mặc định.')
        : h(
            'ol',
            { class: 'timeline' },
            ...state.history.map((change) =>
              h(
                'li',
                { class: 'timeline-item' },
                h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                h('div', {}, h('p', { class: 'timeline-label' }, `${label(change.old)} → ${label(change.new)}`), h('p', { class: 'timeline-meta' }, `${formatDateTime(change.changedAt)} · Tài khoản ${change.changedBy}`)),
              ),
            ),
          ),
    );
  }
}
