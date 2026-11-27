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

  it('accepts only the Google Play page of the right app as a store link', () => {
    const ok = parseOpsConfig({ env: { OPS_STORE_URL_FOOD: 'https://play.google.com/store/apps/details?id=vn.eleven.food', OPS_STORE_URL_SHIP: 'https://play.google.com/store/apps/details?id=vn.eleven.ship' }, appEnv: 'production' });
    expect(ok.ok && ok.config.storeUrls).toEqual({ FOOD: 'https://play.google.com/store/apps/details?id=vn.eleven.food', SHIP: 'https://play.google.com/store/apps/details?id=vn.eleven.ship' });
    const bad = parseOpsConfig({ env: { OPS_STORE_URL_FOOD: 'https://play.google.com/store/apps/details?id=vn.eleven.ship', OPS_STORE_URL_SHIP: 'https://evil.example/store/apps/details?id=vn.eleven.ship' }, appEnv: 'production' });
    expect(bad).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD', 'OPS_STORE_URL_SHIP'] });
    const none = parseOpsConfig({ env: {}, appEnv: 'production' });
    expect(none.ok && none.config.storeUrls).toEqual({});
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

  it('accepts the App Store page of each app and the newest iOS build numbers', () => {
    const r = parseOpsConfig({
      env: {
        OPS_STORE_URL_FOOD_IOS: 'https://apps.apple.com/vn/app/11food/id6836866599',
        OPS_STORE_URL_SHIP_IOS: 'https://apps.apple.com/vn/app/11ship/id6836868854',
        OPS_IOS_LATEST_BUILD_FOOD: '12',
        OPS_IOS_LATEST_BUILD_SHIP: '2000000000',
        OPS_IOS_LATEST_VERSION_NAME_FOOD: '1.0.1',
        OPS_IOS_LATEST_VERSION_NAME_SHIP: '2.3.0-beta.1',
      },
      appEnv: 'production',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.iosStoreUrls).toEqual({ FOOD: 'https://apps.apple.com/vn/app/11food/id6836866599', SHIP: 'https://apps.apple.com/vn/app/11ship/id6836868854' });
      expect(r.config.iosLatestBuilds).toEqual({ FOOD: 12, SHIP: 2_000_000_000 });
      expect(r.config.iosLatestVersionNames).toEqual({ FOOD: '1.0.1', SHIP: '2.3.0-beta.1' });
    }
    const none = parseOpsConfig({ env: {}, appEnv: 'production' });
    expect(none.ok && none.config.iosStoreUrls).toEqual({});
    expect(none.ok && none.config.iosLatestBuilds).toEqual({});
    expect(none.ok && none.config.iosLatestVersionNames).toEqual({});
  });

  it('names each bad iOS variable and nothing else', () => {
    const bad = (env: Record<string, string>) => parseOpsConfig({ env, appEnv: 'production' });
    // no /vn/, query, fragment, credentials, port, other host, non-numeric id, too long, Play link in the iOS slot
    expect(bad({ OPS_STORE_URL_FOOD_IOS: 'https://apps.apple.com/app/11food/id6836866599' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD_IOS'] });
    expect(bad({ OPS_STORE_URL_FOOD_IOS: 'https://apps.apple.com/vn/app/11food/id6836866599?l=vi' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD_IOS'] });
    expect(bad({ OPS_STORE_URL_SHIP_IOS: 'https://apps.apple.com/vn/app/11ship/id6836868854#x' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_SHIP_IOS'] });
    expect(bad({ OPS_STORE_URL_SHIP_IOS: 'https://u@apps.apple.com/vn/app/11ship/id6836868854' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_SHIP_IOS'] });
    expect(bad({ OPS_STORE_URL_SHIP_IOS: 'https://apps.apple.com:8443/vn/app/11ship/id6836868854' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_SHIP_IOS'] });
    expect(bad({ OPS_STORE_URL_SHIP_IOS: 'https://example.com/vn/app/11ship/id6836868854' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_SHIP_IOS'] });
    expect(bad({ OPS_STORE_URL_FOOD_IOS: 'https://play.google.com/store/apps/details?id=vn.eleven.food' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD_IOS'] });
    expect(bad({ OPS_STORE_URL_FOOD_IOS: 'https://apps.apple.com/vn/app/11food/idabc' })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD_IOS'] });
    expect(bad({ OPS_STORE_URL_FOOD_IOS: `https://apps.apple.com/vn/app/${'a'.repeat(200)}/id1` })).toEqual({ ok: false, invalid: ['OPS_STORE_URL_FOOD_IOS'] });
    expect(bad({ OPS_IOS_LATEST_BUILD_FOOD: '0' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_FOOD'] });
    expect(bad({ OPS_IOS_LATEST_BUILD_FOOD: '-3' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_FOOD'] });
    expect(bad({ OPS_IOS_LATEST_BUILD_SHIP: '1.5' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_SHIP'] });
    expect(bad({ OPS_IOS_LATEST_BUILD_SHIP: '2000000001' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_SHIP'] });
    expect(bad({ OPS_IOS_LATEST_BUILD_SHIP: 'abc' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_SHIP'] });
    expect(bad({ OPS_IOS_LATEST_VERSION_NAME_FOOD: '1 0 1' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_VERSION_NAME_FOOD'] });
    expect(bad({ OPS_IOS_LATEST_VERSION_NAME_SHIP: 'a'.repeat(33) })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_VERSION_NAME_SHIP'] });
    expect(bad({ OPS_STORE_URL_FOOD_IOS: 'https://apps.apple.com/vn/app/11food/id6836866599', OPS_IOS_LATEST_BUILD_SHIP: 'x' })).toEqual({ ok: false, invalid: ['OPS_IOS_LATEST_BUILD_SHIP'] });
  });
});
