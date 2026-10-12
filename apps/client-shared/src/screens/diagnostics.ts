import { AppBrand } from '../brand.js';
import { banner, button, chip, setButtonLabel } from '../components.js';
import { ConnectionState, diagnosticsReport } from '../connection.js';
import { CHECKING_LABEL } from '../connection-ui.js';
import { formatDateTime, h } from '../dom.js';
import { HEALTH_COPY, HEALTH_REASON_LABEL } from '../errors.js';
import { LIVE_PATH, ProbeResult, READY_PATH } from '../health.js';
import { ScreenDef, ScreenEnv } from '../screen.js';
import { STATE_COPY } from '../states.js';
import { appPage, designOnly } from './layout.js';

// Diagnostics (catalog F05 for 11Food, S06 for 11Ship): which app and build this is, and whether the server answers
// /v1/health/live and /v1/health/ready. A technical panel kept apart from the product screens; it shows no business data.
// Every value comes from the ConnectionView (real checks in the app, a fixed example in the design preview); the fixed
// wording of failures comes from errors.ts, so no raw exception, address of a database or token can appear here.

export const DIAGNOSTICS_ID = 'diagnostics';
export const DIAGNOSTICS_PATH = '/diagnostics';
const RECHECK_LABEL = 'Kiểm tra lại';
const COPY_LABEL = 'Sao chép thông tin lỗi';

export interface DiagnosticsConfig {
  readonly brand: AppBrand;
  /** Screen code in the catalog (F05 / S06). */
  readonly code: string;
  /** Bottom navigation of the app, with the account tab active (diagnostics is opened from the account screen). */
  readonly nav: (env: ScreenEnv) => HTMLElement;
}

function row(label: string, value: Node | string): HTMLElement {
  return h('div', { class: 'c-kv' }, h('dt', {}, label), h('dd', {}, value));
}

function probeChip(result: ProbeResult): HTMLElement {
  switch (result.state) {
    case 'pending':
      return chip('Đang kiểm tra', 'info');
    case 'skipped':
      return chip('Chưa kiểm tra', 'soon');
    case 'ok':
      return chip(`Đạt · ${result.elapsedMs} ms`, 'ok');
    case 'failed':
      return chip(`${HEALTH_REASON_LABEL[result.reason]}${result.httpStatus === undefined || result.reason === 'NOT_READY' ? '' : ` (${result.httpStatus})`}`, result.reason === 'NOT_READY' ? 'warn' : 'bad');
  }
}

function statusBanner(state: ConnectionState): HTMLElement {
  const phase = state.health.phase;
  const copy = HEALTH_COPY[phase];
  const kind = phase === 'ready' ? 'success' : phase === 'checking' ? 'info' : phase === 'backend_not_ready' ? 'warn' : 'error';
  const node = banner({ kind, title: copy.title, text: copy.text });
  // The surrounding region is the live region; a second role=alert inside it would announce the same text twice.
  node.removeAttribute('role');
  return node;
}

function buildRows(state: ConnectionState, brand: AppBrand): HTMLElement[] {
  const { build, origin } = state;
  const waiting = build.kind === 'loading' ? 'Đang đọc…' : 'Chưa đọc được';
  const info = build.kind === 'ok' ? build.info : undefined;
  return [
    row('Ứng dụng', info === undefined ? brand.name : `${brand.name} (${info.appId})`),
    row('Địa chỉ ứng dụng', origin),
    row('Bản dựng', info === undefined ? waiting : info.mode === 'live' ? 'Chạy thật' : 'Xem thiết kế'),
    row('Mã nguồn', info === undefined ? waiting : info.sourceSha === 'unknown' ? 'Không rõ' : info.sourceSha.slice(0, 12)),
    row('Dấu vân tay bản dựng', info === undefined ? waiting : `${info.fingerprint.slice(0, 16)}…`),
  ];
}

function serverRows(state: ConnectionState): HTMLElement[] {
  const { health } = state;
  const stamp = health.lastCheckedAt === undefined ? 'Chưa có' : formatDateTime(new Date(health.lastCheckedAt).toISOString());
  return [row(`Còn sống (${LIVE_PATH})`, probeChip(health.live)), row(`Sẵn sàng (${READY_PATH})`, probeChip(health.ready)), row('Lần kiểm tra gần nhất', stamp)];
}

