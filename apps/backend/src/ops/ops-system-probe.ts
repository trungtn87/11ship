import { readFileSync, readdirSync, statfsSync } from 'node:fs';
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

export interface HostDisk {
  readonly label: string;
  readonly path: string;
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly usedBytes: number;
  readonly usedPercent: number;
}

export interface HostProcess {
  readonly pid: number;
  /** The short executable name only (comm, at most 32 characters). The command line and environment of a process are never read: they can hold secrets. */
  readonly name: string;
  readonly cpuPercent: number | null;
  readonly rssBytes: number;
  readonly memoryPercent: number;
}

/** One read-only measurement of the machine; any part that cannot be read on this platform is null (never invented). */
export interface HostSnapshot {
  readonly sampledAtMs: number;
  readonly uptimeSeconds: number;
  readonly cpuPercent: number | null;
  readonly cpuCores: number;
  readonly loadAvg: readonly [number, number, number];
  readonly memory: { readonly totalBytes: number; readonly availableBytes: number; readonly usedBytes: number; readonly usedPercent: number } | null;
  readonly swap: { readonly totalBytes: number; readonly usedBytes: number; readonly usedPercent: number } | null;
  readonly disks: readonly HostDisk[];
  readonly io: { readonly readBytes: number; readonly writeBytes: number } | null;
  readonly network: { readonly rxBytesTotal: number; readonly txBytesTotal: number; readonly rxBytesPerSec: number | null; readonly txBytesPerSec: number | null } | null;
  readonly processesByCpu: readonly HostProcess[];
  readonly processesByMemory: readonly HostProcess[];
  readonly backend: { readonly pid: number; readonly uptimeSeconds: number; readonly rssBytes: number; readonly heapUsedBytes: number; readonly cpuPercent: number | null };
}

export interface DiskPathSpec {
  readonly label: string;
  readonly path: string;
}

export interface OpsSystemProbe {
  /** The wider read-only picture of the host for the VPS monitoring page. Reads only /proc and node:os; never runs a command. */
  hostSnapshot(disks: readonly DiskPathSpec[]): HostSnapshot;
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
  /** Test seam: reads a /proc file as text (default: the real file system) and lists the numeric /proc entries. */
  readonly readProc?: (path: string) => string;
  readonly listPids?: () => string[];
}

const PROCESS_LIMIT = 5;
const PROCESS_SCAN_MAX = 2000;
const CLOCK_TICKS = 100;
const PAGE_BYTES = 4096;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const clampPercent = (v: number): number => Math.min(100, Math.max(0, v));

export class NodeSystemProbe implements OpsSystemProbe {
  #lastCpu: { idle: number; total: number } | undefined;
  #lastSnapshotCpu: { idle: number; total: number } | undefined;
  #lastNet: { atMs: number; rx: number; tx: number } | undefined;
  #lastProc: { atMs: number; ticks: Map<number, number> } | undefined;
  #lastSelf: { atMs: number; micros: number } | undefined;
  readonly #read: (path: string) => string;
  readonly #pids: () => string[];

  constructor(private readonly options: NodeProbeOptions) {
    this.#read = options.readProc ?? ((path: string) => readFileSync(path, 'utf8'));
    this.#pids = options.listPids ?? (() => readdirSync('/proc').filter((n) => /^\d+$/.test(n)));
  }

