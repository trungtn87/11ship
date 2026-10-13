import { X509Certificate } from 'node:crypto';
import { statSync, readFileSync } from 'node:fs';
import { ClientApp } from '../client-auth/client-auth-constants';
import { ClientDeviceConfig, ClientDeviceSigner, parseRevocationSnapshot, RevocationSnapshot } from '../config/client-device-config';

/** Injection token of the pinned device trust. Undefined when the native gate is off: every ANDROID request is then a 503. */
export const CLIENT_DEVICE_TRUST = Symbol('CLIENT_DEVICE_TRUST');

/**
 * What the server trusts about native devices (contract11 section 7). It comes from operator configuration only, or from the
 * test dependency injection of the integration suite; nothing in a request, in a build flavour or in an environment variable of
 * a distribution can choose a root or a signer. The revocation snapshot is read lazily and verification refuses (503) one that
 * is older than 24 hours or unreadable.
 */
export interface ClientDeviceTrust {
  readonly environment: string;
  readonly signers: Readonly<Record<ClientApp, ClientDeviceSigner>>;
  readonly roots: readonly X509Certificate[];
  revocation(): Promise<RevocationSnapshot>;
  nowMs(): number;
}

/** The production-shaped trust: roots from the pinned PEM, the revocation snapshot re-read when its file changes. */
export function trustFromConfig(config: ClientDeviceConfig): ClientDeviceTrust {
  const roots = config.attestationRoots.map((pem) => new X509Certificate(pem));
  let cached: { mtimeMs: number; snapshot: RevocationSnapshot } | undefined;
  return {
    environment: config.environment,
    signers: config.signers,
    roots,
    nowMs: () => Date.now(),
    revocation: () => {
      const mtimeMs = statSync(config.revocationFile).mtimeMs;
      if (cached === undefined || cached.mtimeMs !== mtimeMs) {
        const snapshot = parseRevocationSnapshot(JSON.parse(readFileSync(config.revocationFile, 'utf8')));
        if (snapshot === undefined) {
          return Promise.reject(new Error('invalid revocation snapshot'));
        }
        cached = { mtimeMs, snapshot };
      }
      return Promise.resolve(cached.snapshot);
    },
  };
}