export function diagnosticsScreen(config: DiagnosticsConfig): ScreenDef {
  return {
    id: DIAGNOSTICS_ID,
    code: config.code,
    title: 'Chẩn đoán kết nối',
    group: 'Tài khoản',
    path: DIAGNOSTICS_PATH,
    access: 'public',
    hideConnectionBanner: true,
    variants: [
      { id: 'default', label: 'Sẵn sàng' },
      { id: 'checking', label: 'Đang kiểm tra' },
      { id: 'backend-not-ready', label: 'Backend chưa ready' },
      { id: 'offline', label: 'Offline' },
      { id: 'timeout', label: 'Quá thời gian chờ' },
      { id: 'bad-response', label: 'Phản hồi sai nội dung' },
    ],
    render: (env) => {
      const view = env.connection;
      const state0 = view.state();

      const status = h('div', { class: 'c-stack', role: 'status', 'aria-live': 'polite', id: 'diag-status' });
      const appRows = h('dl', { class: 'c-stack c-stack--tight', id: 'diag-app' });
      const serverList = h('dl', { class: 'c-stack c-stack--tight', id: 'diag-server' });
      const report = h('pre', { class: 'c-diag-report', id: 'diag-report', tabindex: '0', 'aria-label': 'Thông tin chẩn đoán' });
      report.hidden = true;

      const recheck = button({ label: RECHECK_LABEL, kind: 'primary', icon: 'refresh', id: 'diag-recheck', onClick: () => (env.mode === 'design' ? designOnly(env, STATE_COPY.designNoSend) : view.recheck()) });
      const copy = button({
        label: COPY_LABEL,
        kind: 'secondary',
        icon: 'copy',
        id: 'diag-copy',
        onClick: () => {
          if (env.mode === 'design') {
            designOnly(env, STATE_COPY.designNoSend);
            return;
          }
          const text = diagnosticsReport(env.brand.name, view.state());
          void (async () => {
            try {
              await navigator.clipboard.writeText(text);
              report.hidden = true;
              env.toast('Đã sao chép thông tin chẩn đoán.');
            } catch {
              // No clipboard permission or not a secure page: show the text so it can be selected by hand.
              report.textContent = text;
              report.hidden = false;
              env.toast('Chưa sao chép được. Hãy chọn và sao chép nội dung hiển thị bên dưới.');
            }
          })();
        },
      });

      const update = (state: ConnectionState): void => {
        status.replaceChildren(statusBanner(state));
        appRows.replaceChildren(...buildRows(state, env.brand));
        serverList.replaceChildren(...serverRows(state));
        const checking = state.health.phase === 'checking';
        setButtonLabel(recheck, checking ? CHECKING_LABEL : RECHECK_LABEL);
        // aria-disabled (not `disabled`): the button stays focusable, so the focus survives the state change.
        recheck.setAttribute('aria-disabled', String(checking));
        recheck.setAttribute('aria-busy', String(checking));
        root.setAttribute('data-connection', state.health.phase);
      };

      const root = appPage({
        title: 'Chẩn đoán kết nối',
        onBack: () => env.go('account'),
        nav: config.nav(env),
        bodyClass: 'c-stack',
        body: [
          env.mode === 'design' ? chip(STATE_COPY.designBanner, 'warn') : undefined,
          status,
          h('section', { class: 'c-card c-stack c-stack--tight', 'aria-labelledby': 'diag-app-title' }, h('h2', { class: 'c-title c-title--sm', id: 'diag-app-title' }, 'Ứng dụng'), appRows),
          h('section', { class: 'c-card c-stack c-stack--tight', 'aria-labelledby': 'diag-server-title' }, h('h2', { class: 'c-title c-title--sm', id: 'diag-server-title' }, 'Máy chủ'), serverList),
          h('div', { class: 'c-stack' }, recheck, copy),
          report,
        ],
      });
      update(state0);

      // The screen is rebuilt on every visit, so a listener of a screen that has left the page removes itself.
      const off = view.subscribe((state) => {
        if (!root.isConnected) {
          off();
          return;
        }
        update(state);
      });
      return root;
    },
  };
}
