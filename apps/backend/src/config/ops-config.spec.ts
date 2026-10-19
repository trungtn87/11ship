import { describe, expect, it } from '@jest/globals';
import { parseOpsConfig } from './ops-config';

describe('M13 configuration', () => {
  it('works with no variable at all (nothing is invented)', () => {
    const r = parseOpsConfig({ env: {}, appEnv: 'production' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.config.diskPaths).toEqual([{ label: 'root', path: '/' }]);
      expect(r.config.publicBaseUrl).toBeUndefined();
      expect(r.config.artifactDir).toBeUndefined();
      expect(r.config.collectorEnabled).toBe(true);
    }
  });

  it('never runs the collector in tests', () => {
    const r = parseOpsConfig({ env: { OPS_COLLECTOR: 'on' }, appEnv: 'test' });
    expect(r.ok && r.config.collectorEnabled).toBe(false);
  });

  it('accepts a good set and names only the bad variables', () => {
    const ok = parseOpsConfig({ env: { OPS_PUBLIC_BASE_URL: 'https://x.example/', OPS_ARTIFACT_DIR: '/srv/11ship/releases', OPS_DISK_PATHS: 'root=/;data=/var/lib/postgresql', OPS_BACKEND_VERSION: '1.4.0' }, appEnv: 'production' });
    expect(ok.ok && ok.config.diskPaths).toHaveLength(2);
    const bad = parseOpsConfig({ env: { OPS_PUBLIC_BASE_URL: 'http://x.example', OPS_ARTIFACT_DIR: '../etc', OPS_DISK_PATHS: 'root=/;root=/x', OPS_BACKEND_VERSION: 'a b', OPS_COLLECTOR: 'maybe' }, appEnv: 'production' });
    expect(bad).toEqual({ ok: false, invalid: ['OPS_PUBLIC_BASE_URL', 'OPS_ARTIFACT_DIR', 'OPS_DISK_PATHS', 'OPS_BACKEND_VERSION', 'OPS_COLLECTOR'] });
    expect(JSON.stringify(bad)).not.toContain('etc');
  });
});
