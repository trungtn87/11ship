import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NodeSystemProbe } from './ops-system-probe';

// The read-only host probe (#247) against a scripted /proc. Nothing real is read except the portable node:os values.

function stat(pid: number, comm: string, utime: number, stime: number, rssPages: number): string {
  const f = ['S', '1', '1', '1', '0', '-1', '0', '0', '0', '0', '0', String(utime), String(stime), '0', '0', '20', '0', '1', '0', '100', '1000000', String(rssPages)];
  return `${pid} (${comm}) ${f.join(' ')} 0 0`;
}

function build(files: Record<string, string>) {
  const reads: string[] = [];
  const probe = new NodeSystemProbe({
    host: '127.0.0.1',
    port: 1,
    readProc: (path) => {
      reads.push(path);
      const text = files[path];
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    listPids: () => Object.keys(files).flatMap((p) => /^\/proc\/(\d+)\/stat$/.exec(p)?.[1] ?? []),
  });
  return { probe, reads, files };
}

const MEMINFO = 'MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 250 kB\nSwapTotal: 400 kB\nSwapFree: 300 kB\n';
const NETDEV = 'Inter-|   Receive\n face |bytes\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 1000 1 0 0 0 0 0 0 2000 1 0 0 0 0 0 0\n  eth1: 500 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0\n';
const DISKSTATS = '   8       0 sda 1 0 100 0 1 0 50 0 0 0 0\n   8       1 sda1 1 0 999 0 1 0 999 0 0 0 0\n   7       0 loop0 1 0 7 0 1 0 7 0 0 0 0\n';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NodeSystemProbe.hostSnapshot reads /proc only, never a command line or environment', () => {
  it('parses memory, swap, load, network (loopback excluded) and whole-disk I/O', () => {
    const { probe } = build({ '/proc/meminfo': MEMINFO, '/proc/loadavg': '0.50 1.25 2.00 1/100 42\n', '/proc/net/dev': NETDEV, '/proc/diskstats': DISKSTATS });
    const s = probe.hostSnapshot([]);
    expect(s.memory).toEqual({ totalBytes: 1000 * 1024, availableBytes: 250 * 1024, usedBytes: 750 * 1024, usedPercent: 75 });
    expect(s.swap).toEqual({ totalBytes: 400 * 1024, usedBytes: 100 * 1024, usedPercent: 25 });
    expect(s.loadAvg).toEqual([0.5, 1.3, 2]);
    expect(s.network).toMatchObject({ rxBytesTotal: 1500, txBytesTotal: 2100, rxBytesPerSec: null, txBytesPerSec: null });
    expect(s.io).toEqual({ readBytes: 100 * 512, writeBytes: 50 * 512 });
    expect(s.backend.pid).toBe(process.pid);
  });

  it('computes network rates from the delta between two samples and never a negative rate after a counter reset', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const files: Record<string, string> = { '/proc/net/dev': NETDEV };
    const { probe } = build(files);
    probe.hostSnapshot([]);
    now += 10_000;
    files['/proc/net/dev'] = NETDEV.replace('eth0: 1000', 'eth0: 6000').replace('2000 1', '4000 1');
    const second = probe.hostSnapshot([]);
    expect(second.network).toMatchObject({ rxBytesPerSec: 500, txBytesPerSec: 200 });
    now += 10_000;
    files['/proc/net/dev'] = NETDEV;
    expect(probe.hostSnapshot([]).network).toMatchObject({ rxBytesPerSec: null, txBytesPerSec: null });
  });

  it('lists the top five processes by CPU and by memory with only a short name, and never opens cmdline or environ', () => {
    let now = 5_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const files: Record<string, string> = { '/proc/meminfo': MEMINFO, '/proc/1/cmdline': 'node --password=SECRET', '/proc/1/environ': 'DATABASE_URL=postgres://u:SECRET@h/db' };
    for (let pid = 1; pid <= 7; pid += 1) files[`/proc/${pid}/stat`] = stat(pid, pid === 3 ? 'we ird) (name' + 'x'.repeat(40) : `proc${pid}`, 0, 0, pid * 10);
    const { probe, reads } = build(files);
    probe.hostSnapshot([]);
    now += 10_000;
    // 7 busiest = 700 ticks in 10 s = 70 %; process 2 = 200 ticks = 20 %.
    for (let pid = 1; pid <= 7; pid += 1) files[`/proc/${pid}/stat`] = stat(pid, pid === 3 ? 'we ird) (name' + 'x'.repeat(40) : `proc${pid}`, pid * 100, 0, pid * 10);
    const s = probe.hostSnapshot([]);
    expect(s.processesByCpu).toHaveLength(5);
    expect(s.processesByCpu[0]).toMatchObject({ pid: 7, name: 'proc7', cpuPercent: 70, rssBytes: 70 * 4096 });
    expect(s.processesByCpu.map((p) => p.pid)).toEqual([7, 6, 5, 4, 3]);
    expect(s.processesByMemory.map((p) => p.pid)).toEqual([7, 6, 5, 4, 3]);
    const odd = s.processesByCpu.find((p) => p.pid === 3);
    expect(odd?.name.length).toBeLessThanOrEqual(32);
    expect(odd?.name.startsWith('we ird) (name')).toBe(true);
    expect(JSON.stringify(s)).not.toContain('SECRET');
    expect(reads.some((p) => /cmdline|environ/.test(p))).toBe(false);
  });

  it('skips a process that exited between the listing and the read, and reports a missing /proc as null instead of inventing numbers', () => {
    const { probe } = build({ '/proc/5/stat': 'garbage' });
    const s = probe.hostSnapshot([]);
    expect(s.processesByCpu).toEqual([]);
    expect(s.io).toBeNull();
    expect(s.network).toBeNull();
    expect(s.swap).toBeNull();
  });
});
