import { describe, expect, it } from '@jest/globals';
import { AppConfig } from '../config/app-config';
import { OpsConfig } from '../config/ops-config';
import { decideIosUpdate } from './ops-compat';
import { OpsIngestService } from './ops-ingest-service';
import { parseAppUpdateCheck } from './ops-validation';

const FOOD_IOS = 'https://apps.apple.com/vn/app/11food/id6836866599';
const SHIP_IOS = 'https://apps.apple.com/vn/app/11ship/id6836868854';

describe('iOS update decision (App Store build number)', () => {
  it('offers the App Store page only when the phone build is lower than the newest one', () => {
    expect(decideIosUpdate(11, { storeUrl: FOOD_IOS, latestBuild: 12 })).toEqual({ offered: true, storeUrl: FOOD_IOS, latestBuild: 12 });
    expect(decideIosUpdate(12, { storeUrl: FOOD_IOS, latestBuild: 12 })).toEqual({ offered: false, storeUrl: null, latestBuild: null });
    expect(decideIosUpdate(13, { storeUrl: FOOD_IOS, latestBuild: 12 })).toEqual({ offered: false, storeUrl: null, latestBuild: null });
  });

  it('offers nothing when either iOS value of the app is missing, or the phone did not say its build', () => {
    expect(decideIosUpdate(1, { storeUrl: FOOD_IOS }).offered).toBe(false);
    expect(decideIosUpdate(1, { latestBuild: 12 }).offered).toBe(false);
    expect(decideIosUpdate(1, {}).storeUrl).toBeNull();
    expect(decideIosUpdate(null, { storeUrl: FOOD_IOS, latestBuild: 12 }).offered).toBe(false);
  });
});

describe('iOS update check through the ingest service (no database: the iOS answer never reads the release catalog)', () => {
  const service = (ops: Partial<OpsConfig>): OpsIngestService => {
    const appConfig = { appEnv: 'production', ops: { diskPaths: [], backendVersion: 'test', collectorEnabled: false, ...ops } } as unknown as AppConfig;
    // Only the configuration is used by the iOS branch; the repositories and the transaction manager are never touched.
    return new OpsIngestService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, appConfig);
  };

  it('answers with the store page, build number and configured marketing name when iOS is newer, and never requires an update', async () => {
    const s = service({ iosStoreUrls: { FOOD: FOOD_IOS }, iosLatestBuilds: { FOOD: 12 }, iosLatestVersionNames: { FOOD: '1.0.1' } });
    const r = await s.updateCheck('FOOD', 7, 'IOS');
    expect(r).toMatchObject({ update_available: true, required: false, store_url: FOOD_IOS, latest_version_code: 12, compatible: null });
    expect(r.release).toMatchObject({ version_code: 12, version_name: '1.0.1', download_path: null });
  });

  it('keeps version_name null when no iOS marketing name is configured', async () => {
    const r = await service({ iosStoreUrls: { FOOD: FOOD_IOS }, iosLatestBuilds: { FOOD: 12 } }).updateCheck('FOOD', 7, 'IOS');
    expect(r.release).toMatchObject({ version_code: 12, version_name: null });
  });

  it('answers "no update" with store_url null when a value is missing or the build is not newer', async () => {
    const onlyBuild = await service({ iosLatestBuilds: { SHIP: 40 } }).updateCheck('SHIP', 3, 'IOS');
    expect(onlyBuild).toMatchObject({ update_available: false, required: false, store_url: null, release: null });
    const current = await service({ iosStoreUrls: { SHIP: SHIP_IOS }, iosLatestBuilds: { SHIP: 40 } }).updateCheck('SHIP', 40, 'IOS');
    expect(current).toMatchObject({ update_available: false, store_url: null, release: null });
  });
});

describe('update check query', () => {
  it('defaults to ANDROID, accepts IOS, and refuses any other platform', () => {
    expect(parseAppUpdateCheck({ component: 'FOOD', version_code: '5' })).toEqual({ component: 'FOOD', versionCode: 5, platform: 'ANDROID' });
    expect(parseAppUpdateCheck({ component: 'SHIP', version_code: '5', platform: 'IOS' })).toEqual({ component: 'SHIP', versionCode: 5, platform: 'IOS' });
    expect(() => parseAppUpdateCheck({ component: 'SHIP', platform: 'WINDOWS' })).toThrow();
    expect(() => parseAppUpdateCheck({ component: 'SHIP', platform: 'ios' })).toThrow();
    expect(() => parseAppUpdateCheck({ component: 'SHIP', platform: '' })).toThrow();
  });
});
