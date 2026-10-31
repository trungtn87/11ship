import { BusinessApi, BusinessApiError, businessError } from '../core/business-api.js';
import { h } from './dom.js';

// "Vận hành" tab of the Mini Business (issues #241 / #242): the four operations questions and the anomaly SIGNALS. It draws what the server sent for this actor: a block the
// actor may not read arrives as FORBIDDEN and says so; a figure without a denominator is "Chưa đủ dữ liệu" (never 0 %); a flag is for a person to review, with its evidence.
// Everything is created with createElement/textContent; no figure is computed here.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DAYS = ['', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];
const RULE_LABEL: Record<string, string> = {
  CUSTOMER_ORDER_CANCELS: 'Khách đặt món rồi hủy nhiều',
  DIRECT_CALL_CANCELS: 'Gọi ship rồi hủy nhiều',
  SHIPPER_ABANDONS: 'Shipper nhận rồi bỏ nhiều',
  REPEAT_PAIR_CANCELS: 'Cùng khách–quán–shipper hủy lặp trong ngày',
};
const STATUS_LABEL: Record<string, string> = { NEW: 'Mới', REVIEWING: 'Đang xem xét', CHECKED: 'Đã kiểm tra', DISMISSED: 'Bỏ qua' };
const STEP_LABEL: Record<string, string> = { AWAITING_SHOP: 'Chờ quán xác nhận', CONFIRMED: 'Đã xác nhận, chưa gọi ship', SEARCHING: 'Đang tìm shipper', ASSIGNED: 'Shipper đã nhận, chưa lấy hàng', PICKED_UP: 'Đã lấy hàng / đang giao' };
const ACTION_LABEL: Record<string, string> = { review: 'Bắt đầu xem xét', check: 'Đánh dấu đã kiểm tra', dismiss: 'Bỏ qua (cảnh báo sai)', reopen: 'Mở lại', note: 'Thêm ghi chú' };
const ACTOR_LABEL: Record<string, string> = { CUSTOMER: 'Khách', SHOP: 'Quán', SHIPPER: 'Shipper', SYSTEM: 'Hệ thống', ADMIN: 'Quản trị', CREATOR: 'Người tạo yêu cầu', UNKNOWN: 'Chưa rõ' };

const pct = (rate: Json | undefined): string => (rate === undefined || rate.pct === null ? 'Chưa đủ dữ liệu' : `${String(rate.pct).replace('.', ',')}% (${String(rate.numerator)}/${String(rate.denominator)})`);
const secs = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : value < 90 ? `${String(value)} giây` : `${String(Math.round(value / 60))} phút`);
const time = (iso: string): string => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const p = (text: string, className = ''): HTMLElement => h('p', className === '' ? {} : { class: className }, text);
const btn = (label: string, run: () => void, kind = ''): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: 'business-button ' + kind }, label);
  b.onclick = run;
  return b;
};

export interface OpsHost {
  readonly api: BusinessApi;
  readonly content: HTMLElement;
  readonly current: () => boolean;
  readonly fail: (error: unknown) => void;
  readonly isSystem: () => boolean;
}

export class BusinessOps {
  #range = 'today';
  #source = 'ALL';
  #status = 'OPEN';
  #drill: Json | undefined;

  constructor(private readonly host: OpsHost) {}

