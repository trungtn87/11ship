import { HEALTH_TIMEOUT_MS, REAL_TIMERS, Timers } from './health.js';

// What the diagnostics screen (F05/S06) may say about the running app: which build it is. The facts come from the
// `build-manifest.json` that `scripts/client-web-build.mjs` writes next to the app (app, mode, source commit, fingerprint of
// the exact output). Nothing is invented: when the file cannot be read or is not in the expected shape the screen says so.
//
// The DEV/TEST environment name is NOT a client fact (the app cannot know which database sits behind the server), so it is
// not shown until a contract provides it; the screen shows the address the app is served from instead.

export interface BuildInfo {
  readonly appId: string;
  readonly mode: 'live' | 'design';
  /** Full commit of the source the build was made from, or `unknown` when git was not available at build time. */
  readonly sourceSha: string;
  /** SHA-256 of the exact build output (64 hex). Public, not a secret. */
  readonly fingerprint: string;
}

export type BuildInfoState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly info: BuildInfo }
  | { readonly kind: 'unavailable' };

export const BUILD_MANIFEST_PATH = '/build-manifest.json';
const MAX_MANIFEST_CHARS = 8192;

const APP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const SOURCE_SHA = /^(?:[0-9a-f]{40}|unknown)$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** Validates a parsed manifest. Anything unexpected -> undefined (never a partial result). */
export function parseBuildManifest(value: unknown): BuildInfo | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { app_id: appId, mode, source_sha: sourceSha, fingerprint } = record;
  if (typeof appId !== 'string' || !APP_ID.test(appId)) {
    return undefined;
  }
  if (mode !== 'live' && mode !== 'design') {
    return undefined;
  }
  if (typeof sourceSha !== 'string' || !SOURCE_SHA.test(sourceSha)) {
    return undefined;
  }
  if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) {
    return undefined;
  }
  return { appId, mode, sourceSha, fingerprint };
}

/** Reads the manifest with the same rules as a health check: 5 s limit, `no-store`, no credentials. */
export async function loadBuildInfo(options: { readonly fetch: typeof fetch; readonly baseUrl?: string; readonly timers?: Timers; readonly timeoutMs?: number }): Promise<BuildInfoState> {
  const timers = options.timers ?? REAL_TIMERS;
  const controller = new AbortController();
  let handle: unknown;
  const deadline = new Promise<'timeout'>((resolve) => {
    handle = timers.set(() => {
      controller.abort();
      resolve('timeout');
    }, options.timeoutMs ?? HEALTH_TIMEOUT_MS);
  });
  const attempt = async (): Promise<BuildInfoState> => {
    try {
      const response = await options.fetch(`${options.baseUrl ?? ''}${BUILD_MANIFEST_PATH}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status !== 200) {
        return { kind: 'unavailable' };
      }
      const text = await response.text();
      if (text.length > MAX_MANIFEST_CHARS) {
        return { kind: 'unavailable' };
      }
      const info = parseBuildManifest(JSON.parse(text));
      return info === undefined ? { kind: 'unavailable' } : { kind: 'ok', info };
    } catch {
      return { kind: 'unavailable' };
    }
  };
  try {
    const outcome = await Promise.race([attempt(), deadline]);
    return outcome === 'timeout' ? { kind: 'unavailable' } : outcome;
  } finally {
    timers.clear(handle);
  }
}
