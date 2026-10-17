import {
  describeChanges,
  EditingModel,
  EditRow,
  formatFee,
  formatKm,
  NOT_WIRED_SHIPPING_REASON,
  parseKm,
  PolicyState,
  PolicyTable,
  PolicyVersionInfo,
  PolicyWriteResult,
  PreviewResult,
  SHIPPING_MAX_TIERS,
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

function bandLabel(band: number | 'TAIL', table: PolicyTable): string {
  if (band === 'TAIL') {
    return `Sau mốc cuối (từ ${formatKm(table.tiers[table.tiers.length - 1]?.toM ?? 0)} km)`;
  }
  const tier = table.tiers[band];
  return tier === undefined ? `Mốc ${String(band + 1)}` : `Mốc ${String(band + 1)} (${formatKm(tier.fromM)}–${formatKm(tier.toM)} km)`;
}

export class ShippingPolicyView {
  readonly #body: HTMLElement;
  readonly #tabBar: HTMLElement;
  #tab: TabId = 'prices';
  #state: PolicyState | undefined;
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
    const read = await this.host.source.read();
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
    this.#model = toEditing(read.state.draft.table ?? read.state.active);
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
        this.#body.replaceChildren(this.#conditions());
        return;
      case 'history':
        this.#body.replaceChildren(this.#history(state));
    }
  }

  // ---- Bảng giá ship ----------------------------------------------------------------------------------------------------

  #prices(state: PolicyState, notice: string | undefined): HTMLElement {
    const canEdit = this.host.canEdit;
    const rowsHost = h('div', { class: 'sp-rows' });
    const tableError = message('error', 'sp-table-error');
    const verdict = h('p', { class: 'sp-verdict', id: 'sp-verdict', role: 'status' });
    const status = message('error', 'sp-status');
    const save = secondary('Lưu bản nháp');
    const apply = primary('Áp dụng bảng giá', 'button');
    let refresh: () => void = () => undefined;
    const changed = (): void => refresh();
    const baseInput = this.#tailField('sp-tail-base', 'Phí nền (đ)', this.#model.tail.base, (v) => (this.#model.tail.base = v), canEdit, changed);
    const stepInput = this.#tailField('sp-tail-step', 'Mỗi thêm (km)', this.#model.tail.step, (v) => (this.#model.tail.step = v), canEdit, changed);
    const stepFeeInput = this.#tailField('sp-tail-stepfee', 'Cộng thêm (đ)', this.#model.tail.stepFee, (v) => (this.#model.tail.stepFee = v), canEdit, changed);
    const preview = this.#previewCard();

    refresh = (): void => {
      const { table, problems } = validateEditing(this.#model);
      this.#model.rows.forEach((_, index) => {
        const row = problems.rows[index] ?? {};
        for (const field of ['from', 'to', 'fee'] as const) {
          const input = rowsHost.querySelector<HTMLInputElement>(`#sp-row-${String(index)}-${field}`);
          const error = rowsHost.querySelector<HTMLElement>(`#sp-row-${String(index)}-${field}-error`);
          if (input !== null && error !== null) {
            setMessage(error, row[field]);
            input.setAttribute('aria-invalid', String(row[field] !== undefined));
          }
        }
      });
      for (const [input, key] of [[baseInput, 'base'], [stepInput, 'step'], [stepFeeInput, 'stepFee']] as const) {
        setMessage(input.error, problems.tail[key]);
        input.input.setAttribute('aria-invalid', String(problems.tail[key] !== undefined));
      }
      setMessage(tableError, problems.table);
      const ok = table !== undefined;
      const identicalToActive = ok && state.active !== null && sameTable(table, state.active) && state.draft.table === null;
      const dirty = ok && !sameTable(table, state.draft.table);
      verdict.className = `sp-verdict ${ok ? 'sp-verdict-ok' : 'sp-verdict-bad'}`;
      verdict.textContent = ok
        ? `✓ Các mốc liên tục, không chồng lấn. ${state.active === null ? 'Chưa có bảng giá nào được áp dụng: hệ thống chưa tính được phí.' : `Đang áp dụng phiên bản ${String(state.active.versionNo)}.`}`
        : 'Bảng giá chưa hợp lệ. Hãy sửa các ô báo lỗi trước khi lưu.';
      save.disabled = !ok || !dirty;
      apply.disabled = !ok || identicalToActive;
      this.#schedulePreview(preview, table);
    };

    const drawRows = (): void => {
      rowsHost.replaceChildren(
        h('div', { class: 'sp-row sp-row-head', 'aria-hidden': 'true' }, h('span', {}, 'Từ (km)'), h('span', {}, 'Đến dưới (km)'), h('span', {}, 'Phí ship (đ)'), h('span', {})),
        ...this.#model.rows.map((row, index) => this.#row(row, index, canEdit, changed, () => {
          this.#model.rows.splice(index, 1);
          drawRows();
          refresh();
        })),
      );
    };
    drawRows();

    const add = secondary('+ Thêm mốc');
    add.addEventListener('click', () => {
      if (this.#model.rows.length >= SHIPPING_MAX_TIERS) {
        setMessage(tableError, `Tối đa ${String(SHIPPING_MAX_TIERS)} mốc.`);
        return;
      }
      const last = this.#model.rows[this.#model.rows.length - 1];
      const next = last === undefined ? '0' : last.to;
      this.#model.rows.push({ from: next, to: '', fee: '' });
      drawRows();
      refresh();
      rowsHost.querySelector<HTMLInputElement>(`#sp-row-${String(this.#model.rows.length - 1)}-to`)?.focus();
    });

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
        h('div', {}, h('h2', { class: 'subtitle' }, 'Các mốc tính phí'), h('p', { class: 'hint' }, 'Có thể thay đổi khoảng cách và giá từng mốc, không cố định 5km / 5.000đ. Khoảng nửa mở: đúng mốc biên thuộc mốc tiếp theo.')),
        canEdit ? add : undefined,
      ),
      rowsHost,
      tableError,
      h('h3', { class: 'sp-tail-title' }, 'Khi vượt mốc cuối cùng'),
      h('div', { class: 'sp-tail' }, baseInput.element, stepInput.element, stepFeeInput.element),
      h('p', { class: 'hint' }, 'Phí = phí nền + (số bước km đã đi đủ qua mốc cuối) × số tiền cộng thêm. Mỗi mốc/bước dùng khoảng cách mét gốc, không làm tròn km trước khi tính.'),
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

  #tailField(id: string, label: string, value: string, set: (value: string) => void, canEdit: boolean, changed: () => void): { readonly element: HTMLElement; readonly input: HTMLInputElement; readonly error: HTMLElement } {
    const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': `${id}-error` });
    input.value = value;
    input.readOnly = !canEdit;
    input.addEventListener('input', () => {
      set(input.value);
      changed();
    });
    const error = message('error', `${id}-error`);
    return { element: h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'input-wrap' }, input), error), input, error };
  }

  #row(row: EditRow, index: number, canEdit: boolean, changed: () => void, remove: () => void): HTMLElement {
    const cell = (field: 'from' | 'to' | 'fee', label: string): HTMLElement => {
      const id = `sp-row-${String(index)}-${field}`;
      const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `Mốc ${String(index + 1)}: ${label}`, 'aria-describedby': `${id}-error` });
      input.value = row[field];
      input.readOnly = !canEdit;
      input.addEventListener('input', () => {
        row[field] = input.value;
        changed();
      });
      return h('div', { class: 'sp-cell' }, h('div', { class: 'input-wrap' }, input), message('error', `${id}-error`));
    };
    const del = h('button', { type: 'button', class: 'sp-remove', 'aria-label': `Xóa mốc ${String(index + 1)}`, title: 'Xóa mốc' }, '×');
    del.addEventListener('click', remove);
    return h('div', { class: 'sp-row' }, cell('from', 'Từ (km)'), cell('to', 'Đến dưới (km)'), cell('fee', 'Phí ship (đ)'), canEdit ? del : h('span', {}));
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
        this.#paintPreview(card, undefined, 'Chưa xác định phí', 'Chưa tính được phí: không có đủ dữ liệu. Phí không bao giờ mặc định 0đ.');
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
        ...describeChanges(state.active, table).map((line) => h('p', { class: 'hint' }, line)),
        noteField,
        status,
      ],
      actions: [cancel, confirm],
    });
  }

  // ---- Điều kiện nhận & ghép --------------------------------------------------------------------------------------------

  #conditions(): HTMLElement {
    const item = (title: string, text: string, value: string, locked = false): HTMLElement =>
      h('div', { class: 'sp-condition' }, h('div', {}, h('p', { class: 'sp-condition-title' }, title), h('p', { class: 'hint' }, text)), h('span', { class: `sp-value${locked ? ' sp-value-locked' : ''}` }, value));
    return h(
      'div',
      { class: 'sp-grid' },
      h(
        'div',
        { class: 'sp-card' },
        h('h2', { class: 'subtitle' }, 'Điều kiện nhận đơn'),
        h('p', { class: 'sp-note', role: 'note', id: 'sp-conditions-pending' }, 'Chưa kết nối: các tham số dưới đây là mặc định đã duyệt và chưa có tác dụng cho đến khi gói M06-B/C (kiểm tra điều kiện nhận và ghép đơn) được nối với máy chủ. Chưa chỉnh sửa được ở đây.'),
        item('Bán kính tìm shipper', 'Quy tắc cố định của hệ thống (đường chim bay từ quán đến vị trí shipper).', '5 km', true),
        item('EXTERNAL — đơn cùng lúc', 'Mức tối đa được phép đang thực hiện (mặc định).', '3'),
        item('PLATFORM — đơn cùng lúc', 'Không công khai phân loại cho shipper.', 'Không giới hạn'),
        item('Chậm thêm tối đa khi ghép', 'So với ETA gốc của từng đơn đã nhận, cộng dồn (mặc định).', '5 phút'),
        h('p', { class: 'hint' }, 'PLATFORM không được miễn điều kiện GPS hợp lệ, số dư và bảo vệ ETA. Mọi thao tác nhận đơn do M07 thực hiện.'),
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
    if (state.history.length === 0) {
      return h('div', { class: 'sp-card' }, emptyPanel('Chưa có phiên bản nào', 'Chưa có bảng giá nào được áp dụng. Khi chưa có bảng giá, hệ thống không tính phí giao hàng.'));
    }
    const versions: readonly PolicyVersionInfo[] = state.history;
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
          const lines = previous === null && version.versionNo > 1 ? ['Xem các mốc bên dưới.'] : describeChanges(previous, version);
          return h(
            'li',
            { class: 'timeline-item', id: `sp-version-${String(version.versionNo)}` },
            h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
            h(
              'div',
              {},
              h('p', { class: 'timeline-label' }, `Phiên bản ${String(version.versionNo)}${version.versionNo === state.active?.versionNo ? ' · đang áp dụng' : ''}`),
              h('p', { class: 'timeline-meta' }, `${formatDateTime(version.appliedAt)} · Tài khoản ${version.appliedBy}`),
              version.note === null ? undefined : h('p', { class: 'timeline-reason' }, `Ghi chú: ${version.note}`),
              ...lines.map((line) => h('p', { class: 'hint' }, line)),
              h(
                'details',
                {},
                h('summary', {}, 'Các mốc của phiên bản này'),
                h(
                  'ul',
                  { class: 'sp-tier-list' },
                  ...version.tiers.map((t) => h('li', {}, `${formatKm(t.fromM)}–${formatKm(t.toM)} km: ${formatFee(t.feeVnd)}`)),
                  h('li', {}, `Sau ${formatKm(version.tiers[version.tiers.length - 1]?.toM ?? 0)} km: ${formatFee(version.tail.baseFeeVnd)} + ${formatFee(version.tail.stepFeeVnd)} mỗi ${formatKm(version.tail.stepM)} km`),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