  async load(): Promise<void> {
    const { api, content } = this.host;
    const query = `range=${this.#range}&source=${this.#source}`;
    const [overview, anomalies] = await Promise.all([
      api.call<Json>('/v1/admin/ops-analytics?' + query),
      api.call<Json>('/v1/admin/ops-anomalies?status=' + this.#status).catch((error: unknown) => (error instanceof BusinessApiError && error.status === 403 ? undefined : Promise.reject(error))),
    ]);
    if (!this.host.current()) return;
    const root = h('div', { class: 'business-ops' }, this.#filters(), this.#search(overview), this.#confirm(overview), this.#supply(overview), this.#cancel(overview));
    root.append(anomalies === undefined ? h('section', { class: 'business-panel' }, h('h2', {}, 'Cần xem xét / bất thường'), p('Tài khoản này chưa được cấp quyền xem mục này.', 'business-muted')) : this.#anomalies(anomalies));
    content.replaceChildren(root);
  }

  #filters(): HTMLElement {
    const range = h('select', { 'aria-label': 'Khoảng thời gian' }, h('option', { value: 'today' }, 'Hôm nay'), h('option', { value: '7d' }, '7 ngày'), h('option', { value: '30d' }, '30 ngày')) as HTMLSelectElement;
    const source = h('select', { 'aria-label': 'Loại yêu cầu' }, h('option', { value: 'ALL' }, 'Tất cả'), h('option', { value: 'ORDER' }, 'Đặt món'), h('option', { value: 'DIRECT' }, 'Gọi ship')) as HTMLSelectElement;
    range.value = this.#range;
    source.value = this.#source;
    const apply = (): void => {
      this.#range = range.value;
      this.#source = source.value;
      this.#drill = undefined;
      void this.load().catch((error) => this.host.fail(error));
    };
    range.onchange = apply;
    source.onchange = apply;
    return h('section', { class: 'business-panel' }, h('h2', {}, 'Phân tích vận hành'), h('label', {}, 'Khoảng thời gian ', range), h('label', {}, 'Loại ', source), p('Giờ Việt Nam. Số liệu của hôm nay chưa kết thúc: yêu cầu/đơn đang chạy được tính riêng, không tính là thất bại hay hủy.', 'business-muted'));
  }

  #blocked(title: string, block: Json): HTMLElement | undefined {
    if (block.status === 'FORBIDDEN') return h('section', { class: 'business-panel' }, h('h3', {}, title), p('Bạn chưa được cấp quyền xem ứng dụng Quán và Shipper cần cho mục này.', 'business-muted'));
    if (block.status === 'NOT_APPLICABLE') return h('section', { class: 'business-panel' }, h('h3', {}, title), p(String(block.note), 'business-muted'));
    return undefined;
  }

  #search(o: Json): HTMLElement {
    const b = o.search_failures as Json;
    const blocked = this.#blocked('1 · Không tìm được shipper', b);
    if (blocked) return blocked;
    const panel = h('section', { class: 'business-panel', 'data-block': 'search' }, h('h3', {}, '1 · Không tìm được shipper'),
      p(`Yêu cầu tìm shipper: ${String(b.requests)} · đang tìm: ${String(b.still_searching)} · đã có shipper nhận: ${String(b.matched)}`),
      p(`Hết thời gian không ai nhận: ${pct(b.failed)}`, 'business-strong'),
      p(`Đã nhận rồi bỏ, hết thời gian: ${String(b.failed_after_release)} · khách/quán tự hủy khi chưa ai nhận: ${String(b.cancelled_by_creator)} · lượt shipper bỏ: ${String(b.shipper_releases)}`),
      p(`Thời gian ghép: trung vị ${secs(b.match_seconds.median)} · p90 ${secs(b.match_seconds.p90)}`),
      p(String(b.causes_note), 'business-muted'));
    if (b.low_sample) panel.append(p('Mẫu thấp: chưa nên kết luận.', 'business-muted'));
    panel.append(btn('Xem các yêu cầu không tìm được shipper', () => void this.#showDrill('search_failed', null, 'Yêu cầu không tìm được shipper')));
    return panel;
  }

  #confirm(o: Json): HTMLElement {
    const b = o.shop_confirmation as Json;
    const blocked = this.#blocked('2 · Quán xác nhận chậm', b);
    if (blocked) return blocked;
    const panel = h('section', { class: 'business-panel', 'data-block': 'confirm' }, h('h3', {}, '2 · Quán xác nhận chậm'),
      p(`Đơn cần quán xác nhận: ${String(b.orders)} · đang chờ: ${String(b.waiting)} · đã xác nhận: ${String(b.confirmed)} · quán từ chối: ${String(b.rejected)}`),
      p(`Xác nhận chậm: ${pct(b.slow)} · hết hạn không ai xác nhận: ${pct(b.expired)}`, 'business-strong'),
      p(`Thời gian xác nhận: trung vị ${secs(b.confirm_seconds.median)} · p90 ${secs(b.confirm_seconds.p90)}`),
      p(String(b.slow_rule), 'business-muted'));
    if (b.low_sample) panel.append(p('Mẫu thấp: chưa nên xếp hạng quán.', 'business-muted'));
    for (const s of b.shops as Json[]) {
      panel.append(p(`${String(s.name)} — ${String(s.samples)} đơn · chậm ${String(s.slow)} · hết hạn ${String(s.expired)} · trung vị ${secs(s.median_seconds)} · p90 ${secs(s.p90_seconds)}${s.low_sample ? ' · mẫu thấp' : ''}`, s.low_sample ? 'business-muted' : ''));
    }
    panel.append(btn('Xem đơn xác nhận chậm', () => void this.#showDrill('slow_confirm', null, 'Đơn quán xác nhận chậm')), btn('Xem đơn hết hạn', () => void this.#showDrill('expired_confirm', null, 'Đơn hết hạn chờ quán')));
    return panel;
  }

  #supply(o: Json): HTMLElement {
    const b = o.supply_demand as Json;
    const blocked = this.#blocked('3 · Giờ thiếu shipper', b);
    if (blocked) return blocked;
    const panel = h('section', { class: 'business-panel', 'data-block': 'supply' }, h('h3', {}, '3 · Giờ nghi thiếu shipper'), p(String(b.note), 'business-muted'));
    const cells = [...(b.cells as Json[])].filter((c) => c.requests > 0).sort((x, y) => (y.not_matched_pct ?? -1) - (x.not_matched_pct ?? -1) || y.requests - x.requests).slice(0, 12);
    if (cells.length === 0) panel.append(p('Chưa có yêu cầu trong kỳ.', 'business-muted'));
    for (const c of cells) {
      const supply = c.supply_avg_online === null ? 'chưa ghi nhận cung' : `Online TB ${String(c.supply_avg_online)} · sẵn sàng TB ${String(c.supply_avg_ready)}`;
      panel.append(p(`${DAYS[c.weekday] ?? ''} ${String(c.hour)}h: ${String(c.requests)} yêu cầu · không ghép được ${c.not_matched_pct === null ? '—' : String(c.not_matched_pct).replace('.', ',') + '%'} · ghép trung vị ${secs(c.median_match_seconds)} · ${supply}${c.low_sample ? ' · mẫu thấp' : ''}`));
    }
    return panel;
  }

  #cancel(o: Json): HTMLElement {
    const b = o.cancellations as Json;
    const blocked = this.#blocked('4 · Hủy theo bước', b);
    if (blocked) return blocked;
    const panel = h('section', { class: 'business-panel', 'data-block': 'cancel' }, h('h3', {}, '4 · Đơn bị hủy nhiều nhất ở bước nào'));
    const cohort = (title: string, view: Json | null, drill: boolean): void => {
      if (view === null) return;
      panel.append(h('h4', {}, title));
      for (const s of view.steps as Json[]) {
        const actors = Object.entries(s.by_actor as Record<string, number>).map(([actor, n]) => `${ACTOR_LABEL[actor] ?? actor}: ${String(n)}`).join(', ');
        const line = p(`${STEP_LABEL[s.step] ?? String(s.step)} — vào bước: ${String(s.entered)} · hủy: ${pct(s.cancelled)}${actors === '' ? '' : ' · ' + actors}`);
        panel.append(line);
        if (drill && s.cancelled.numerator > 0) panel.append(btn('Xem đơn hủy ở bước này', () => void this.#showDrill('cancelled_at_step', String(s.step), `Đơn hủy ở bước: ${STEP_LABEL[s.step] ?? String(s.step)}`)));
      }
      panel.append(p(`Hoàn tất: ${String(view.completed)} · đang chạy (chưa tính hủy): ${String(view.in_progress)}`, 'business-muted'));
    };
    cohort('Đặt món', b.order as Json | null, true);
    cohort('Gọi ship trực tiếp', b.direct as Json | null, false);
    panel.append(p(String(b.direct_note), 'business-muted'));
    return panel;
  }

  async #showDrill(kind: string, step: string | null, title: string, offset = 0): Promise<void> {
    try {
      const query = `range=${this.#range}&source=${this.#source}&kind=${kind}${step === null ? '' : '&step=' + step}&limit=20&offset=${String(offset)}`;
      const page = await this.host.api.call<Json>('/v1/admin/ops-analytics/drilldown?' + query);
      if (!this.host.current()) return;
      const panel = h('section', { class: 'business-panel', 'data-block': 'drill' }, btn('← Bảng phân tích', () => void this.load().catch((error) => this.host.fail(error))), h('h3', {}, `${title} · ${String(page.total)}`));
      for (const item of page.items as Json[]) panel.append(p(`${String(item.code)} · ${String(item.shop_name ?? '—')} · ${String(item.state)} · ${time(String(item.at))}${item.detail ? ' · ' + String(item.detail) : ''}`));
      if (offset + 20 < page.total) panel.append(btn('Xem tiếp', () => void this.#showDrill(kind, step, title, offset + 20)));
      this.host.content.replaceChildren(panel);
    } catch (error) {
      this.host.fail(error);
    }
  }

  // ---- anomalies ----------------------------------------------------------------------------------------------------------------

  #anomalies(a: Json): HTMLElement {
    const panel = h('section', { class: 'business-panel', 'data-block': 'anomalies' }, h('h2', {}, 'Cần xem xét / bất thường'), p(String(a.note), 'business-muted'));
    const filter = h('select', { 'aria-label': 'Trạng thái' }, h('option', { value: 'OPEN' }, 'Đang mở'), h('option', { value: 'ALL' }, 'Tất cả'), ...Object.entries(STATUS_LABEL).map(([value, label]) => h('option', { value }, label))) as HTMLSelectElement;
    filter.value = this.#status;
    filter.onchange = () => {
      this.#status = filter.value;
      void this.load().catch((error) => this.host.fail(error));
    };
    panel.append(filter);
    const items = a.items as Json[];
    if (items.length === 0) panel.append(p('Không có tín hiệu nào cần xem xét.', 'business-muted'));
    for (const c of items) {
      const rate = c.rate_pct === null ? '' : ` · ${String(c.rate_pct).replace('.', ',')}%`;
      panel.append(btn(`${RULE_LABEL[c.rule] ?? String(c.rule)}\n${STATUS_LABEL[c.status] ?? String(c.status)} · ${String(c.occurrences)}/${String(c.sample)}${rate} · cập nhật ${time(String(c.updated_at))}`, () => void this.#showCase(String(c.case_id)), 'business-request'));
    }
    if (this.host.isSystem()) panel.append(this.#settingsForm(a.settings as Json));
    return panel;
  }

  async #showCase(id: string): Promise<void> {
    try {
      const c = await this.host.api.call<Json>('/v1/admin/ops-anomalies/' + id);
      if (!this.host.current()) return;
      const panel = h('section', { class: 'business-panel', 'data-block': 'case' }, btn('← Bảng phân tích', () => void this.load().catch((error) => this.host.fail(error))),
        h('h3', {}, RULE_LABEL[c.rule] ?? String(c.rule)),
        p(`Trạng thái: ${STATUS_LABEL[c.status] ?? String(c.status)} · ${String(c.occurrences)}/${String(c.sample)} lượt${c.rate_pct === null ? '' : ` (${String(c.rate_pct).replace('.', ',')}%)`}`),
        p(`Cửa sổ: ${time(String(c.window_from))} – ${time(String(c.window_to))} · mã đối tượng ${String(c.subject_id).slice(0, 8)}`, 'business-muted'),
        p('Đây là tín hiệu để xem xét, không phải kết luận gian lận; có thể do thời tiết, lỗi hệ thống hoặc không ghép được shipper.', 'business-muted'));
      for (const e of c.evidence as Json[]) {
        panel.append(p(e.items !== undefined ? `${String(e.day)} · ${String(e.orders)} đơn hủy` : `${String(e.code)} · ${time(String(e.at))} · ${e.stage === 'BEFORE_SHOP_CONFIRM' ? 'trước khi quán xác nhận' : e.stage === 'AFTER_SHOP_CONFIRM' ? 'sau khi quán xác nhận' : e.stage === 'BEFORE_SHIPPER_ACCEPTED' ? 'trước khi shipper nhận' : e.stage === 'AFTER_SHIPPER_ACCEPTED' ? 'sau khi shipper nhận' : 'trước lấy hàng'} · lý do: ${e.reason === 'UNKNOWN' ? 'chưa rõ' : String(e.reason)}`));
      }
      for (const entry of c.history as Json[]) panel.append(p(`${time(String(entry.at))} · ${ACTION_LABEL[entry.action] ?? String(entry.action)} → ${STATUS_LABEL[entry.to] ?? String(entry.to)}${entry.note ? ' · ' + String(entry.note) : ''}`, 'business-muted'));
      const can = c.can as string[];
      if (can.length === 0) panel.append(p('Chỉ xem: tài khoản này không có quyền xử lý ghi chú hoặc đóng tín hiệu này.', 'business-muted'));
      else {
        const note = h('textarea', { rows: '3', maxlength: '500', 'aria-label': 'Ghi chú / lý do', placeholder: 'Ghi chú (bắt buộc khi kiểm tra, bỏ qua hoặc thêm ghi chú)' }) as HTMLTextAreaElement;
        panel.append(note);
        for (const action of can) {
          panel.append(btn(ACTION_LABEL[action] ?? action, () => {
            const text = note.value.normalize('NFC').replace(/\s+/gu, ' ').trim();
            if ((action === 'check' || action === 'dismiss' || action === 'note') && text === '') {
              this.host.fail(new BusinessApiError('ADMIN_INPUT_INVALID', 400));
              return;
            }
            void this.host.api.call(`/v1/admin/ops-anomalies/${id}/action`, { action, expected_version: c.version, ...(text === '' ? {} : { note: text }) }).then(() => this.#showCase(id)).catch((error) => this.host.fail(error));
          }, action === 'dismiss' ? 'business-danger' : ''));
        }
      }
      this.host.content.replaceChildren(panel);
    } catch (error) {
      this.host.fail(error);
    }
  }

  #settingsForm(s: Json): HTMLElement {
    const field = (label: string, value: number): HTMLInputElement => h('input', { type: 'number', 'aria-label': label, value: String(value) }) as HTMLInputElement;
    const days = field('Cửa sổ (ngày)', s.window_days);
    const samples = field('Số mẫu tối thiểu', s.min_samples);
    const rate = field('Ngưỡng tỷ lệ (%)', s.rate_pct);
    const repeat = field('Lặp tối thiểu mỗi ngày', s.repeat_per_day);
    const reason = h('input', { type: 'text', 'aria-label': 'Lý do thay đổi', maxlength: '300', placeholder: 'Lý do thay đổi' }) as HTMLInputElement;
    const save = btn('Lưu ngưỡng', () => {
      void this.host.api.call('/v1/admin/ops-anomalies/settings', { window_days: Number(days.value), min_samples: Number(samples.value), rate_pct: Number(rate.value), repeat_per_day: Number(repeat.value), expected_version: s.version, reason: reason.value.trim() }).then(() => this.load()).catch((error) => this.host.fail(error));
    });
    return h('details', {}, h('summary', {}, 'Ngưỡng phát hiện (SYSTEM)'), h('label', {}, 'Cửa sổ (ngày) ', days), h('label', {}, 'Số mẫu tối thiểu ', samples), h('label', {}, 'Ngưỡng tỷ lệ (%) ', rate), h('label', {}, 'Lặp tối thiểu mỗi ngày ', repeat), reason, save);
  }
}

export { businessError };
