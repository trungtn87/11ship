import { commandFailureText, CommandResult } from '../core/commands.js';
import { CONFIG_FIELDS, CONFIG_REFUSAL, ConfigChange, ConfigGroup, ConfigGroupKey, ConfigSource, ConfigValue, describeChange, FieldSpec, validateConfig } from '../core/config.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Cài đặt › Cấu hình tập trung" (M12-D). It shows what each owning module holds, the rules that are fixed (no edit anywhere), and the history of changes. A change is
// compared (old → new), needs a reason and a confirmation, and is sent to the owner's own command with the version the screen was loaded with; a lost answer is retried only
// with the same Idempotency-Key. A revert is an ordinary change that puts an old value back as a NEW version. Every node is created with createElement/textContent.

export interface ConfigHost {
  readonly source: ConfigSource;
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly openFeeTable: () => void;
  readonly dialogHost?: HTMLElement;
}

const formatValue = (item: ConfigValue): string => {
  if (typeof item.value === 'boolean') {
    return item.value ? 'Bật' : 'Tắt';
  }
  const text = typeof item.value === 'number' ? item.value.toLocaleString('vi-VN') : item.value;
  return item.unit === undefined ? text : `${text} ${item.unit}`;
};

const asPlain = (value: ConfigValue['value'] | undefined): number | boolean | undefined => (typeof value === 'string' ? undefined : value);

