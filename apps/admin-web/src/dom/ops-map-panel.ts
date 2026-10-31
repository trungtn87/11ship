import { fetchTransport } from '../core/api.js';
import { fitSketch, MapShipper, OpsMap, OpsMapApi, SKETCH_SIZE } from '../core/ops-map.js';
import { h, svg } from './dom.js';

// "Bản đồ vận hành" on the Điều hành page (issue #262, IV): an internal SVG sketch on the WGS84 plane. No map tiles, no third-party host, no absolute URL, no CSP change:
// it draws the service-area circles, the pins of the active shops and the latest position of the Online Shippers, exactly what the server sent for this actor. A stale
// position is drawn hollow and labelled as old; a Shipper without a usable position is only counted. It is not a route planner and shows no distance between two points.

export interface OpsMapHost {
  readonly onSessionLost: () => void;
}

const COLOR = { zoneActive: '#2563eb', zoneInactive: '#94a3b8', shop: '#16a34a', shipperLive: '#ea580c', shipperStale: '#9a3412' } as const;

function ageText(seconds: number): string {
  return seconds < 60 ? `${seconds} giây trước` : `${Math.round(seconds / 60)} phút trước`;
}

function shipperLabel(s: MapShipper): string {
  const who = s.name ?? s.code ?? 'Shipper';
  return `${who} · ${s.freshness === 'LIVE' ? 'trực tiếp' : 'vị trí cũ'} (${ageText(s.ageSeconds)})`;
}

export function renderOpsMap(map: OpsMap): HTMLElement {
  const coverages = map.zones.flatMap((z) => (z.coverage === null ? [] : [{ lat: z.coverage.lat, lng: z.coverage.lng, radiusM: z.coverage.radiusM }]));
  const points = [...(map.shops ?? []).map((s) => ({ lat: s.lat, lng: s.lng })), ...(map.shippers ?? []).map((s) => ({ lat: s.lat, lng: s.lng }))];
  const sketch = fitSketch(points, coverages);
  const section = h('section', { class: 'ov-section', 'aria-labelledby': 'ops-map-title', 'data-testid': 'ops-map' }, h('h2', { class: 'subtitle', id: 'ops-map-title' }, 'Bản đồ vận hành'));
  if (sketch === undefined) {
    section.append(h('p', { class: 'hint' }, 'Chưa có vòng vùng, ghim quán hoặc vị trí shipper nào để vẽ.'));
  } else {
    const node = svg('svg', { viewBox: `0 0 ${SKETCH_SIZE} ${SKETCH_SIZE}`, width: '100%', role: 'img', 'aria-label': 'Phác thảo vị trí các vùng, quán và shipper đang Online', style: 'max-width:420px' });
    node.append(svg('rect', { x: '1', y: '1', width: String(SKETCH_SIZE - 2), height: String(SKETCH_SIZE - 2), fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.25' }));
    for (const z of map.zones) {
      if (z.coverage === null) continue;
      const c = sketch.project(z.coverage.lat, z.coverage.lng);
      const color = z.status === 'ACTIVE' ? COLOR.zoneActive : COLOR.zoneInactive;
      const circle = svg('circle', { cx: c.x.toFixed(1), cy: c.y.toFixed(1), r: (z.coverage.radiusM * sketch.scale).toFixed(1), fill: color, 'fill-opacity': '0.08', stroke: color, 'stroke-width': '1.5', ...(z.status === 'ACTIVE' ? {} : { 'stroke-dasharray': '4 3' }) });
      const title = svg('title', {});
      title.textContent = `${z.name} · ${z.status === 'ACTIVE' ? 'đang hoạt động' : 'tạm ngưng'} · bán kính ${z.coverage.radiusM.toLocaleString('vi-VN')} m`;
      circle.append(title);
      node.append(circle);
    }
    for (const s of map.shops ?? []) {
      const p = sketch.project(s.lat, s.lng);
      const dot = svg('rect', { x: (p.x - 3).toFixed(1), y: (p.y - 3).toFixed(1), width: '6', height: '6', fill: COLOR.shop });
      const title = svg('title', {});
      title.textContent = `Quán ${s.name}`;
      dot.append(title);
      node.append(dot);
    }
    for (const s of map.shippers ?? []) {
      const p = sketch.project(s.lat, s.lng);
      const live = s.freshness === 'LIVE';
      const dot = svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: '4', fill: live ? COLOR.shipperLive : 'none', stroke: live ? COLOR.shipperLive : COLOR.shipperStale, 'stroke-width': '1.5', ...(live ? {} : { 'stroke-dasharray': '2 2' }) });
      const title = svg('title', {});
      title.textContent = shipperLabel(s);
      dot.append(title);
      node.append(dot);
    }
    section.append(node as unknown as Node);
    section.append(h('p', { class: 'hint' }, `Phác thảo tọa độ thật, không phải bản đồ đường đi. Chiều ngang khoảng ${(sketch.widthMetres / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km.`));
  }
  const legend: string[] = [];
  if (map.shops !== null) {
    legend.push(`■ Quán đang hoạt động có ghim: ${map.shops.length}${map.shopsWithoutPin === null || map.shopsWithoutPin === 0 ? '' : ` · chưa có ghim hợp lệ: ${map.shopsWithoutPin}`}`);
  }
  if (map.shippers !== null) {
    const live = map.shippers.filter((s) => s.freshness === 'LIVE').length;
    legend.push(`● Shipper đang Online có vị trí: ${map.shippers.length} (trực tiếp ${live}, vị trí cũ ${map.shippers.length - live}, hiển thị nét đứt)${map.shippersWithoutPosition === null || map.shippersWithoutPosition === 0 ? '' : ` · chưa có vị trí dùng được: ${map.shippersWithoutPosition} (không vẽ)`}`);
  }
  legend.push('◯ Vòng vùng phục vụ (nét liền: đang hoạt động; nét đứt: tạm ngưng)');
  if (map.truncated) legend.push('Danh sách quá dài nên chỉ vẽ một phần đầu.');
  section.append(h('ul', { class: 'hint', 'data-testid': 'ops-map-legend' }, ...legend.map((line) => h('li', {}, line))));
  return section;
}

/** Loads and draws the map into `target`. A refusal or a failure says so in words; it never leaves a blank or a stale picture. */
export async function loadOpsMap(target: HTMLElement, host: OpsMapHost, api = new OpsMapApi(fetchTransport(window.fetch.bind(window), { base: '/v1' }))): Promise<void> {
  const result = await api.read();
  if (!target.isConnected && target.parentNode === null) return;
  if (result.kind === 'ok') {
    target.replaceChildren(renderOpsMap(result.data));
    return;
  }
  if (result.kind === 'error' && result.status === 401) {
    host.onSessionLost();
    return;
  }
  const forbidden = result.kind === 'error' && result.status === 403;
  target.replaceChildren(h('section', { class: 'ov-section', 'data-testid': 'ops-map' }, h('h2', { class: 'subtitle' }, 'Bản đồ vận hành'), h('p', { class: 'hint', role: 'status' }, forbidden ? 'Tài khoản này chưa được cấp quyền xem ứng dụng Quán hoặc Shipper nên không có bản đồ vận hành.' : 'Chưa tải được bản đồ vận hành. Kiểm tra kết nối rồi mở lại trang.')));
}
