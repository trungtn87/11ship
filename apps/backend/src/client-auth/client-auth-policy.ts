import { AppError, TechnicalError } from '../common/app-errors';
import { AppConfig } from '../config/app-config';
import { ClientAuthConfig, ClientPhoneVerificationMode, isLocalWebMode } from '../config/client-auth-config';
import { ClientPlatform } from './client-auth-constants';
import { ClientConsentInput, ClientDevice } from './client-auth-validation';
import { TERMS_PAGE_VERSION } from '../legal/terms-page';
import { PRIVACY_PAGE_VERSION } from '../legal/privacy-page';

// Server-side policy of the client registration (M01.03), decided from the validated startup configuration and never from
// anything a request says about itself (no X-Forwarded-For, no app label, no header).

/** Injection token of the settings below. */
export const CLIENT_AUTH_SETTINGS = Symbol('CLIENT_AUTH_SETTINGS');

export interface ClientAuthSettings {
  /** The one consent pair the server accepts, or undefined when none is configured (the endpoint is then closed). */
  readonly consent: ClientAuthConfig | undefined;
  /** LOCAL_WEB: explicit development/test AND a loopback bind (contract11 section 6). */
  readonly localWeb: boolean;
  /**
   * REQUIRED (a registration needs a proof) or DISABLED_TEST (no proof, TEST_UNVERIFIED account). Decided once from the
   * validated startup configuration; DISABLED_TEST exists only in development/test on a loopback bind. It is what
   * GET /v1/client-auth/config reports and what selects the registration body of POST /v1/client-auth/register.
   */
  readonly phoneVerificationMode: ClientPhoneVerificationMode;
  /** Legacy APK/device-proof compatibility only. Password sessions never require this verifier. */
  readonly androidEnabled?: boolean;
}

export function clientAuthSettingsFrom(config: AppConfig, deviceTrust?: unknown): ClientAuthSettings {
  return {
    consent: config.clientAuth,
    localWeb: isLocalWebMode(config.appEnv, config.host),
    phoneVerificationMode: config.clientPhoneVerificationMode ?? 'REQUIRED',
    androidEnabled: deviceTrust !== undefined,
  };
}

/** Android uses credentials/OTP and Bearer sessions. device_id is metadata, never authentication.
 * WEB retains its existing local-development restriction. Legacy proof is verified separately when presented. */
export function assertDeviceAllowed(settings: ClientAuthSettings, device: ClientDevice): void {
  assertPlatformAllowed(settings, device.platform);
}

/** Platform routing is separate from token validation and live account/role authorization. */
export function assertPlatformAllowed(settings: ClientAuthSettings, platform: ClientPlatform): void {
  if (platform === 'ANDROID') {
    return;
  }
  if (platform === 'WEB' && settings.localWeb) {
    return;
  }
  throw new AppError('DEVICE_PROOF_REQUIRED');
}

/** Previous APKs may still register while their owner updates to the approved pair. */
const LEGACY_TERMS_VERSION = 'terms-20261014-v1';
const LEGACY_PRIVACY_VERSION = 'privacy-20261017-v1';

function equalsPair(a: ClientAuthConfig, b: ClientAuthConfig): boolean {
  return a.termsVersion === b.termsVersion && a.privacyVersion === b.privacyVersion;
}

const LEGACY_PAIR: ClientAuthConfig = { termsVersion: LEGACY_TERMS_VERSION, privacyVersion: LEGACY_PRIVACY_VERSION };
const OFFICIAL_PAIR: ClientAuthConfig = { termsVersion: TERMS_PAGE_VERSION, privacyVersion: PRIVACY_PAGE_VERSION };

/**
 * The consent comparison of a FIRST execution (it runs inside the idempotency callback, before any row is written; a
 * committed replay never comes here, so a later change of the server pair cannot make an accepted registration fail or be
 * rewritten). No configured pair is a closed endpoint (SERVICE_UNAVAILABLE), not an accepted anything. A pair that does not
 * match the configured one exactly is CONSENT_VERSION_UNSUPPORTED, except while migrating between the two
 * Owner-approved versions. The accepted pair is returned unchanged so user_consents stores what the user actually saw.
 */
export function assertConsentSupported(settings: ClientAuthSettings, consent: ClientConsentInput): ClientAuthConfig {
  const configured = settings.consent;
  if (configured === undefined) {
    throw new TechnicalError('unavailable', 'No consent pair is configured for the client registration');
  }
  if (equalsPair(consent, configured)) {
    return configured;
  }

  // This narrow compatibility window supports old, already-installed APKs and new APKs
  // regardless of whether the VPS's primary consent version has been switched yet.
  // Never accept mixed terms/privacy versions, or arbitrary unconfigured versions.
  const configuredIsApproved = equalsPair(configured, LEGACY_PAIR) || equalsPair(configured, OFFICIAL_PAIR);
  const requestedIsApproved = equalsPair(consent, LEGACY_PAIR) || equalsPair(consent, OFFICIAL_PAIR);
  if (configuredIsApproved && requestedIsApproved) {
    return { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion };
  }
  throw new AppError('CONSENT_VERSION_UNSUPPORTED');
}
