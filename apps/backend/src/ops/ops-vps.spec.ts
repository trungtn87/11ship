import { describe, expect, it } from '@jest/globals';
import { VPS_RANGES, VPS_RANGE_NAMES, buildSeries, collectorSignal, snapshotValue, vpsMetricKeys } from './ops-vps';
import { parseVpsQuery } from './ops-validation';
import { HostSnapshot } from './ops-system-probe';

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

describe('VPS history: holes are marked, never interpolated', () => {
  it('uses the four documented ranges and steps', () => {
    expect(VPS_RANGE_NAMES).toEqual(['1h', '24h', '7d', '30d']);
    expect(VPS_RANGES['1h'].stepSeconds).toBe(60);
    expect(VPS_RANGES['24h'].stepSeconds).toBe(900);
    expect(VPS_RANGES['7d'].stepSeconds).toBe(3600);
    expect(VPS_RANGES['30d']).toMatchObject({ stepSeconds: 21_600, source: 'hourly' });
  });

  it('reports a gap longer than twice the step and a trailing gap up to now', () => {
    const keys = vpsMetricKeys([{ label: 'root', path: '/' }]);
    expect(keys).toContain('disk.root');
    const rows = [0, 1, 2, 10, 11].map((i) => ({ key: 'cpu_percent', bucketMs: T0 + i * 60_000, avg: 10 + i, max: 20 }));
    const now = T0 + 11 * 60_000 + 5 * 60_000;
    const h = buildSeries(rows, keys, VPS_RANGES['1h'], now);
    expect(h.expectedStepSeconds).toBe(60);
    expect(h.series.cpu_percent).toHaveLength(5);
    expect(h.series.memory_percent).toEqual([]);
    expect(h.gaps).toEqual([
      { from: new Date(T0 + 2 * 60_000).toISOString(), to: new Date(T0 + 10 * 60_000).toISOString() },
      { from: new Date(T0 + 11 * 60_000).toISOString(), to: new Date(now).toISOString() },
    ]);
  });

  it('has no gap when samples are regular and fresh', () => {
    const rows = [0, 1, 2, 3].map((i) => ({ key: 'cpu_percent', bucketMs: T0 + i * 60_000, avg: 1, max: 1 }));
    expect(buildSeries(rows, ['cpu_percent'], VPS_RANGES['1h'], T0 + 3 * 60_000 + 30_000).gaps).toEqual([]);
  });

  it('parses the range query strictly', () => {
    expect(parseVpsQuery(undefined)).toBe('1h');
    expect(parseVpsQuery({ range: '30d' })).toBe('30d');
    expect(() => parseVpsQuery({ range: '2d' })).toThrow();
    expect(() => parseVpsQuery({ path: '/etc' })).toThrow();
  });
});

describe('collector signal', () => {
  it('is stale after 3 minutes but does not conclude that the VPS is down', () => {
    expect(collectorSignal(T0, T0 + 179_000)).toMatchObject({ state: 'ACTIVE', collectorStale: false });
    const stale = collectorSignal(T0, T0 + 181_000);
    expect(stale).toMatchObject({ state: 'STALE', collectorStale: true });
    expect(stale.message).toContain('Mất tín hiệu bộ thu thập > 3 phút');
    expect(stale.message).toContain('probe độc lập');
    expect(collectorSignal(null, T0)).toMatchObject({ state: 'NO_DATA', collectorStale: true, lastSampleAt: null });
  });
});

describe('snapshot value', () => {
  it('holds no connection string and no command line', () => {
    const snap: HostSnapshot = {
      sampledAtMs: T0, uptimeSeconds: 5, cpuPercent: 1, cpuCores: 2, loadAvg: [1, 2, 3], memory: null, swap: null, disks: [], io: null, network: null,
      processesByCpu: [{ pid: 1, name: 'node', cpuPercent: 1, rssBytes: 2, memoryPercent: 3 }], processesByMemory: [],
      backend: { pid: 9, uptimeSeconds: 1, rssBytes: 2, heapUsedBytes: 3, cpuPercent: null },
    };
    const v = snapshotValue(snap, { postgres: { latencyMs: 4, activeConnections: 5, sizeBytes: 6 }, apiLatencyMs: 7 });
    expect(v).toMatchObject({ backend: { self_health_latency_ms: 7 }, postgres: { latency_ms: 4, active_connections: 5, database_size_bytes: 6 }, processes_by_cpu: [{ pid: 1, name: 'node', cpu_percent: 1, rss_bytes: 2, memory_percent: 3 }] });
    expect(JSON.stringify(v)).not.toMatch(/postgres:\/\/|cmdline|environ/);
  });
});
