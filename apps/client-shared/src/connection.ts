import { BuildInfoState } from './environment.js';
import { HEALTH_COPY, HEALTH_REASON_LABEL, sanitizeDiagnosticText } from './errors.js';
import { HealthMonitor, HealthSnapshot, ProbeResult } from './health.js';

// The one object the screens read to know "is the server reachable". In the real app it is backed by a HealthMonitor
// (real requests); in the design preview it is a fixed fixture. A screen never calls the network and never decides by
// itself whether the server is up: it renders what this says.

export interface ConnectionState {
  readonly health: HealthSnapshot;
  readonly build: BuildInfoState;
  /** Address the app is served from (e.g. `https://localhost:8444`). A fact of the page, not a secret. */
  readonly origin: string;
}

export type ConnectionListener = (state: ConnectionState) => void;

export interface ConnectionView {
  state(): ConnectionState;
  /** Called on every change (not on subscribe). Returns the unsubscribe. */
  subscribe(listener: ConnectionListener): () => void;
  /** Starts a new health check. In the design preview it does nothing. */
  recheck(): void;
}

/** Fixed state for the design preview: no timers, no network, `recheck` is a no-op. */
export function staticConnection(state: ConnectionState): ConnectionView {
  return { state: () => state, subscribe: () => () => undefined, recheck: () => undefined };
}

/** Live view: health from the monitor, build facts loaded once (and set later through the returned `setBuild`). */
export function liveConnection(monitor: HealthMonitor, origin: string): ConnectionView & { setBuild(build: BuildInfoState): void } {
  let build: BuildInfoState = { kind: 'loading' };
  const listeners = new Set<ConnectionListener>();
  const current = (): ConnectionState => ({ health: monitor.snapshot(), build, origin });
  const emit = (): void => {
    const state = current();
    for (const listener of [...listeners]) {
      listener(state);
    }
  };
  monitor.subscribe(emit);
  return {
    state: current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recheck: () => {
      void monitor.check();
    },
    setBuild: (next) => {
      build = next;
      emit();
    },
  };
}

function probeLine(label: string, result: ProbeResult): string {
  switch (result.state) {
    case 'pending':
      return `${label}: đang kiểm tra`;
    case 'skipped':
      return `${label}: chưa kiểm tra`;
    case 'ok':
      return `${label}: đạt (HTTP ${result.httpStatus}, ${result.elapsedMs} ms)`;
    case 'failed':
      return `${label}: không đạt — ${HEALTH_REASON_LABEL[result.reason]}${result.httpStatus === undefined ? '' : ` (HTTP ${result.httpStatus})`}, ${result.elapsedMs} ms`;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatStamp(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The text behind "Sao chép thông tin lỗi": what a support person needs, and nothing that could be a secret. Every line is
 * built from the closed vocabulary of errors.ts or from public build facts; the only free-text value (the page address)
 * goes through `sanitizeDiagnosticText`. The 64-hex build fingerprint is public and is added after sanitizing.
 */
export function diagnosticsReport(appName: string, state: ConnectionState): string {
  const { health, build, origin } = state;
  const lines = [`Chẩn đoán ${appName}`, `Địa chỉ ứng dụng: ${sanitizeDiagnosticText(origin, 120)}`];
  if (build.kind === 'ok') {
    lines.push(`Bản dựng: ${build.info.mode}`, `Mã nguồn: ${build.info.sourceSha}`, `Dấu vân tay bản dựng: ${build.info.fingerprint}`);
  } else {
    lines.push(build.kind === 'loading' ? 'Bản dựng: đang đọc' : 'Bản dựng: chưa đọc được');
  }
  lines.push(`Trạng thái: ${HEALTH_COPY[health.phase].title}`, probeLine('Còn sống (live)', health.live), probeLine('Sẵn sàng (ready)', health.ready));
  lines.push(health.lastCheckedAt === undefined ? 'Lần kiểm tra gần nhất: chưa có' : `Lần kiểm tra gần nhất: ${formatStamp(health.lastCheckedAt)}`);
  return lines.join('\n');
}
