import { lstatSync } from 'node:fs';
import path from 'node:path';
import matrixFile from './app-compatibility.json';
import { CheckReport } from './ops-engine';
import { ReleaseRow } from './ops-release-repository';

// The APK–backend compatibility contract (issue #193). `app-compatibility.json` ships WITH the backend build, so the minimum client versionCode a running
// backend demands is exactly the one that was deployed with it; there is no second place to edit by hand. FOOD and SHIP are independent (their
// versionCodes are unrelated numbers). The release catalog (`app.ops_releases`, SYSTEM-managed, audited) supplies what can actually be downloaded.
// Raising a minimum is a breaking change: the preflight (scripts/deploy/check-app-compat.mjs) refuses it until a PUBLISHED, downloadable APK at or above
// the new minimum exists, and the backend must keep the old API alive until then.

export type AppComponent = 'FOOD' | 'SHIP';
export const APP_COMPONENTS: readonly AppComponent[] = ['FOOD', 'SHIP'];

export interface CompatEntry {
  readonly minClientVersionCode: number;
  readonly reason: string | null;
}
export interface CompatMatrix {
  readonly contractRevision: number;
  readonly components: Readonly<Record<AppComponent, CompatEntry>>;
}

export function parseCompatMatrix(raw: unknown): CompatMatrix {
  const root = raw as { schema?: unknown; contract_revision?: unknown; components?: Record<string, { min_client_version_code?: unknown; reason?: unknown } | undefined> } | null;
  if (root === null || typeof root !== 'object' || root.schema !== 1 || !Number.isInteger(root.contract_revision) || (root.contract_revision as number) < 1) {
    throw new Error('app-compatibility.json: schema/contract_revision invalid');
  }
  const entry = (name: AppComponent): CompatEntry => {
    const e = root.components?.[name];
    const min = e?.min_client_version_code;
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 1 || min > 2_000_000_000) {
      throw new Error(`app-compatibility.json: ${name}.min_client_version_code invalid`);
    }
    if (e?.reason !== null && (typeof e?.reason !== 'string' || e.reason.length === 0 || e.reason.length > 300)) {
      throw new Error(`app-compatibility.json: ${name}.reason invalid`);
    }
    if (min > 1 && e?.reason === null) {
      throw new Error(`app-compatibility.json: ${name} raises the minimum above 1 and must say why`);
    }
    return { minClientVersionCode: min, reason: e?.reason ?? null };
  };
  return { contractRevision: root.contract_revision as number, components: { FOOD: entry('FOOD'), SHIP: entry('SHIP') } };
}

export const APP_COMPAT: CompatMatrix = parseCompatMatrix(matrixFile);
/** Injection token so a test can run the services against another matrix; production always gets APP_COMPAT. */
export const APP_COMPAT_MATRIX = 'APP_COMPAT_MATRIX';

/** The newest published release of a component, with the answer to "can a phone really download it now?". */
export interface PublishedFacts {
  readonly release: ReleaseRow | undefined;
  readonly artifactReady: boolean;
}

/** True when the release file is in the artifact directory with the registered size (the same test the download makes). */
export function artifactReady(artifactDir: string | undefined, release: ReleaseRow | undefined): boolean {
  if (artifactDir === undefined || release === undefined || release.artifactName === null || release.artifactSizeBytes === null) {
    return false;
  }
  try {
    const dir = path.resolve(artifactDir);
    const full = path.resolve(dir, release.artifactName);
    if (path.dirname(full) !== dir) return false;
    const stat = lstatSync(full);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === release.artifactSizeBytes;
  } catch {
    return false;
  }
}

export type CompatStatus =
  /** Installed build works and nothing newer can be downloaded. */
  | 'COMPATIBLE'
  /** Works; a newer build can be downloaded (advice). */
  | 'UPDATE_OPTIONAL'
  /** Does not work with this backend / release; a build that does can be downloaded. */
  | 'UPDATE_REQUIRED'
  /** Does not work with this backend, but no suitable APK can be downloaded: an operations fault, never "up to date". */
  | 'UPDATE_REQUIRED_UNAVAILABLE'
  /** The phone did not say which build it is: nothing is concluded. */
  | 'UNKNOWN_VERSION';

export interface CompatDecision {
  readonly status: CompatStatus;
  readonly compatible: boolean | null;
  readonly required: boolean;
  /** The release a phone is invited to download; null whenever there is nothing downloadable to offer. */
  readonly offer: ReleaseRow | null;
  readonly minSupportedVersionCode: number;
  readonly reason: string | null;
}