  hostSnapshot(disks: readonly DiskPathSpec[]): HostSnapshot {
    const now = Date.now();
    const load = os.loadavg();
    const loadAvg = this.#loadAvg() ?? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0];
    const mem = this.#memory();
    const usage = process.cpuUsage();
    const micros = usage.user + usage.system;
    const previousSelf = this.#lastSelf;
    this.#lastSelf = { atMs: now, micros };
    const selfCpu = previousSelf === undefined || now <= previousSelf.atMs ? null : round1(clampPercent(((micros - previousSelf.micros) / 1000 / (now - previousSelf.atMs)) * 100));
    const usageNow = process.memoryUsage();
    const processes = this.#processes(now, mem.memory?.totalBytes ?? os.totalmem());
    return {
      sampledAtMs: now,
      uptimeSeconds: Math.floor(os.uptime()),
      cpuPercent: this.#snapshotCpu(),
      cpuCores: Math.max(1, os.cpus().length),
      loadAvg: [round1(loadAvg[0]), round1(loadAvg[1]), round1(loadAvg[2])],
      memory: mem.memory,
      swap: mem.swap,
      disks: disks.flatMap((d) => this.#disk(d)),
      io: this.#diskIo(),
      network: this.#network(now),
      processesByCpu: [...processes].sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || b.rssBytes - a.rssBytes).slice(0, PROCESS_LIMIT),
      processesByMemory: [...processes].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, PROCESS_LIMIT),
      backend: { pid: process.pid, uptimeSeconds: Math.floor(process.uptime()), rssBytes: usageNow.rss, heapUsedBytes: usageNow.heapUsed, cpuPercent: selfCpu },
    };
  }

  /** CPU since the previous snapshot, with its own baseline so the snapshot and the machine check never disturb each other's delta. */
  #snapshotCpu(): number | null {
    try {
      let idle = 0;
      let total = 0;
      for (const cpu of os.cpus()) {
        const t = cpu.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.idle + t.irq;
      }
      const previous = this.#lastSnapshotCpu;
      this.#lastSnapshotCpu = { idle, total };
      if (previous === undefined || total <= previous.total) return null;
      return round1(clampPercent((1 - (idle - previous.idle) / (total - previous.total)) * 100));
    } catch {
      return null;
    }
  }

  #loadAvg(): [number, number, number] | undefined {
    try {
      const parts = this.#read('/proc/loadavg').trim().split(/\s+/).slice(0, 3).map(Number);
      return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0] as number, parts[1] as number, parts[2] as number] : undefined;
    } catch {
      return undefined;
    }
  }

  #memory(): { memory: HostSnapshot['memory']; swap: HostSnapshot['swap'] } {
    let total = 0;
    let available = 0;
    let swapTotal = 0;
    let swapFree = 0;
    let fromProc = false;
    try {
      const text = this.#read('/proc/meminfo');
      const kb = (name: string): number | undefined => {
        const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
        return m === null ? undefined : Number(m[1]) * 1024;
      };
      const t = kb('MemTotal');
      const a = kb('MemAvailable');
      if (t !== undefined && a !== undefined && t > 0) {
        total = t;
        available = a;
        swapTotal = kb('SwapTotal') ?? 0;
        swapFree = kb('SwapFree') ?? 0;
        fromProc = true;
      }
    } catch {
      // not Linux: the portable values below (no swap figure)
    }
    if (!fromProc) {
      total = os.totalmem();
      available = os.freemem();
    }
    const memory = total > 0 ? { totalBytes: total, availableBytes: available, usedBytes: Math.max(0, total - available), usedPercent: round1(clampPercent((1 - available / total) * 100)) } : null;
    const swap = fromProc ? { totalBytes: swapTotal, usedBytes: Math.max(0, swapTotal - swapFree), usedPercent: swapTotal > 0 ? round1(clampPercent(((swapTotal - swapFree) / swapTotal) * 100)) : 0 } : null;
    return { memory, swap };
  }

  #disk(spec: DiskPathSpec): HostDisk[] {
    try {
      const s = statfsSync(spec.path);
      const block = Number(s.bsize);
      const total = Number(s.blocks) * block;
      const free = Number(s.bavail) * block;
      if (!(total > 0)) return [];
      return [{ label: spec.label, path: spec.path, totalBytes: total, freeBytes: free, usedBytes: Math.max(0, total - free), usedPercent: round1(clampPercent((1 - free / total) * 100)) }];
    } catch {
      return [];
    }
  }

  /** Whole-disk bytes read / written since boot (partitions and virtual devices are skipped so nothing is counted twice). */
  #diskIo(): HostSnapshot['io'] {
    try {
      let read = 0;
      let write = 0;
      let seen = false;
      for (const line of this.#read('/proc/diskstats').split('\n')) {
        const f = line.trim().split(/\s+/);
        const name = f[2];
        if (name === undefined || !/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(name)) continue;
        read += Number(f[5]) * 512;
        write += Number(f[9]) * 512;
        seen = true;
      }
      return seen && Number.isFinite(read) && Number.isFinite(write) ? { readBytes: read, writeBytes: write } : null;
    } catch {
      return null;
    }
  }

  #network(now: number): HostSnapshot['network'] {
    try {
      let rx = 0;
      let tx = 0;
      let seen = false;
      for (const line of this.#read('/proc/net/dev').split('\n').slice(2)) {
        const at = line.indexOf(':');
        if (at < 0 || line.slice(0, at).trim() === 'lo') continue;
        const f = line.slice(at + 1).trim().split(/\s+/);
        rx += Number(f[0]);
        tx += Number(f[8]);
        seen = true;
      }
      if (!seen || !Number.isFinite(rx) || !Number.isFinite(tx)) return null;
      const previous = this.#lastNet;
      this.#lastNet = { atMs: now, rx, tx };
      const seconds = previous === undefined ? 0 : (now - previous.atMs) / 1000;
      const usable = previous !== undefined && seconds > 0 && rx >= previous.rx && tx >= previous.tx;
      return { rxBytesTotal: rx, txBytesTotal: tx, rxBytesPerSec: usable ? Math.round((rx - previous.rx) / seconds) : null, txBytesPerSec: usable ? Math.round((tx - previous.tx) / seconds) : null };
    } catch {
      return null;
    }
  }

  /** Only /proc/<pid>/stat is read (name, CPU ticks, resident pages): never cmdline or environ, which can carry tokens and connection strings. */
  #processes(now: number, totalBytes: number): HostProcess[] {
    let pids: string[];
    try {
      pids = this.#pids().slice(0, PROCESS_SCAN_MAX);
    } catch {
      return [];
    }
    const ticks = new Map<number, number>();
    const found: { pid: number; name: string; ticks: number; rss: number }[] = [];
    for (const raw of pids) {
      try {
        const stat = this.#read(`/proc/${raw}/stat`);
        // "pid (comm) state ..." and comm may hold spaces or parentheses: the fields start after the LAST ')'.
        const open = stat.indexOf('(');
        const close = stat.lastIndexOf(')');
        if (open < 0 || close < open) continue;
        const f = stat.slice(close + 2).split(' ');
        const used = Number(f[11]) + Number(f[12]);
        const rssPages = Number(f[21]);
        if (!Number.isFinite(used) || !Number.isFinite(rssPages)) continue;
        const pid = Number(raw);
        ticks.set(pid, used);
        found.push({ pid, name: stat.slice(open + 1, close).replace(/[^\x20-\x7e]/g, '?').slice(0, 32), ticks: used, rss: rssPages * PAGE_BYTES });
      } catch {
        // the process exited between the listing and the read
      }
    }
    const previous = this.#lastProc;
    this.#lastProc = { atMs: now, ticks };
    const seconds = previous === undefined ? 0 : (now - previous.atMs) / 1000;
    return found.map((p): HostProcess => {
      const before = previous?.ticks.get(p.pid);
      const cpu = before === undefined || seconds <= 0 || p.ticks < before ? null : round1(((p.ticks - before) / CLOCK_TICKS / seconds) * 100);
      return { pid: p.pid, name: p.name, cpuPercent: cpu, rssBytes: p.rss, memoryPercent: totalBytes > 0 ? round1(clampPercent((p.rss / totalBytes) * 100)) : 0 };
    });
  }

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
