import { readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import tls from 'node:tls';

// The measurements of the machine and of the outside world, behind one interface so the collector can be tested with scripted answers (no real outage is ever
// created to test M13). Each method returns null / a failed result instead of throwing: "could not measure" is a fact the collector turns into "no data".

export interface HttpProbeResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly latencyMs: number;
  /** A fixed code for a failure (never a message): TIMEOUT, NETWORK, HTTP_503 ... */
  readonly code: string | null;
}

export interface OpsSystemProbe {
  /** CPU use (percent) since the previous call; null on the first call or when it cannot be read. */
  cpuPercent(): number | null;
  /** Memory in use (percent of total, "available" memory counted as free); null when it cannot be read. */
  memoryPercent(): number | null;
  diskPercent(path: string): number | null;
  /** GET the process's own liveness endpoint over loopback. */
  selfHealth(): Promise<HttpProbeResult>;
  /** GET an operator-configured health URL (M14). */
  get(url: string, timeoutMs: number): Promise<HttpProbeResult>;
  /** Days until the certificate served by an https URL expires; null when it cannot be read. */
  certDaysLeft(baseUrl: string, timeoutMs: number): Promise<number | null>;
}

export const OPS_SYSTEM_PROBE = Symbol('OPS_SYSTEM_PROBE');

export interface NodeProbeOptions {
  readonly host: string;
  readonly port: number;
}

export class NodeSystemProbe implements OpsSystemProbe {
  #lastCpu: { idle: number; total: number } | undefined;

  constructor(private readonly options: NodeProbeOptions) {}

  cpuPercent(): number | null {
    try {
      let idle = 0;
      let total = 0;
      for (const cpu of os.cpus()) {
        const t = cpu.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.idle + t.irq;
      }
      const previous = this.#lastCpu;
      this.#lastCpu = { idle, total };
      if (previous === undefined || total <= previous.total) {
        return null;
      }
      const busy = 1 - (idle - previous.idle) / (total - previous.total);
      return Math.min(100, Math.max(0, busy * 100));
    } catch {
      return null;
    }
  }

  memoryPercent(): number | null {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const total = /^MemTotal:\s+(\d+) kB/m.exec(meminfo);
      const available = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);
      if (total !== null && available !== null && Number(total[1]) > 0) {
        return Math.min(100, Math.max(0, (1 - Number(available[1]) / Number(total[1])) * 100));
      }
    } catch {
      // not Linux, or no /proc: fall through to the portable value
    }
    const totalMem = os.totalmem();
    return totalMem > 0 ? Math.min(100, Math.max(0, (1 - os.freemem() / totalMem) * 100)) : null;
  }

  diskPercent(path: string): number | null {
    try {
      const s = statfsSync(path);
      const total = Number(s.blocks);
      return total > 0 ? Math.min(100, Math.max(0, (1 - Number(s.bavail) / total) * 100)) : null;
    } catch {
      return null;
    }
  }

  selfHealth(): Promise<HttpProbeResult> {
    const host = this.options.host === '0.0.0.0' || this.options.host === '::' || this.options.host === '' ? '127.0.0.1' : this.options.host;
    return this.get(`http://${host.includes(':') ? `[${host}]` : host}:${this.options.port}/v1/health/live`, 5000);
  }

  async get(url: string, timeoutMs: number): Promise<HttpProbeResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
      await response.arrayBuffer().catch(() => undefined);
      const ok = response.status >= 200 && response.status < 300;
      return { ok, status: response.status, latencyMs: Date.now() - started, code: ok ? null : `HTTP_${response.status}` };
    } catch {
      return { ok: false, status: null, latencyMs: Date.now() - started, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }

  certDaysLeft(baseUrl: string, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        resolve(null);
        return;
      }
      if (url.protocol !== 'https:') {
        resolve(null);
        return;
      }
      // Only the certificate's expiry date is read; nothing is sent. Verification is off on purpose: an expired or mismatched certificate must still report its date.
      const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: false, timeout: timeoutMs }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const until = cert?.valid_to === undefined ? Number.NaN : Date.parse(cert.valid_to);
        resolve(Number.isFinite(until) ? (until - Date.now()) / 86_400_000 : null);
      });
      socket.on('error', () => resolve(null));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
    });
  }
}
