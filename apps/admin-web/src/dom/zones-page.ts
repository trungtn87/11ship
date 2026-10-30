import { ApiResult, fetchTransport } from '../core/api.js';
import { formatRoute, Route } from '../core/routes.js';
import { CoverageInput, validateCoverage, Zone, ZoneImpact, ZonesApi } from '../core/zones-api.js';
import { h, primary, secondary, svg } from './dom.js';

// Hệ thống -> Vùng hoạt động (issue #253): the list and one area. SYSTEM creates, edits and switches areas; every administrator reads. The server decides
// again on every call. Nothing here deletes an area. The admin page loads no third-party tile (its CSP is img-src 'self'), so the circle is drawn as a
// scaled sketch and the centre can be checked on OpenStreetMap through a plain link.

export interface ZonesHost {
  readonly role: 'SYSTEM' | 'ADMIN';
  readonly csrf: () => string | undefined;
  readonly onSessionLost: () => void;
  readonly go: (route: Route) => void;
}

const STATUS_LABEL = { ACTIVE: 'Đang bật', INACTIVE: 'Đang tắt' } as const;

function errorText(result: Exclude<ApiResult<unknown>, { kind: 'ok' }>, host: ZonesHost): string {
  if (result.kind === 'error') {
    if (result.status === 401) host.onSessionLost();
    switch (result.code) {
      case 'ADMIN_FORBIDDEN': return 'Chỉ tài khoản SYSTEM được thay đổi vùng hoạt động.';
      case 'VERSION_CONFLICT': return 'Vùng đã được người khác thay đổi. Tải lại rồi thử lại.';
      case 'SERVICE_AREA_CODE_CONFLICT': return 'Mã vùng đã tồn tại.';
      case 'SERVICE_AREA_NOT_FOUND': return 'Không tìm thấy vùng.';
      case 'SERVICE_AREA_IMPACT_CONFIRM_REQUIRED': return 'Thay đổi này ảnh hưởng quán hoặc đơn đang chạy: hãy xem tác động và tích xác nhận.';
      case 'ADMIN_INPUT_INVALID': return 'Dữ liệu chưa hợp lệ (tọa độ WGS84, bán kính 1–100000 m, lý do 1–500 ký tự).';
      default: return 'Chưa thực hiện được. Thử lại sau.';
    }
  }
  return 'Chưa xác nhận được kết quả. Bấm lại để gửi đúng yêu cầu cũ.';
}

function badge(label: string, tone: '' | 'ok' | 'wait' | 'lock'): HTMLElement {
  return h('span', { class: `badge${tone === '' ? '' : ` badge-${tone}`}` }, label);
}

function circleText(zone: Zone): string {
  return zone.coverage === null ? 'Chưa cấu hình GPS' : `${zone.coverage.lat.toFixed(5)}, ${zone.coverage.lng.toFixed(5)} · bán kính ${zone.coverage.radiusM.toLocaleString('vi-VN')} m`;
}

