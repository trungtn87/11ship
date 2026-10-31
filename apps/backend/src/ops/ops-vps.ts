import { DiskPathSpec, HostSnapshot } from './ops-system-probe';

// The VPS monitoring view (#247): the shape of the latest host snapshot kept in the `vps` check, and the 1h / 24h / 7d / 30d history built from the metrics the
// collector already writes. Pure functions; the database reads are in OpsRepository.

export const CHECK_VPS = 'vps';
/** No new sample for longer than this = the collector lost its signal (NOT proof that the VPS is down: only the independent probe can say that). */
export const COLLECTOR_STALE_SECONDS = 180;

export const VPS_RANGE_NAMES = ['1h', '24h', '7d', '30d'] as const;
export type VpsRange = (typeof VPS_RANGE_NAMES)[number];

export interface VpsRangeSpec {
  readonly windowMs: number;
  /** The time between two points the chart should expect when nothing is missing. */
  readonly stepSeconds: number;
  readonly source: 'raw' | 'hourly';
}

export const VPS_RANGES: Readonly<Record<VpsRange, VpsRangeSpec>> = {
  '1h': { windowMs: 3_600_000, stepSeconds: 60, source: 'raw' },
  '24h': { windowMs: 86_400_000, stepSeconds: 900, source: 'raw' },
  '7d': { windowMs: 7 * 86_400_000, stepSeconds: 3600, source: 'raw' },
  '30d': { windowMs: 30 * 86_400_000, stepSeconds: 21_600, source: 'hourly' },
};

const BASE_METRICS = ['cpu_percent', 'memory_percent', 'swap_percent', 'load_1m', 'net_rx_bps', 'net_tx_bps', 'db_latency_ms', 'db_connections', 'db_size_bytes', 'api_latency_ms'] as const;

export const vpsMetricKeys = (disks: readonly DiskPathSpec[]): string[] => [...BASE_METRICS, ...disks.map((d) => `disk.${d.label}`)];

const iso = (ms: number): string => new Date(ms).toISOString();

/** The latest snapshot as stored in the check (snake_case, no connection string, no command line of any process). */
export function snapshotValue(snap: HostSnapshot, extra: { postgres: { latencyMs: number | null; activeConnections: number | null; sizeBytes: number | null }; apiLatencyMs: number | null }): Record<string, unknown> {
  const proc = (p: HostSnapshot['processesByCpu'][number]): Record<string, unknown> => ({ pid: p.pid, name: p.name, cpu_percent: p.cpuPercent, rss_bytes: p.rssBytes, memory_percent: p.memoryPercent });
  return {
    sampled_at: iso(snap.sampledAtMs),
    host: {
      uptime_seconds: snap.uptimeSeconds,
      cpu_percent: snap.cpuPercent,
      cpu_cores: snap.cpuCores,
      load_avg: [...snap.loadAvg],
      memory: snap.memory === null ? null : { total_bytes: snap.memory.totalBytes, available_bytes: snap.memory.availableBytes, used_bytes: snap.memory.usedBytes, used_percent: snap.memory.usedPercent },
      swap: snap.swap === null ? null : { swap_total_bytes: snap.swap.totalBytes, swap_used_bytes: snap.swap.usedBytes, swap_percent: snap.swap.usedPercent },
      disks: snap.disks.map((d) => ({ label: d.label, path: d.path, total_bytes: d.totalBytes, free_bytes: d.freeBytes, used_bytes: d.usedBytes, used_percent: d.usedPercent })),
      io: snap.io === null ? null : { io_read_bytes: snap.io.readBytes, io_write_bytes: snap.io.writeBytes },
      network: snap.network === null ? null : { rx_bytes_total: snap.network.rxBytesTotal, tx_bytes_total: snap.network.txBytesTotal, rx_bytes_per_sec: snap.network.rxBytesPerSec, tx_bytes_per_sec: snap.network.txBytesPerSec },
    },
    backend: { pid: snap.backend.pid, uptime_seconds: snap.backend.uptimeSeconds, rss_bytes: snap.backend.rssBytes, heap_used_bytes: snap.backend.heapUsedBytes, cpu_percent: snap.backend.cpuPercent, self_health_latency_ms: extra.apiLatencyMs },
    postgres: { latency_ms: extra.postgres.latencyMs, active_connections: extra.postgres.activeConnections, database_size_bytes: extra.postgres.sizeBytes },
    processes_by_cpu: snap.processesByCpu.map(proc),
    processes_by_memory: snap.processesByMemory.map(proc),
  };
}

export interface SeriesPoint {
  readonly at: string;
  readonly value: number;
  readonly max: number;
}

export interface VpsSeries {
  readonly expectedStepSeconds: number;
  readonly series: Record<string, SeriesPoint[]>;
  readonly gaps: { from: string; to: string }[];
}

/**
 * Points per metric from the bucketed rows, plus the holes: any distance between two consecutive points (of any metric) longer than twice the expected step, and
 * the stretch between the last point and now. The chart breaks its line there; nothing is interpolated.
 */
export function buildSeries(rows: readonly { key: string; bucketMs: number; avg: number; max: number }[], keys: readonly string[], spec: VpsRangeSpec, nowMs: number): VpsSeries {
  const series: Record<string, SeriesPoint[]> = Object.fromEntries(keys.map((k) => [k, []]));
  const times = new Set<number>();
  for (const r of rows) {
    series[r.key]?.push({ at: iso(r.bucketMs), value: Math.round(r.avg * 100) / 100, max: Math.round(r.max * 100) / 100 });
    times.add(r.bucketMs);
  }
  const ordered = [...times].sort((a, b) => a - b);
  const limit = spec.stepSeconds * 2000;
  const gaps: { from: string; to: string }[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const from = ordered[i - 1] as number;
    const to = ordered[i] as number;
    if (to - from > limit) gaps.push({ from: iso(from), to: iso(to) });
  }
  const last = ordered[ordered.length - 1];
  if (last !== undefined && nowMs - last > limit + spec.stepSeconds * 1000) gaps.push({ from: iso(last), to: iso(nowMs) });
  return { expectedStepSeconds: spec.stepSeconds, series, gaps };
}

export interface CollectorSignal {
  readonly state: 'ACTIVE' | 'STALE' | 'NO_DATA';
  readonly collectorStale: boolean;
  readonly lastSampleAt: string | null;
  readonly message: string;
}

export function collectorSignal(sampledAtMs: number | null, nowMs: number): CollectorSignal {
  if (sampledAtMs === null) {
    return { state: 'NO_DATA', collectorStale: true, lastSampleAt: null, message: 'Chưa có mẫu nào từ bộ thu thập.' };
  }
  const stale = nowMs - sampledAtMs > COLLECTOR_STALE_SECONDS * 1000;
  return {
    state: stale ? 'STALE' : 'ACTIVE',
    collectorStale: stale,
    lastSampleAt: iso(sampledAtMs),
    message: stale ? 'Mất tín hiệu bộ thu thập > 3 phút. Chưa thể kết luận VPS ngừng hoạt động: cần xem thêm báo cáo của probe độc lập ngoài VPS.' : 'Bộ thu thập đang hoạt động.',
  };
}