export class ConfigView {
  readonly #body: HTMLElement;
  readonly #notice: HTMLElement;
  #latest = 0;
  #disposed = false;
  #dialog: DialogHandle | undefined;
  #editable = false;
  #open = new Set<ConfigGroupKey>();
  #groups = new Map<ConfigGroupKey, ConfigGroup>();

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ConfigHost,
  ) {
    this.#body = h('div', { class: 'cfg-body' });
    this.#notice = h('p', { class: 'notice', role: 'status', hidden: true });
    const refresh = secondary('Làm mới');
    refresh.classList.add('btn-inline');
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'config-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'config-title' }, 'Cấu hình tập trung'), h('p', { class: 'lead lead-last' }, 'Giá trị do từng module sở hữu; trang này chỉ tập hợp để xem và sửa đúng một nơi. Mọi quản trị viên được xem, chỉ SYSTEM được sửa. Quy tắc cố định không phải tham số nên không có nút sửa.'))),
        h('div', { class: 'toolbar' }, refresh),
        this.#notice,
        this.#body,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    this.#dialog?.close();
  }

  #say(text: string | undefined): void {
    this.#notice.textContent = text ?? '';
    this.#notice.hidden = text === undefined;
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#body.replaceChildren(skeleton());
    const read = await this.host.source.read();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason));
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
    this.#editable = read.editable;
    this.#groups = new Map(read.groups.map((group) => [group.key, group]));
    const cards = read.groups.map((group) => this.#card(group));
    this.#body.replaceChildren(h('p', { class: 'ov-stamp' }, `Đọc lúc ${formatDateTime(read.generatedAt)} (giờ Việt Nam)`), ...cards);
    for (const key of this.#open) {
      void this.#showHistory(key);
    }
  }

  #card(group: ConfigGroup): HTMLElement {
    const list = (items: readonly ConfigValue[]): HTMLElement => h('dl', { class: 'kvs' }, ...items.map((item) => h('div', { class: 'kv' }, h('dt', {}, item.label), h('dd', {}, formatValue(item)))));
    const actions: HTMLElement[] = [];
    if (group.edit !== null && this.#editable) {
      const edit = primary('Sửa', 'button');
      edit.classList.add('btn-inline');
      edit.setAttribute('aria-label', `Sửa ${group.title}`);
      edit.addEventListener('click', () => this.#edit(group));
      actions.push(edit);
    }
    if (group.key === 'delivery_policy') {
      const fees = secondary('Bảng giá giao hàng');
      fees.classList.add('btn-inline');
      fees.addEventListener('click', () => this.host.openFeeTable());
      actions.push(fees);
    }
    if (group.edit !== null) {
      const history = secondary('Lịch sử thay đổi');
      history.classList.add('btn-inline');
      history.addEventListener('click', () => {
        if (this.#open.has(group.key)) {
          this.#open.delete(group.key);
          this.#body.querySelector(`#cfg-history-${group.key}`)?.replaceChildren();
        } else {
          this.#open.add(group.key);
          void this.#showHistory(group.key);
        }
      });
      actions.push(history);
    }
    return h(
      'section',
      { class: 'cfg-card', 'aria-labelledby': `cfg-${group.key}` },
      h('header', { class: 'cfg-head' }, h('h2', { class: 'subtitle', id: `cfg-${group.key}` }, group.title), h('span', { class: 'cell-sub' }, `Module ${group.owner}${group.version === null ? '' : ` · phiên bản ${String(group.version)}`}${group.updatedAt === null ? '' : ` · cập nhật ${formatDateTime(group.updatedAt)}`}`)),
      group.values.length === 0 ? undefined : list(group.values),
      group.fixedRules.length === 0 ? undefined : h('div', { class: 'cfg-fixed' }, h('h3', { class: 'cfg-fixed-title' }, 'Quy tắc cố định (không phải tham số, không chỉnh được)'), list(group.fixedRules)),
      group.key === 'storage_backup' ? h('p', { class: 'hint' }, 'Lịch sử và chính sách sao lưu nằm ở mục Hệ thống › Sao lưu.') : undefined,
      group.edit?.note === null || group.edit === null ? undefined : h('p', { class: 'hint' }, group.edit.note),
      group.edit === null && group.values.length === 0 && group.key !== 'storage_backup' ? h('p', { class: 'hint' }, 'Không có tham số để chỉnh sửa trong nhóm này.') : undefined,
      actions.length === 0 ? undefined : h('div', { class: 'form-actions' }, ...actions),
      h('div', { id: `cfg-history-${group.key}`, class: 'cfg-history' }),
    );
  }

  async #showHistory(group: ConfigGroupKey): Promise<void> {
    const target = this.#body.querySelector<HTMLElement>(`#cfg-history-${group}`);
    if (target === null) {
      return;
    }
    target.replaceChildren(skeleton(2));
    const read = await this.host.source.history(group);
    if (this.#disposed) {
      return;
    }
    if (read.kind !== 'ready') {
      target.replaceChildren(read.kind === 'not-wired' ? notWiredPanel(read.reason) : failurePanel(read.failure, { retry: () => void this.#showHistory(group), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    if (read.items.length === 0) {
      target.replaceChildren(h('p', { class: 'empty' }, 'Chưa có thay đổi nào được ghi.'));
      return;
    }
    target.replaceChildren(
      h(
        'ol',
        { class: 'timeline' },
        ...read.items.map((change) => this.#historyItem(change)),
      ),
    );
  }

  #historyItem(change: ConfigChange): HTMLElement {
    const reason = typeof change.metadata.reason === 'string' ? change.metadata.reason : null;
    // A revert puts the OLD value of one key back through the ordinary change flow (compare, reason, confirm), so it is a new version and the history keeps both.
    const key = typeof change.metadata.setting_key === 'string' ? change.metadata.setting_key : typeof change.metadata.param_key === 'string' ? change.metadata.param_key : undefined;
    const old = change.metadata.old_value;
    const group = this.#groups.get(change.group);
    let revert: HTMLElement | undefined;
    if (this.#editable && key !== undefined && group !== undefined && (typeof old === 'boolean' || typeof old === 'number')) {
      const button = secondary('Hoàn nguyên giá trị này');
      button.classList.add('btn-inline');
      button.addEventListener('click', () => this.#edit(group, { [key]: old }));
      revert = button;
    }
    return h(
      'li',
      { class: 'timeline-item' },
      h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
      h('div', {}, h('p', { class: 'timeline-label' }, describeChange(change)), h('p', { class: 'timeline-meta' }, `${formatDateTime(change.at)} · ${change.actorName}`), reason === null ? h('p', { class: 'timeline-reason' }, 'Không ghi lý do (thay đổi trước khi có ô lý do)') : h('p', { class: 'timeline-reason' }, `Lý do: ${reason}`), revert),
    );
  }

  // ---- the change flow -------------------------------------------------------------------------------------------------------------

  #edit(group: ConfigGroup, preset: Readonly<Record<string, number | boolean>> = {}): void {
    const edit = group.edit;
    if (edit === null || group.version === null) {
      return;
    }
    const fields = CONFIG_FIELDS[edit.kind];
    const current: Record<string, number | boolean> = {};
    for (const field of fields) {
      const value = asPlain(group.values.find((item) => item.key === field.key)?.value);
      if (value !== undefined) {
        current[field.key] = value;
      }
    }
    const draft: Record<string, number | boolean> = { ...current, ...preset };
    const inputs = new Map<string, HTMLInputElement>();
    const diff = h('ul', { class: 'plain-list', 'aria-live': 'polite' });
    const error = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const reason = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', 'aria-label': 'Lý do', placeholder: 'Lý do thay đổi (bắt buộc, ghi vào nhật ký)' });
    const confirm = primary('Xác nhận lưu', 'button');
    const back = secondary('Quay lại');
    const describe = (field: FieldSpec, value: number | boolean | undefined): string => (typeof value === 'boolean' ? (value ? 'Bật' : 'Tắt') : value === undefined ? '—' : `${value.toLocaleString('vi-VN')}${field.unit === undefined ? '' : ` ${field.unit}`}`);
    const refreshDiff = (): void => {
      const changed = fields.filter((field) => draft[field.key] !== current[field.key]);
      diff.replaceChildren(...(changed.length === 0 ? [h('li', {}, 'Chưa có thay đổi.')] : changed.map((field) => h('li', {}, `${field.label}: ${describe(field, current[field.key])} → ${describe(field, draft[field.key])}`))));
      confirm.disabled = changed.length === 0;
    };
    const rows = fields.map((field) => {
      const input = h('input', field.type === 'boolean' ? { type: 'checkbox', id: `cfg-f-${field.key}`, ...(draft[field.key] === true ? { checked: true } : {}) } : { type: 'number', id: `cfg-f-${field.key}`, class: 'search-input', inputmode: 'numeric', value: String(draft[field.key] ?? ''), ...(field.min === undefined ? {} : { min: String(field.min) }), ...(field.max === undefined ? {} : { max: String(field.max) }) });
      inputs.set(field.key, input);
      input.addEventListener('input', () => {
        draft[field.key] = field.type === 'boolean' ? input.checked : input.value.trim() === '' ? Number.NaN : Number(input.value);
        refreshDiff();
      });
      return h('div', { class: 'cfg-field' }, h('label', { for: `cfg-f-${field.key}`, class: 'field-label' }, field.label + (field.unit === undefined || field.type === 'boolean' ? '' : ` (${field.unit})`)), input);
    });
    let command: Parameters<ConfigSource['save']>[0] | undefined;
    const handle = (this.#dialog = openDialog({ title: `${Object.keys(preset).length === 0 ? 'Sửa' : 'Hoàn nguyên'}: ${group.title}`, description: edit.note ?? 'Kiểm tra giá trị cũ → mới, nhập lý do rồi xác nhận. Giá trị đang được người khác sửa sẽ bị từ chối.', body: [...rows, diff, reason, error], actions: [back, confirm], ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }), onDismiss: () => handle.close() }));
    back.addEventListener('click', () => handle.close());
    refreshDiff();
    confirm.addEventListener('click', () => {
      const why = reason.value.trim();
      const invalid = command === undefined ? validateConfig(edit.kind, draft) : undefined;
      if (invalid !== undefined || (command === undefined && why === '')) {
        error.textContent = invalid ?? 'Nhập lý do.';
        error.hidden = false;
        return;
      }
      // The same intent keeps the same key: a retry after an unknown outcome is the SAME command.
      command ??= { kind: edit.kind, version: group.version as number, values: { ...draft }, reason: why, key: this.host.newKey() };
      confirm.disabled = true;
      back.disabled = true;
      reason.disabled = true;
      for (const input of inputs.values()) {
        input.disabled = true;
      }
      void this.host.source.save(command).then((result: CommandResult) => {
        if (this.#disposed) {
          return;
        }
        if (result.kind === 'ok') {
          handle.close();
          this.#say('Đã lưu cấu hình thành phiên bản mới và ghi vào nhật ký.');
          void this.load();
          return;
        }
        if (result.kind === 'session-expired') {
          this.host.onSessionLost();
          return;
        }
        if (result.kind === 'forbidden') {
          this.host.onForbidden();
        }
        error.textContent = commandFailureText(result, CONFIG_REFUSAL) ?? '';
        error.hidden = false;
        back.disabled = false;
        if (result.kind === 'unknown') {
          confirm.textContent = 'Thử lại';
          confirm.disabled = false;
        } else if (result.kind === 'conflict') {
          void this.load();
        }
      });
    });
  }
}