/** A scaled sketch of the circle (north up) with its centre and the radius; not a map, so it needs no tile provider. */
export function circleSketch(coverage: CoverageInput | null): HTMLElement {
  if (coverage === null) return h('p', { class: 'hint' }, 'Chưa cấu hình GPS: chưa có vòng phủ để xem.');
  const node = svg(
    'svg',
    { viewBox: '0 0 200 200', width: '200', height: '200', role: 'img', 'aria-label': `Vòng phủ bán kính ${coverage.radius_m} mét` },
    svg('rect', { x: '1', y: '1', width: '198', height: '198', fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.25' }),
    svg('circle', { cx: '100', cy: '100', r: '80', fill: 'currentColor', 'fill-opacity': '0.08', stroke: 'currentColor', 'stroke-width': '2' }),
    svg('circle', { cx: '100', cy: '100', r: '3', fill: 'currentColor' }),
    svg('line', { x1: '100', y1: '100', x2: '180', y2: '100', stroke: 'currentColor', 'stroke-dasharray': '4 3' }),
  );
  const label = svg('text', { x: '140', y: '94', 'font-size': '11', fill: 'currentColor', 'text-anchor': 'middle' });
  label.textContent = coverage.radius_m >= 1000 ? `${(coverage.radius_m / 1000).toLocaleString('vi-VN')} km` : `${coverage.radius_m} m`;
  node.append(label);
  const link = h('a', { href: `https://www.openstreetmap.org/?mlat=${coverage.lat}&mlon=${coverage.lng}#map=12/${coverage.lat}/${coverage.lng}`, target: '_blank', rel: 'noopener noreferrer', class: 'table-link' }, 'Xem tâm vùng trên OpenStreetMap');
  return h('div', { class: 'detail-block' }, node as unknown as Node, h('p', { class: 'hint' }, link));
}

function impactBlock(impact: ZoneImpact): HTMLElement {
  const lines = [
    `Quán thuộc vùng: ${impact.shopsTotal} · đang công khai: ${impact.shopsPublic}`,
    `Quán có ghim ngoài vòng hiện tại: ${impact.pinsOutsideCurrent} · ngoài vòng sau thay đổi: ${impact.pinsOutsideProposed}`,
    `Quán đang công khai sẽ không còn hiển thị (ghim lọt ra ngoài vòng mới): ${impact.publicShopsNewlyOutside}`,
    `Đơn đang xử lý: ${impact.ordersOpen} · chuyến giao đang chạy: ${impact.activeDeliveries} (đơn cũ giữ nguyên điểm lấy hàng và phí đã chốt)`,
  ];
  return h('div', { class: 'detail-block', 'data-testid': 'zone-impact' }, h('h3', { class: 'subtitle' }, 'Tác động nếu lưu'), ...lines.map((line) => h('p', { class: 'hint' }, line)),
    impact.requiresConfirmation ? h('p', { class: 'hint', role: 'alert' }, 'Cần xác nhận trước khi lưu.') : undefined);
}

class ZonesPage {
  readonly #api: ZonesApi;
  readonly #status = h('p', { role: 'status', class: 'hint', id: 'zones-status' });
  #busy = false;

  constructor(private readonly root: HTMLElement, private readonly host: ZonesHost) {
    this.#api = new ZonesApi(fetchTransport(window.fetch.bind(window), { base: '/v1' }));
  }

  get #writable(): boolean {
    return this.host.role === 'SYSTEM';
  }

  #link(route: Route, label: string, className = 'table-link table-action'): HTMLElement {
    const link = h('a', { href: formatRoute(route), class: className }, label);
    link.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.host.go(route);
      }
    });
    return link;
  }

  #token(): string | undefined {
    const token = this.host.csrf();
    if (token === undefined) this.host.onSessionLost();
    return token;
  }

  async showList(): Promise<void> {
    this.root.replaceChildren(h('section', { class: 'content content-wide' }, h('h1', { class: 'title' }, 'Vùng hoạt động'), this.#status));
    this.#status.textContent = 'Đang tải…';
    const result = await this.#api.list();
    if (!this.root.isConnected) return;
    if (result.kind !== 'ok') {
      this.#status.textContent = errorText(result, this.host);
      return;
    }
    this.#status.textContent = result.data.length === 0 ? 'Chưa có vùng nào.' : '';
    const rows = result.data.map((zone) =>
      h('tr', {},
        h('td', { 'data-label': 'Mã' }, zone.code),
        h('td', { 'data-label': 'Tên vùng' }, this.#link({ name: 'zone', id: zone.id }, zone.name)),
        h('td', { 'data-label': 'Trạng thái' }, badge(STATUS_LABEL[zone.status], zone.status === 'ACTIVE' ? 'ok' : 'lock')),
        h('td', { 'data-label': 'Tâm / bán kính' }, zone.coverage === null ? badge('Chưa cấu hình GPS', 'wait') : circleText(zone)),
        h('td', { 'data-label': 'Quán' }, `${zone.shopsTotal} (công khai ${zone.shopsPublic}${zone.pinsOutside > 0 ? `, ghim ngoài vùng ${zone.pinsOutside}` : ''})`)),
    );
    const table = h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...['Mã', 'Tên vùng', 'Trạng thái', 'Tâm / bán kính', 'Quán'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows));
    const actions = this.#writable ? [this.#createForm()] : [h('p', { class: 'hint' }, 'Chỉ tài khoản SYSTEM được tạo hoặc sửa vùng.')];
    this.root.replaceChildren(h('section', { class: 'content content-wide' }, h('h1', { class: 'title' }, 'Vùng hoạt động'), this.#status, h('div', { class: 'table-card' }, table), ...actions));
  }

  #coverageFields(initial: CoverageInput | null, idPrefix: string): { nodes: HTMLElement[]; read: () => CoverageInput | null | 'invalid'; inputs: HTMLInputElement[] } {
    const make = (id: string, label: string, value: string, step: string): [HTMLElement, HTMLInputElement] => {
      const input = h('input', { type: 'number', step, id: `${idPrefix}-${id}`, class: 'input', inputmode: 'decimal' });
      input.value = value;
      return [h('div', { class: 'field' }, h('label', { for: input.id }, label), input), input];
    };
    const [latNode, lat] = make('lat', 'Vĩ độ tâm (WGS84)', initial === null ? '' : String(initial.lat), 'any');
    const [lngNode, lng] = make('lng', 'Kinh độ tâm (WGS84)', initial === null ? '' : String(initial.lng), 'any');
    const [radiusNode, radius] = make('radius', 'Bán kính vùng (mét, 1–100000)', initial === null ? '' : String(initial.radius_m), '1');
    return {
      nodes: [latNode, lngNode, radiusNode],
      inputs: [lat, lng, radius],
      read: () => {
        if (lat.value.trim() === '' && lng.value.trim() === '' && radius.value.trim() === '') return null;
        const bad = validateCoverage(Number(lat.value), Number(lng.value), Number(radius.value));
        if (lat.value.trim() === '' || lng.value.trim() === '' || radius.value.trim() === '' || bad !== undefined) {
          this.#status.textContent = bad ?? 'Nhập đủ vĩ độ, kinh độ và bán kính, hoặc để trống cả ba.';
          return 'invalid';
        }
        return { lat: Number(lat.value), lng: Number(lng.value), radius_m: Number(radius.value) };
      },
    };
  }

  #createForm(): HTMLElement {
    const code = h('input', { id: 'zone-code', class: 'input', maxlength: '64', required: '', autocomplete: 'off' });
    const name = h('input', { id: 'zone-name', class: 'input', maxlength: '120', required: '', autocomplete: 'off' });
    const reason = h('input', { id: 'zone-reason', class: 'input', maxlength: '500', required: '', autocomplete: 'off' });
    const coverage = this.#coverageFields(null, 'zone-new');
    const submit = primary('Tạo vùng (đang tắt)', 'submit');
    const form = h('form', { class: 'detail-block', 'data-testid': 'zone-create' },
      h('h2', { class: 'subtitle' }, 'Tạo vùng mới'),
      h('p', { class: 'hint' }, 'Vùng mới luôn ở trạng thái tắt. Không có tâm và bán kính mặc định: bỏ trống nếu chưa cấu hình GPS.'),
      h('div', { class: 'field' }, h('label', { for: 'zone-code' }, 'Mã vùng'), code),
      h('div', { class: 'field' }, h('label', { for: 'zone-name' }, 'Tên vùng'), name),
      ...coverage.nodes,
      h('div', { class: 'field' }, h('label', { for: 'zone-reason' }, 'Lý do (ghi vào nhật ký)'), reason),
      h('div', { class: 'detail-actions' }, submit));
    let intent: { fingerprint: string; key: string } | undefined;
    form.onsubmit = (event) => {
      event.preventDefault();
      if (this.#busy || !form.reportValidity()) return;
      const cover = coverage.read();
      if (cover === 'invalid') return;
      const body = { code: code.value.trim(), name: name.value.trim(), status: 'INACTIVE' as const, ...(cover === null ? {} : { coverage: cover }), reason: reason.value.trim() };
      const fingerprint = JSON.stringify(body);
      if (intent?.fingerprint !== fingerprint) intent = { fingerprint, key: window.crypto.randomUUID() };
      const token = this.#token();
      if (token === undefined) return;
      this.#busy = true;
      submit.disabled = true;
      void this.#api.create(token, intent.key, body).then((result) => {
        this.#busy = false;
        submit.disabled = false;
        if (result.kind === 'ok') this.host.go({ name: 'zone', id: result.data.id });
        else this.#status.textContent = errorText(result, this.host);
      });
    };
    return form;
  }

  async showDetail(id: string): Promise<void> {
    this.root.replaceChildren(h('section', { class: 'content content-wide' }, this.#link({ name: 'zones' }, '← Danh sách vùng', 'table-link'), this.#status));
    this.#status.textContent = 'Đang tải…';
    const result = await this.#api.detail(id);
    if (!this.root.isConnected) return;
    if (result.kind !== 'ok') {
      this.#status.textContent = errorText(result, this.host);
      return;
    }
    this.#status.textContent = '';
    this.#drawDetail(result.data);
  }

  #drawDetail(zone: Zone): void {
    const facts = h('dl', { class: 'kvs' },
      ...([
        ['Mã', zone.code],
        ['Trạng thái', STATUS_LABEL[zone.status]],
        ['Tâm / bán kính', circleText(zone)],
        ['Quán thuộc vùng', String(zone.shopsTotal)],
        ['Quán đang công khai', String(zone.shopsPublic)],
        ['Quán có ghim ngoài vòng phủ', String(zone.pinsOutside)],
        ['Đơn đang xử lý', String(zone.ordersOpen ?? 0)],
        ['Chuyến giao đang chạy', String(zone.activeDeliveries ?? 0)],
        ['Phiên bản', String(zone.version)],
      ] as const).map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
    const blocks: (HTMLElement | undefined)[] = [
      h('h1', { class: 'title' }, zone.name),
      zone.coverage === null ? h('p', { class: 'hint', role: 'alert' }, 'Chưa cấu hình GPS: vùng này chưa tự nhận vị trí và chưa kiểm được ghim quán.') : undefined,
      this.#status,
      facts,
      circleSketch(zone.coverage === null ? null : { lat: zone.coverage.lat, lng: zone.coverage.lng, radius_m: zone.coverage.radiusM }),
    ];
    if (this.#writable) {
      blocks.push(this.#editForm(zone), this.#statusForm(zone));
    } else {
      blocks.push(h('p', { class: 'hint' }, 'Chỉ tài khoản SYSTEM được sửa, bật hoặc tắt vùng.'));
    }
    this.root.replaceChildren(h('section', { class: 'content content-wide' }, this.#link({ name: 'zones' }, '← Danh sách vùng', 'table-link'), ...blocks));
  }

  /** Shared by the edit and the switch forms: preview, confirm, send once per logical request. */
  #guarded(parts: { zone: Zone; submit: HTMLButtonElement; previewButton: HTMLButtonElement; reason: HTMLInputElement; preview: HTMLElement; change: () => { impact: { status?: 'ACTIVE' | 'INACTIVE'; coverage?: CoverageInput }; fingerprint: string } | undefined; send: (token: string, key: string, reason: string, confirm: boolean) => Promise<ApiResult<Zone>> }): { confirm: HTMLInputElement; confirmRow: HTMLElement; onSubmit: (event: Event) => void } {
    const confirm = h('input', { type: 'checkbox', id: `confirm-${parts.submit.id}` });
    const confirmRow = h('label', { class: 'field', hidden: true }, confirm, ' Tôi đã xem tác động và xác nhận thay đổi');
    confirmRow.hidden = true;
    let needsConfirm = false;
    let intent: { fingerprint: string; key: string } | undefined;
    parts.previewButton.addEventListener('click', () => {
      const change = parts.change();
      if (change === undefined) return;
      this.#status.textContent = 'Đang tính tác động…';
      void this.#api.impact(parts.zone.id, change.impact).then((result) => {
        if (!parts.preview.isConnected) return;
        if (result.kind !== 'ok') {
          this.#status.textContent = errorText(result, this.host);
          return;
        }
        this.#status.textContent = '';
        needsConfirm = result.data.requiresConfirmation;
        confirmRow.hidden = !needsConfirm;
        parts.preview.replaceChildren(impactBlock(result.data));
      });
    });
    const onSubmit = (event: Event): void => {
      event.preventDefault();
      if (this.#busy) return;
      const change = parts.change();
      if (change === undefined) return;
      if (parts.reason.value.trim() === '') {
        this.#status.textContent = 'Nhập lý do thay đổi.';
        return;
      }
      if (needsConfirm && !confirm.checked) {
        this.#status.textContent = 'Hãy xem tác động và tích xác nhận trước khi lưu.';
        return;
      }
      const fingerprint = `${change.fingerprint}|${parts.reason.value.trim()}|${String(confirm.checked)}`;
      if (intent?.fingerprint !== fingerprint) intent = { fingerprint, key: window.crypto.randomUUID() };
      const token = this.#token();
      if (token === undefined) return;
      this.#busy = true;
      parts.submit.disabled = true;
      void parts.send(token, intent.key, parts.reason.value.trim(), confirm.checked).then((result) => {
        this.#busy = false;
        parts.submit.disabled = false;
        if (!this.root.isConnected) return;
        if (result.kind === 'ok') {
          this.#drawDetail(result.data);
          this.#status.textContent = 'Đã lưu.';
        } else {
          this.#status.textContent = errorText(result, this.host);
          // The server counted again under lock and wants the confirmation: show the figures.
          if (result.kind === 'error' && result.code === 'SERVICE_AREA_IMPACT_CONFIRM_REQUIRED') {
            needsConfirm = true;
            confirmRow.hidden = false;
            parts.previewButton.click();
          }
        }
      });
    };
    return { confirm, confirmRow, onSubmit };
  }

  #editForm(zone: Zone): HTMLElement {
    const name = h('input', { id: 'zone-edit-name', class: 'input', maxlength: '120', required: '' });
    name.value = zone.name;
    const reason = h('input', { id: 'zone-edit-reason', class: 'input', maxlength: '500', required: '', autocomplete: 'off' });
    const coverage = this.#coverageFields(zone.coverage === null ? null : { lat: zone.coverage.lat, lng: zone.coverage.lng, radius_m: zone.coverage.radiusM }, 'zone-edit');
    const previewButton = secondary('Xem tác động');
    const submit = primary('Lưu thay đổi', 'submit');
    submit.id = 'zone-edit-submit';
    const preview = h('div', {});
    const sketch = h('div', {});
    const redraw = (): void => {
      const cover = zone.coverage === null && coverage.inputs.every((i) => i.value.trim() === '') ? null : coverageRead();
      sketch.replaceChildren(circleSketch(cover === 'invalid' ? null : cover));
    };
    const coverageRead = (): CoverageInput | null | 'invalid' => {
      const [lat, lng, radius] = coverage.inputs.map((i) => i.value.trim());
      if (lat === '' || lng === '' || radius === '' || validateCoverage(Number(lat), Number(lng), Number(radius)) !== undefined) return 'invalid';
      return { lat: Number(lat), lng: Number(lng), radius_m: Number(radius) };
    };
    for (const input of coverage.inputs) input.addEventListener('input', redraw);
    const guarded = this.#guarded({
      zone, submit, previewButton, reason, preview,
      change: () => {
        const cover = coverage.read();
        if (cover === 'invalid') return undefined;
        const changed = cover !== null && (zone.coverage === null || cover.lat !== zone.coverage.lat || cover.lng !== zone.coverage.lng || cover.radius_m !== zone.coverage.radiusM);
        return { impact: changed && cover !== null ? { coverage: cover } : {}, fingerprint: JSON.stringify([name.value.trim(), changed ? cover : null]) };
      },
      send: (token, key, why, confirm) => {
        const cover = coverage.read();
        const changed = cover !== null && cover !== 'invalid' && (zone.coverage === null || cover.lat !== zone.coverage.lat || cover.lng !== zone.coverage.lng || cover.radius_m !== zone.coverage.radiusM);
        return this.#api.update(token, key, zone.id, { expected_version: zone.version, name: name.value.trim(), ...(changed ? { coverage: cover } : {}), reason: why, confirm_impact: confirm });
      },
    });
    const form = h('form', { class: 'detail-block', 'data-testid': 'zone-edit' },
      h('h2', { class: 'subtitle' }, 'Sửa tên và vòng phủ'),
      h('p', { class: 'hint' }, 'Không có vòng phủ mặc định. Thay đổi vòng phủ không di chuyển quán sang vùng khác và không đổi đơn đã tạo.'),
      h('div', { class: 'field' }, h('label', { for: 'zone-edit-name' }, 'Tên vùng'), name),
      ...coverage.nodes,
      sketch,
      h('div', { class: 'field' }, h('label', { for: 'zone-edit-reason' }, 'Lý do (ghi vào nhật ký)'), reason),
      preview, guarded.confirmRow,
      h('div', { class: 'detail-actions' }, previewButton, submit));
    form.onsubmit = guarded.onSubmit;
    return form;
  }

  #statusForm(zone: Zone): HTMLElement {
    const target = zone.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const reason = h('input', { id: 'zone-status-reason', class: 'input', maxlength: '500', required: '', autocomplete: 'off' });
    const previewButton = secondary('Xem tác động');
    const submit = primary(target === 'INACTIVE' ? 'Tắt vùng' : 'Bật vùng', 'submit');
    submit.id = 'zone-status-submit';
    const preview = h('div', {});
    const guarded = this.#guarded({
      zone, submit, previewButton, reason, preview,
      change: () => ({ impact: { status: target }, fingerprint: target }),
      send: (token, key, why, confirm) => this.#api.setStatus(token, key, zone.id, { expected_version: zone.version, status: target, reason: why, confirm_impact: confirm }),
    });
    const form = h('form', { class: 'detail-block', 'data-testid': 'zone-status' },
      h('h2', { class: 'subtitle' }, target === 'INACTIVE' ? 'Tắt vùng' : 'Bật vùng'),
      h('p', { class: 'hint' }, target === 'INACTIVE' ? 'Quán trong vùng sẽ không còn hiển thị với khách mới; đơn đang chạy vẫn tiếp tục. Vùng không bị xóa.' : 'Bật lại cho phép quán chọn vùng và hiển thị theo điều kiện công khai.'),
      h('div', { class: 'field' }, h('label', { for: 'zone-status-reason' }, 'Lý do (ghi vào nhật ký)'), reason),
      preview, guarded.confirmRow,
      h('div', { class: 'detail-actions' }, previewButton, submit));
    form.onsubmit = guarded.onSubmit;
    return form;
  }
}

export function zonesPage(root: HTMLElement, host: ZonesHost, id: string | undefined): void {
  const page = new ZonesPage(root, host);
  void (id === undefined ? page.showList() : page.showDetail(id));
}
