import { describe, expect, it } from '@jest/globals';
import { APP_COMPAT, CompatMatrix, artifactReady, decideCompat, evaluateAppCompat, parseCompatMatrix } from './ops-compat';
import { ReleaseRow } from './ops-release-repository';

const matrix = (food: number, ship: number): CompatMatrix => ({
  contractRevision: 2,
  components: { FOOD: { minClientVersionCode: food, reason: food > 1 ? 'Cần bản mới' : null }, SHIP: { minClientVersionCode: ship, reason: ship > 1 ? 'Cần bản mới cho shipper' : null } },
});

function release(o: Partial<ReleaseRow> = {}): ReleaseRow {
  return { releaseId: '11111111-1111-4111-8111-111111111111', component: 'SHIP', versionName: '1.2.0', versionCode: 40, releaseNotes: '', artifactName: 'ship.apk', artifactSha256: 'a'.repeat(64), artifactSizeBytes: 10, minBackendVersion: null, minSupportedVersionCode: null, compatibilityNote: null, priority: 'NORMAL', requiredReason: null, status: 'PUBLISHED', releasedAtMs: 1, hasDbMigration: false, rollbackNote: null, createdAtMs: 1, version: 1, ...o };
}

describe('APK–backend compatibility decision (#193)', () => {
  it('the matrix that ships with the backend parses', () => {
    expect(APP_COMPAT.contractRevision).toBeGreaterThanOrEqual(1);
    expect(() => parseCompatMatrix({ schema: 1, contract_revision: 1, components: { FOOD: { min_client_version_code: 3, reason: null }, SHIP: { min_client_version_code: 1, reason: null } } })).toThrow('must say why');
  });

  it('compatible and nothing newer', () => {
    expect(decideCompat('SHIP', matrix(1, 1), 40, { release: release(), artifactReady: true })).toMatchObject({ status: 'COMPATIBLE', required: false, offer: null, compatible: true });
  });

  it('a newer build is optional advice when the installed build still meets the minimum', () => {
    expect(decideCompat('SHIP', matrix(1, 30), 35, { release: release(), artifactReady: true })).toMatchObject({ status: 'UPDATE_OPTIONAL', required: false, compatible: true });
  });

  it('below the backend minimum with a downloadable build: required, with the stated reason', () => {
    const d = decideCompat('SHIP', matrix(1, 30), 20, { release: release(), artifactReady: true });
    expect(d).toMatchObject({ status: 'UPDATE_REQUIRED', required: true, compatible: false, reason: 'Cần bản mới cho shipper', minSupportedVersionCode: 30 });
    expect(d.offer?.versionCode).toBe(40);
  });

  it('FOOD and SHIP have independent thresholds', () => {
    const m = matrix(100, 30);
    expect(decideCompat('SHIP', m, 35, { release: release(), artifactReady: true }).required).toBe(false);
    expect(decideCompat('FOOD', m, 35, { release: release({ component: 'FOOD', versionCode: 120 }), artifactReady: true }).required).toBe(true);
  });

  it('below the minimum and NO downloadable build is never "up to date" and offers no link', () => {
    for (const published of [{ release: undefined, artifactReady: false }, { release: release({ versionCode: 25 }), artifactReady: true }, { release: release(), artifactReady: false }]) {
      const d = decideCompat('SHIP', matrix(1, 30), 20, published);
      expect(d).toMatchObject({ status: 'UPDATE_REQUIRED_UNAVAILABLE', required: true, compatible: false, offer: null });
    }
  });

  it('a REQUIRED release only blocks builds below its own minimum; a missing file is never offered', () => {
    const req = release({ priority: 'REQUIRED', minSupportedVersionCode: 35, requiredReason: 'Sửa lỗi bảo mật' });
    expect(decideCompat('SHIP', matrix(1, 1), 30, { release: req, artifactReady: true })).toMatchObject({ status: 'UPDATE_REQUIRED', required: true, reason: 'Sửa lỗi bảo mật' });
    expect(decideCompat('SHIP', matrix(1, 1), 36, { release: req, artifactReady: true })).toMatchObject({ status: 'UPDATE_OPTIONAL', required: false });
    expect(decideCompat('SHIP', matrix(1, 1), 30, { release: req, artifactReady: false })).toMatchObject({ offer: null, required: false });
    expect(decideCompat('SHIP', matrix(1, 1), 30, { release: release({ priority: 'REQUIRED' }), artifactReady: true }).required).toBe(true);
  });

  it('an unknown installed build concludes nothing', () => {
    expect(decideCompat('SHIP', matrix(1, 30), null, { release: release(), artifactReady: true })).toMatchObject({ status: 'UNKNOWN_VERSION', compatible: null, required: false });
  });

  it('the ops check is critical when the contract demands a build nobody can download, and never green on a baseline-less gap', () => {
    const ok = evaluateAppCompat('SHIP', matrix(1, 30), { release: release(), artifactReady: true });
    expect(ok.state).toBe('OK');
    expect(evaluateAppCompat('SHIP', matrix(1, 30), { release: undefined, artifactReady: false })).toMatchObject({ state: 'CRITICAL', evidenceCode: 'COMPAT_NO_PUBLISHED_APK' });
    expect(evaluateAppCompat('SHIP', matrix(1, 50), { release: release(), artifactReady: true })).toMatchObject({ state: 'CRITICAL', evidenceCode: 'COMPAT_APK_TOO_OLD' });
    expect(evaluateAppCompat('SHIP', matrix(1, 30), { release: release(), artifactReady: false })).toMatchObject({ state: 'CRITICAL', evidenceCode: 'COMPAT_ARTIFACT_MISSING' });
    expect(evaluateAppCompat('FOOD', matrix(1, 30), { release: undefined, artifactReady: false }).state).toBe('OK');
  });

  it('artifactReady needs the registered file at the registered size', () => {
    expect(artifactReady(undefined, release())).toBe(false);
    expect(artifactReady('/nonexistent-dir-xyz', release())).toBe(false);
    expect(artifactReady('/tmp', undefined)).toBe(false);
  });
});
