import { AppError, TechnicalError } from '../common/app-errors';
import { AppConfig } from '../config/app-config';
import { ClientAuthConfig, isLocalWebMode } from '../config/client-auth-config';
import { ClientConsentInput, ClientDevice } from './client-auth-validation';

// Server-side policy of the client registration (M01.03), decided from the validated startup configuration and never from
// anything a request says about itself (no X-Forwarded-For, no app label, no header).

/** Injection token of the settings below. */
export const CLIENT_AUTH_SETTINGS = Symbol('CLIENT_AUTH_SETTINGS');

export interface ClientAuthSettings {
  /** The one consent pair the server accepts, or undefined when none is configured (the endpoint is then closed). */
  readonly consent: ClientAuthConfig | undefined;
  /** LOCAL_WEB: explicit development/test AND a loopback bind (contract11 section 6). */
  readonly localWeb: boolean;
}

export function clientAuthSettingsFrom(config: AppConfig): ClientAuthSettings {
  return { consent: config.clientAuth, localWeb: isLocalWebMode(config.appEnv, config.host) };
}

/**
 * The device gate of contract11 sections 6 and 7, applied before anything is read or written:
 *  - ANDROID has no proof verifier in this slice: SERVICE_UNAVAILABLE (503). The platform label is never accepted as a
 *    proof, there is no device_id fallback and no partial native check, so nothing is created or consumed.
 *  - WEB is accepted only in LOCAL_WEB mode; anywhere else (production, staging, a non-loopback bind) it needs a device
 *    proof that WEB cannot give: DEVICE_PROOF_REQUIRED (403).
 */
export function assertDeviceAllowed(settings: ClientAuthSettings, device: ClientDevice): void {
  if (device.platform === 'ANDROID') {
    throw new TechnicalError('unavailable', 'The Android device proof verifier is not available');
  }
  if (device.platform === 'WEB' && settings.localWeb) {
    return;
  }
  throw new AppError('DEVICE_PROOF_REQUIRED');
}

/**
 * The consent comparison of a FIRST execution (it runs inside the idempotency callback, before any row is written; a
 * committed replay never comes here, so a later change of the server pair cannot make an accepted registration fail or be
 * rewritten). No configured pair is a closed endpoint (SERVICE_UNAVAILABLE), not an accepted anything. A pair that does not
 * match the configured one exactly is CONSENT_VERSION_UNSUPPORTED.
 */
export function assertConsentSupported(settings: ClientAuthSettings, consent: ClientConsentInput): ClientAuthConfig {
  const configured = settings.consent;
  if (configured === undefined) {
    throw new TechnicalError('unavailable', 'No consent pair is configured for the client registration');
  }
  if (consent.termsVersion !== configured.termsVersion || consent.privacyVersion !== configured.privacyVersion) {
    throw new AppError('CONSENT_VERSION_UNSUPPORTED');
  }
  return configured;
}