/**
 * What a phone is told. Two things can make a build unusable: the backend contract (the matrix) and a REQUIRED release SYSTEM published for a stated reason
 * (below its own min_supported_version_code). The offer is made only when the file is really downloadable and newer than the installed build.
 */
export function decideCompat(component: AppComponent, matrix: CompatMatrix, installed: number | null, published: PublishedFacts): CompatDecision {
  const entry = matrix.components[component];
  const latest = published.release;
  const downloadable = latest !== undefined && latest.versionCode !== null && latest.artifactName !== null && published.artifactReady ? latest : undefined;
  const newer = downloadable !== undefined && (installed === null || (downloadable.versionCode as number) > installed);
  const minSupported = Math.max(entry.minClientVersionCode, latest !== undefined && latest.priority === 'REQUIRED' ? (latest.minSupportedVersionCode ?? 0) : 0);

  if (installed === null) {
    // Unknown build: no conclusion about compatibility. A downloadable newer build is still advice, never an order.
    return { status: 'UNKNOWN_VERSION', compatible: null, required: false, offer: newer ? downloadable : null, minSupportedVersionCode: minSupported, reason: null };
  }
  const brokenByContract = installed < entry.minClientVersionCode;
  const brokenByRelease = newer && downloadable.priority === 'REQUIRED' && installed < (downloadable.minSupportedVersionCode ?? 2_000_000_000);
  if (brokenByContract) {
    const fixes = downloadable !== undefined && (downloadable.versionCode as number) >= entry.minClientVersionCode;
    const reason = entry.reason ?? (fixes ? downloadable.requiredReason : null) ?? 'Phiên bản này không còn dùng được với hệ thống hiện tại.';
    return fixes
      ? { status: 'UPDATE_REQUIRED', compatible: false, required: true, offer: downloadable, minSupportedVersionCode: minSupported, reason }
      : { status: 'UPDATE_REQUIRED_UNAVAILABLE', compatible: false, required: true, offer: null, minSupportedVersionCode: minSupported, reason };
  }
  if (brokenByRelease) {
    return { status: 'UPDATE_REQUIRED', compatible: false, required: true, offer: downloadable, minSupportedVersionCode: minSupported, reason: downloadable.requiredReason };
  }
  return { status: newer ? 'UPDATE_OPTIONAL' : 'COMPATIBLE', compatible: true, required: false, offer: newer ? downloadable : null, minSupportedVersionCode: minSupported, reason: null };
}

/**
 * The operations check: the deployed contract demands a build nobody can download. UNKNOWN is never OK, and "no release at all" while the minimum is the
 * initial 1 is fine (no phone can be below it).
 */
export function evaluateAppCompat(component: AppComponent, matrix: CompatMatrix, published: PublishedFacts): CheckReport {
  const label = component === 'FOOD' ? '11Food' : '11Ship';
  const min = matrix.components[component].minClientVersionCode;
  const latest = published.release;
  const base = { source: 'DEPLOY' as const, checkKey: `app_compat.${component.toLowerCase()}`, staleAfterSeconds: 900, impact: `Điện thoại đang cài ${label} cũ hơn bản ${String(min)} sẽ bị yêu cầu cập nhật nhưng không có tệp để tải.` };
  const value = { contract_revision: matrix.contractRevision, min_client_version_code: min, published_version_code: latest?.versionCode ?? null, artifact_ready: published.artifactReady };
  if (min <= 1) {
    return { ...base, state: 'OK', value, evidenceCode: 'COMPAT_BASELINE', title: `${label}: tương thích APK–backend` };
  }
  if (latest === undefined || latest.versionCode === null) {
    return { ...base, state: 'CRITICAL', value, evidenceCode: 'COMPAT_NO_PUBLISHED_APK', title: `${label}: backend yêu cầu bản ${String(min)} trở lên nhưng chưa có APK đã phát hành` };
  }
  if (latest.versionCode < min) {
    return { ...base, state: 'CRITICAL', value, evidenceCode: 'COMPAT_APK_TOO_OLD', title: `${label}: APK đã phát hành (${String(latest.versionCode)}) thấp hơn mức backend yêu cầu (${String(min)})` };
  }
  if (!published.artifactReady) {
    return { ...base, state: 'CRITICAL', value, evidenceCode: 'COMPAT_ARTIFACT_MISSING', title: `${label}: tệp APK ${latest.versionName} không tải được (thiếu hoặc sai kích thước trong thư mục artifact)` };
  }
  return { ...base, state: 'OK', value, evidenceCode: 'COMPAT_OK', title: `${label}: tương thích APK–backend` };
}
